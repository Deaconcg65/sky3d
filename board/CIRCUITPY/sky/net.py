# Everything the board asks the internet: flights, routes, weather, and its own updates. Every request goes out from
# the board; nothing ever connects in, so the home router needs no change.
import json
import ssl
import time

import adafruit_requests
import socketpool
import wifi

from sky import logic, store

try:
    import hashlib
except ImportError:   # a CircuitPython build without it: updates are checked by size only
    hashlib = None

AGENT = 'skypuppy3d-board/1 (+https://github.com/Deaconcg65/sky3d)'
UPDATES = 'https://raw.githubusercontent.com/Deaconcg65/sky3d/main/board/CIRCUITPY/'
WEATHER = 'https://api.weather.gov/'

# The free flight networks, in the order the board tries them. Each allows personal use and about one request a
# second; the board asks once every 10 seconds. A 9 nautical mile circle is a little over 10 statute miles.
NETWORKS = (
    ('airplanes.live', 'https://api.airplanes.live/v2/point/%.4f/%.4f/9'),
    ('adsb.lol', 'https://api.adsb.lol/v2/point/%.4f/%.4f/9'),
    ('adsb.fi', 'https://opendata.adsb.fi/api/v2/lat/%.4f/lon/%.4f/dist/9'),
)
ROUTES = ('https://adsb.im/api/0/routeset', 'https://api.adsb.lol/api/0/routeset')


def seconds():
    return time.monotonic_ns() // 1000000000


class Net:
    def __init__(self):
        self.pool = socketpool.SocketPool(wifi.radio)
        self.http = adafruit_requests.Session(self.pool, ssl.create_default_context())
        self.utc_at, self.mono_at = None, 0
        self.network = 0            # which free network answered last
        self.network_since = 0
        self.source = ''
        self.routes = {}            # callsign: (route text, when to ask again)
        self.routes_asked = -999
        self.wx_place = None        # (forecast address, station address, time zone, when to look again)
        self.wx_station = None
        self.zone = 'America/New_York'

    # ---------- plumbing ----------

    def connect(self, ssid, password, timeout=20):
        if wifi.radio.connected and wifi.radio.ap_info and wifi.radio.ap_info.ssid == ssid:
            return True
        try:
            wifi.radio.connect(ssid, password or None, timeout=timeout)
        except (ConnectionError, OSError):
            return False
        return bool(wifi.radio.connected)

    def utc(self):
        """The time in seconds since 1970, from the Date the web servers send. None until one has answered."""
        if self.utc_at is None:
            return None
        return self.utc_at + seconds() - self.mono_at

    def _note_date(self, r):
        date = ''
        for k, v in r.headers.items():
            if k.lower() == 'date':
                date = v
        t = logic.http_date(date)
        if t is not None:
            self.utc_at, self.mono_at = t, seconds()

    def get_json(self, url, timeout=8):
        r = None
        try:
            r = self.http.get(url, headers={'User-Agent': AGENT, 'Accept': 'application/json'}, timeout=timeout)
            self._note_date(r)
            if r.status_code != 200:
                return None
            return r.json()
        except (OSError, RuntimeError, ValueError):
            return None
        finally:
            if r is not None:
                try:
                    r.close()
                except Exception:   # the connection is already gone
                    pass

    def post_json(self, url, body, timeout=8):
        r = None
        try:
            r = self.http.post(url, data=json.dumps(body), timeout=timeout,
                               headers={'User-Agent': AGENT, 'Accept': 'application/json',
                                        'Content-Type': 'application/json'})
            self._note_date(r)
            if r.status_code != 200:
                return None
            return r.json()
        except (OSError, RuntimeError, ValueError):
            return None
        finally:
            if r is not None:
                try:
                    r.close()
                except Exception:
                    pass

    # ---------- flights ----------

    def planes(self, lat, lon, antenna=''):
        """The aircraft around the board, closest first, or None when nothing answered. A board at a house with its
        own antenna reads that first; every board falls back to the free networks."""
        if antenna:
            data = self.get_json(antenna, timeout=4)
            if data is not None:
                self.source = 'your antenna'
                return logic.planes_from(data, lat, lon)
        now = seconds()
        if self.network and now - self.network_since > 1800:
            self.network = 0        # after half an hour on a fallback, try the first network again
        for step in range(len(NETWORKS)):
            i = (self.network + step) % len(NETWORKS)
            name, url = NETWORKS[i]
            data = self.get_json(url % (lat, lon))
            if data is not None:
                if i != self.network:
                    self.network, self.network_since = i, now
                self.source = name
                return logic.planes_from(data, lat, lon)
        return None

    def route(self, p):
        r = self.routes.get(p['flight'])
        return r[0] if r else ''

    def ask_routes(self, planes):
        """Ask the route services where a few of the flights on the screen are going, at most once a minute. Only
        the callsign and position are sent. Answers are kept for half an hour."""
        now = seconds()
        if now - self.routes_asked < 60:
            return
        for k in [k for k, v in self.routes.items() if v[1] < now]:
            del self.routes[k]
        want = []
        for p in planes:
            cs = p['flight']
            if logic.airline_of(p) and cs not in self.routes and len(want) < 5:
                want.append({'callsign': cs, 'lat': p['lat'], 'lng': p['lon']})
        if not want:
            return
        self.routes_asked = now
        for url in ROUTES:
            got = self.post_json(url, {'planes': want})
            if isinstance(got, list):
                answers = {}
                for x in got:
                    if isinstance(x, dict) and isinstance(x.get('callsign'), str):
                        answers[x['callsign']] = x
                for w in want:
                    self.routes[w['callsign']] = (logic.route_text(answers.get(w['callsign'])), now + 1800)
                return

    # ---------- weather ----------

    def weather(self, lat, lon):
        """The two weather lines from the National Weather Service, or None when it did not answer. The forecast
        office and the nearest weather station are looked up once a day."""
        now = seconds()
        if self.wx_place is None or now > self.wx_place[3]:
            pts = self.get_json(WEATHER + 'points/%.4f,%.4f' % (lat, lon))
            props = pts.get('properties') if isinstance(pts, dict) else None
            if not isinstance(props, dict):
                return None
            fc, st = props.get('forecast'), props.get('observationStations')
            if not (_ours(fc) and _ours(st)):
                return None
            if isinstance(props.get('timeZone'), str):
                self.zone = props['timeZone']
            self.wx_place, self.wx_station = (fc, st, self.zone, now + 86400), None
        if self.wx_station is None:
            sts = self.get_json(self.wx_place[1])
            feats = sts.get('features') if isinstance(sts, dict) else None
            sid = None
            if isinstance(feats, list) and feats and isinstance(feats[0], dict):
                fp = feats[0].get('properties')
                if isinstance(fp, dict) and isinstance(fp.get('stationIdentifier'), str):
                    sid = ''.join(c for c in fp['stationIdentifier'] if c.isalpha() or c.isdigit())[:8]
            if not sid:
                return None
            self.wx_station = WEATHER + 'stations/%s/observations/latest' % sid
        obs = self.get_json(self.wx_station)
        fc = self.get_json(self.wx_place[0], timeout=12)
        period = None
        if isinstance(fc, dict) and isinstance(fc.get('properties'), dict):
            periods = fc['properties'].get('periods')
            if isinstance(periods, list) and periods:
                period = periods[0]
        top, second = logic.weather_lines(obs, period)
        if not top and not second:
            return None
        return top or 'Weather', second

    # ---------- updates ----------

    def update(self):
        """Look for a new version of the board's files in the repository. Downloads the files that changed beside the
        old ones, then lists them in update.todo for boot.py to swap in on the next start. Returns True when an update
        is ready and the board should restart."""
        if store.update_on_trial():
            return False             # the last update has not proved itself yet
        remote = self.get_json(UPDATES + 'manifest.json')
        plan = logic.plan_update(store.load_manifest(), remote, store.load_manifest(store.REFUSED))
        if not plan or not (plan[0] or plan[1]):
            return False
        fetch, remove = plan
        if sum(f[2] for f in fetch) + 64 * 1024 > store.free_bytes():
            return False
        done = []
        for path, sha, size in fetch:
            if not self._download(path, sha, size, remote['files'][path].get('sha1')):
                for p in done + [path]:
                    store.remove('/' + p + '.new')
                return False
            done.append(path)
        with open('/manifest.json.new', 'w') as f:
            json.dump(remote, f)
        with open('/update.todo', 'w') as f:
            for p in done:
                f.write('put %s\n' % p)
            for p in remove:
                f.write('del %s\n' % p)
            f.write('put manifest.json\n')
        return True

    def _download(self, path, sha, size, sha1):
        store.make_folders(path)
        r = None
        h, want = _hasher(sha, sha1)
        got = 0
        try:
            r = self.http.get(UPDATES + path, headers={'User-Agent': AGENT}, timeout=15)
            if r.status_code != 200:
                return False
            with open('/' + path + '.new', 'wb') as f:
                for chunk in r.iter_content(chunk_size=1024):
                    got += len(chunk)
                    if got > size:
                        return False
                    if h is not None:
                        h.update(chunk)
                    f.write(chunk)
        except (OSError, RuntimeError, ValueError):
            return False
        finally:
            if r is not None:
                try:
                    r.close()
                except Exception:
                    pass
        return got == size and (h is None or logic.hex_of(h.digest()) == want)


def _hasher(sha, sha1):
    """A SHA-256 check where the board can do one, otherwise SHA-1, otherwise only the size is checked."""
    for name, want in (('sha256', sha), ('sha1', sha1)):
        if want:
            try:
                return hashlib.new(name), want
            except (ValueError, AttributeError):
                pass
    return None, None


def _ours(url):
    """Only follow addresses on the Weather Service's own site."""
    return isinstance(url, str) and url.startswith(WEATHER) and len(url) < 200 and ' ' not in url
