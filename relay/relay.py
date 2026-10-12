#!/usr/bin/env python3
"""3D sky relay and front door.

This small program runs on the receiver itself and does two jobs.

1. Relay. Web browsers are not allowed to read the free flight networks directly, because those networks do not give web
   pages that permission. The 3D sky page asks the relay, the relay asks a flight network over the home internet
   connection, and the relay hands the answer back. It passes on only three kinds of question: aircraft around a point,
   one flight by callsign, and one aircraft by registration.

2. Front door, for sharing the page with people outside the house through a secure tunnel. Point the tunnel at this
   program (port 8099) and not at the receiver's web server. People outside can then reach exactly four things and
   nothing else on the receiver:
     - the 3D sky page, at /sky/
     - the antenna's aircraft list and recent history, cut down to the few facts the page draws (which aircraft, where,
       how high, how fast). Everything else is left behind, including anything that hints at where the antenna
       stands: the receiver's position, each aircraft's distance and direction from the antenna, and signal strength.
     - the aircraft type tables the page reads
     - the relay, under /sky-relay
   The map page and everything else on the receiver's web server stay out of reach.

Guards, so that an open address cannot be turned against the home connection or the flight networks:
     - it answers the 3D sky page that came from the same address, and refuses pages on other sites
     - each viewer may ask only so often, and may cause only so many questions to the flight networks
     - however many people are watching, the flight networks are asked at most about 60 times a minute (45 about areas,
       15 about single flights); people watching the same sky share one answer, and when the limit is reached viewers
       get the last answer, marked with its age
     - nothing about who is watching or what they ask is written down

It listens on port 8099. Opening http://<receiver address>:8099/check from another computer inside the house shows which
flight networks answer it. It needs nothing beyond the Python that comes with Raspberry Pi OS. It must run from a home
internet connection: the flight networks refuse or ration requests that come from shared cloud hosting.

Viewers who arrive through a tunnel all appear to come from this receiver itself, so the tunnel has to say who each one
is. Cloudflare Tunnel does that in a header named CF-Connecting-IP, which is what the relay reads. For another tunnel,
set SKY3D_VIEWER_HEADER to the header it uses. Without one, all outside viewers share a single allowance.
"""
import gzip, ipaddress, json, os, re, socket, threading, time, urllib.error, urllib.request, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get('SKY3D_RELAY_PORT', '8099'))
WEB = os.environ.get('SKY3D_WEB', 'http://127.0.0.1:80').rstrip('/')        # the receiver's own web server
PAGE = os.environ.get('SKY3D_PAGE', '/var/www/html/sky/index.html')          # the 3D sky page on this receiver
ORIGINS = set(o.strip().lower() for o in os.environ.get('SKY3D_RELAY_ORIGINS', '').split(',') if o.strip())   # other sites allowed to use this relay, if any
VIEWER_HEADER = os.environ.get('SKY3D_VIEWER_HEADER', 'CF-Connecting-IP')   # how the tunnel names the viewer a request is for
AGENT = 'Mozilla/5.0 (compatible; 3d-sky-relay; +https://github.com/Deaconcg65/sky3d)'
NETWORKS = [
    ('adsb.lol', 'https://api.adsb.lol/v2/point/{0}/{1}/{2}', 'https://api.adsb.lol/v2/callsign/{0}', 'https://api.adsb.lol/v2/reg/{0}'),
    ('adsb.fi', 'https://opendata.adsb.fi/api/v2/lat/{0}/lon/{1}/dist/{2}', 'https://opendata.adsb.fi/api/v2/callsign/{0}', 'https://opendata.adsb.fi/api/v2/registration/{0}'),
    ('airplanes.live', 'https://api.airplanes.live/v2/point/{0}/{1}/{2}', 'https://api.airplanes.live/v2/callsign/{0}', 'https://api.airplanes.live/v2/reg/{0}'),
    ('adsb.one', 'https://api.adsb.one/v2/point/{0}/{1}/{2}', 'https://api.adsb.one/v2/callsign/{0}', 'https://api.adsb.one/v2/reg/{0}'),
]
TEST = os.environ.get('SKY3D_RELAY_TEST')   # for testing only: one stand-in network at this address
if TEST:
    NETWORKS = [('stand-in', TEST + '/v2/point/{0}/{1}/{2}', TEST + '/v2/callsign/{0}', TEST + '/v2/reg/{0}')]

A = re.ASCII
POINT = re.compile(r'/v2/point/(-?[0-9]{1,2}(?:\.[0-9]{1,4})?)/(-?[0-9]{1,3}(?:\.[0-9]{1,4})?)/([0-9]{1,3})', A)
CALLSIGN = re.compile(r'/v2/callsign/([A-Za-z0-9]{2,8})', A)
REG = re.compile(r'/v2/reg/([A-Za-z0-9-]{2,8})', A)
# What the page reads from the receiver's own web server. Nothing outside these patterns is ever fetched from it.
AIRCRAFT = re.compile(r'/(?:tar1090/data|data|skyaware/data)/aircraft\.json', A)
RECEIVER = re.compile(r'/(?:tar1090/data|data|skyaware/data)/receiver\.json', A)
CHUNKS = re.compile(r'/tar1090/chunks/chunks\.json', A)
CHUNK = re.compile(r'/tar1090/chunks/[A-Za-z0-9_]{1,40}\.gz', A)
VERSION = re.compile(r'/tar1090/version\.json', A)
TABLE = re.compile(r'/tar1090/db-[A-Za-z0-9]{1,40}/[A-Za-z0-9_]{1,40}\.js', A)
ORIGIN = re.compile(r'https?://([a-z0-9.-]{1,253}|\[[0-9a-f:.]{2,45}\])(?::[0-9]{1,5})?', A)
HOST = re.compile(r'([a-z0-9.-]{1,253}|\[[0-9a-f:.]{2,45}\])(?::[0-9]{1,5})?', A)
# The only facts about an aircraft that are handed on, from the antenna or from a flight network: which aircraft it is,
# where it is, how high, how fast and which way. A receiver also records how far each aircraft is from the antenna, in
# which direction, how strong its signal is, and a rough position guessed from the antenna's own. None of those are
# in this list, so none of them can leave the house.
AIRCRAFT_FACTS = ('hex', 'type', 'flight', 'r', 't', 'desc', 'category', 'alt_baro', 'alt_geom', 'gs', 'tas', 'track', 'true_heading',
                  'baro_rate', 'geom_rate', 'lat', 'lon', 'seen', 'seen_pos', 'squawk', 'emergency')
RECEIVER_FACTS = ('version', 'refresh', 'history')
VERSION_FACTS = ('databaseVersion', 'tar1090Version')

KEEP_SECONDS = 4.0      # people watching the same sky share one answer for this long
STALE_SECONDS = 30.0    # when the flight networks cannot be asked again yet, an answer up to this old is handed out, marked with its age
FAILED_SECONDS = 10.0   # a question no flight network could answer is not asked again for this long
NET_RATE, NET_BURST = float(os.environ.get('SKY3D_NET_RATE', '0.75')), 6          # questions a second to the flight networks about an area, for all viewers together
LOOK_RATE, LOOK_BURST = float(os.environ.get('SKY3D_LOOK_RATE', '0.25')), 4       # the same for single flights, kept apart so one cannot starve the other
VIEWER_RATE, VIEWER_BURST = float(os.environ.get('SKY3D_VIEWER_RATE', '5')), 150  # requests a second from one viewer; the page itself needs about one and a half
ASK_RATE, ASK_BURST = float(os.environ.get('SKY3D_ASK_RATE', '0.5')), 5           # new questions to the flight networks one viewer may cause; the page needs under half that
MAX_BODY = 8 * 1024 * 1024
MAX_AT_ONCE = 48        # requests being answered at once
MAX_CONNECTIONS = 96    # connections open at once


class Bucket:
    """An allowance that refills steadily: take() says whether one more request is allowed right now."""
    def __init__(self, rate, burst):
        self.rate, self.burst, self.tokens, self.t = rate, burst, float(burst), time.monotonic()

    def take(self):
        now = time.monotonic()
        self.tokens = min(self.burst, self.tokens + (now - self.t) * self.rate)
        self.t = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


lock = threading.Lock()
kept, failed, best = {}, {}, [0]         # flight network answers by question, questions nobody could answer, and which network answered last
net_bucket, look_bucket = Bucket(NET_RATE, NET_BURST), Bucket(LOOK_RATE, LOOK_BURST)
viewers = {}                             # allowances per viewer; held in memory only and never written down
local, local_failed, locks = {}, {}, {}  # antenna data fetched from the receiver's web server, and one lock per question
page = {'key': None, 'raw': b'', 'gz': b'', 'etag': ''}
checked = [0.0, '']
slots = threading.BoundedSemaphore(MAX_AT_ONCE)
connections = threading.BoundedSemaphore(MAX_CONNECTIONS)
inward = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())   # to the receiver's own web server: asked directly, and only it
outward = urllib.request.build_opener(NoRedirect())                                   # to the flight networks: an answer that points somewhere else is not followed


def lock_for(key):
    with lock:
        if len(locks) > 400:
            for k in [k for k, v in locks.items() if not v.locked()]:
                del locks[k]
        return locks.setdefault(key, threading.Lock())


def facts(aircraft):
    """Keep only the listed facts about each aircraft."""
    return [{k: a[k] for k in AIRCRAFT_FACTS if k in a and isinstance(a[k], (str, int, float))} for a in aircraft if isinstance(a, dict)]


def ask(address):
    """Ask one flight network. Returns (worked, status, text, how many aircraft). The text is rebuilt from the listed
    facts only, so nothing else a network sends is ever handed on."""
    try:
        with outward.open(urllib.request.Request(address, headers={'Accept': 'application/json', 'User-Agent': AGENT}), timeout=6) as answer:
            status, text = answer.status, answer.read(MAX_BODY).decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return False, e.code, '', None
    except Exception as e:   # the network is down, slow, or not reachable
        return False, 0, str(e)[:160], None
    try:
        data = json.loads(text)
        aircraft = data.get('ac', data.get('aircraft')) if isinstance(data, dict) else None
    except ValueError:
        aircraft = None
    if not isinstance(aircraft, list):
        return False, status, '', None
    now = data.get('now')
    out = {'ac': facts(aircraft), 'now': now if isinstance(now, (int, float)) else 0}
    return True, status, json.dumps(out, separators=(',', ':')), len(out['ac'])


def from_web(path):
    """Fetch one file from the receiver's own web server. Returns (status, bytes, whether the bytes are gzip)."""
    try:
        with inward.open(urllib.request.Request(WEB + path, headers={'User-Agent': AGENT, 'Accept-Encoding': 'identity'}), timeout=4) as answer:
            body = answer.read(MAX_BODY)
            return answer.status, body, (answer.headers.get('Content-Encoding') or '').lower() == 'gzip' or body[:2] == b'\x1f\x8b'
    except urllib.error.HTTPError as e:
        return e.code, b'', False
    except Exception:
        return 0, b'', False


def number(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else 0


def tidy(kind, data):
    """Rebuild a file from the receiver so that it holds only what the page needs. Anything not named here is dropped."""
    if not isinstance(data, dict):
        raise ValueError('not the expected shape')
    if kind == 'aircraft':
        return {'now': number(data.get('now')), 'messages': number(data.get('messages')), 'aircraft': facts(data.get('aircraft') or [])}
    if kind == 'receiver':
        return {k: data[k] for k in RECEIVER_FACTS if isinstance(data.get(k), (str, int, float))}
    if kind == 'version':
        return {k: data[k] for k in VERSION_FACTS if isinstance(data.get(k), (str, int, float))}
    if kind == 'chunks':
        names = [n for n in (data.get('chunks') or []) if isinstance(n, str) and re.fullmatch(r'[A-Za-z0-9_]{1,40}\.gz', n, A)]
        return {'chunks': names[-12:]}
    if kind == 'chunk':   # history: for each moment, each aircraft as [hex, height, speed, track, latitude, longitude, age of position]
        files = []
        for f in (data.get('files') or [])[:400]:
            if isinstance(f, dict) and isinstance(f.get('aircraft'), list):
                rows = [[x if isinstance(x, (str, int, float)) else None for x in a[:7]] for a in f['aircraft'] if isinstance(a, list)]
                files.append({'now': number(f.get('now')), 'aircraft': rows})
        return {'files': files}
    raise ValueError('unknown kind')


def with_age(text, age):
    """Mark an answer with how many seconds old it is, so the page can place each aircraft where it is now."""
    if age < 0.05 or not text.startswith('{"ac":'):
        return text
    return '{"relay_age":%.1f,' % age + text[1:]


class Relay(BaseHTTPRequestHandler):
    server_version = '3d-sky'
    sys_version = ''
    timeout = 10

    # ---------- answering ----------
    def reply(self, status, body, kind='application/json; charset=utf-8', extra=None, gz=None):
        data = body if isinstance(body, bytes) else body.encode('utf-8')
        headers = dict(extra or {})
        wants_gzip = 'gzip' in (self.headers.get('Accept-Encoding') or '').lower()
        if gz is not None:                       # the caller holds a gzip copy
            if wants_gzip:
                data, headers['Content-Encoding'] = gz, 'gzip'
            elif not data:
                data = gzip.decompress(gz)
        elif wants_gzip and len(data) > 1400 and 'Content-Encoding' not in headers:
            data, headers['Content-Encoding'] = gzip.compress(data, 5), 'gzip'
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Robots-Tag', 'noindex, nofollow')
        headers.setdefault('Cache-Control', 'no-store')
        headers.setdefault('Vary', 'Accept-Encoding, Origin')
        if getattr(self, 'cors', None):
            headers['Access-Control-Allow-Origin'] = self.cors
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)

    def say(self, status, words, extra=None):
        self.reply(status, words, 'text/plain; charset=utf-8', extra)

    # ---------- who is asking ----------
    def who(self):
        """Returns (a name for this viewer, whether they count as outside the house).

        Through a tunnel every request arrives from this receiver itself, and the tunnel names the viewer in a header.
        That header is believed only then. Anything that arrives from this receiver itself, or carries a forwarding
        header of any kind, counts as outside: when in doubt, a viewer is treated as a stranger."""
        peer = self.client_address[0].split('%')[0]
        try:
            ip = ipaddress.ip_address(peer)
            ip = getattr(ip, 'ipv4_mapped', None) or ip
        except ValueError:
            return 'unknown', True
        forwarded = any(self.headers.get(h) for h in (VIEWER_HEADER, 'CF-Connecting-IP', 'X-Forwarded-For', 'Forwarded', 'X-Real-IP'))
        if ip.is_loopback:
            try:
                named = ipaddress.ip_address((self.headers.get(VIEWER_HEADER) or '').strip())
                # one household usually holds a whole block of the newer, longer addresses, so those are counted by the block
                return (str(ipaddress.ip_network((named, 64), strict=False)) if named.version == 6 else str(named)), True
            except ValueError:
                return 'tunnel', True
        return str(ip), forwarded or not (ip.is_private or ip.is_link_local)

    def origin_ok(self):
        """A page on another site may not use this relay. A page from the same address may, whatever the port."""
        origin = (self.headers.get('Origin') or '').strip().lower()
        if not origin:
            return True
        o, h = ORIGIN.fullmatch(origin), HOST.fullmatch((self.headers.get('Host') or '').strip().lower())
        if o and (origin in ORIGINS or (h and o.group(1) == h.group(1))):
            self.cors = origin
            return True
        return False

    def allowances(self, viewer):
        with lock:
            if len(viewers) > 4000:
                now = time.monotonic()
                for old in [k for k, b in viewers.items() if now - b[0].t > 120]:
                    del viewers[old]
                if len(viewers) > 4000:   # still too many: let go of the ones that have been quiet longest
                    for old in sorted(viewers, key=lambda k: viewers[k][0].t)[:1000]:
                        del viewers[old]
            return viewers.setdefault(viewer, (Bucket(VIEWER_RATE, VIEWER_BURST), Bucket(ASK_RATE, ASK_BURST)))

    # ---------- the requests ----------
    def do_OPTIONS(self):
        self.cors = None
        if not self.origin_ok():
            return self.say(403, 'This relay answers only the 3D sky page it came with.')
        self.send_response(204)
        if self.cors:
            self.send_header('Access-Control-Allow-Origin', self.cors)
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Max-Age', '86400')
        self.send_header('Vary', 'Origin')
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        self.cors = None
        if not slots.acquire(blocking=False):
            try:
                return self.say(503, 'Busy. Try again in a moment.', {'Retry-After': '2'})
            except Exception:
                return
        try:
            self.serve()
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            pass
        except Exception:
            try:
                self.say(500, 'Something went wrong.')
            except Exception:
                pass
        finally:
            slots.release()

    def serve(self):
        if len(self.path) > 300:
            return self.say(404, 'Not found')
        path = self.path.split('?', 1)[0]
        viewer, outside = self.who()
        general, asking = self.allowances(viewer)
        with lock:
            allowed = general.take()
        if not allowed:
            return self.say(429, 'Too many requests. Try again in a moment.', {'Retry-After': '2'})
        if not self.origin_ok():
            return self.say(403, 'This relay answers only the 3D sky page it came with.')
        # the front door
        if path in ('/', '/sky', '/index.html'):
            return self.say(302, 'The 3D sky page is at /sky/', {'Location': '/sky/'})
        if path in ('/sky/', '/sky/index.html'):
            return self.send_page()
        if path == '/robots.txt':
            return self.say(200, 'User-agent: *\nDisallow: /\n', {'Cache-Control': 'public, max-age=86400'})
        if path == '/favicon.ico':
            return self.say(204, '', {'Cache-Control': 'public, max-age=86400'})
        # the antenna's own data, from the receiver's web server
        if AIRCRAFT.fullmatch(path):
            return self.send_local(path, 'aircraft', 0.9)
        if RECEIVER.fullmatch(path):
            return self.send_local(path, 'receiver', 300)
        if CHUNKS.fullmatch(path):
            return self.send_local(path, 'chunks', 20)
        if CHUNK.fullmatch(path):
            return self.send_local(path, 'chunk', 600 if path.rsplit('/', 1)[1].startswith('chunk_') else 20)
        if VERSION.fullmatch(path):
            return self.send_local(path, 'version', 300)
        if TABLE.fullmatch(path):
            return self.send_table(path)
        # the relay
        if path.startswith('/sky-relay'):   # when the page is shared through a secure tunnel, the relay is reached under this name
            path = path[len('/sky-relay'):] or '/'
        if path == '/':
            return self.say(200, '3D sky relay is running.')
        if path == '/check' and not outside:   # which flight networks answer this relay. Only from another computer inside the house.
            return self.send_check()
        status, body, extra = self.network_answer(path, asking)
        self.reply(status, body, extra=extra) if status != 404 else self.say(404, 'Not found')

    def send_page(self):
        try:
            st = os.stat(PAGE)
            key = (st.st_mtime_ns, st.st_size)
            with lock:
                if page['key'] != key:
                    with open(PAGE, 'rb') as f:
                        raw = f.read(MAX_BODY)
                    page.update(key=key, raw=raw, gz=gzip.compress(raw, 6), etag='"%x-%x"' % key)
                raw, gz, etag = page['raw'], page['gz'], page['etag']
        except OSError:
            return self.say(404, 'The 3D sky page is not installed on this receiver.')
        extra = {'Cache-Control': 'no-cache', 'ETag': etag, 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN'}
        have = (self.headers.get('If-None-Match') or '').strip()
        if (have[2:] if have.startswith('W/') else have) == etag:
            self.send_response(304)
            for k, v in extra.items():
                self.send_header(k, v)
            self.end_headers()
            return
        self.reply(200, raw, 'text/html; charset=utf-8', extra, gz=gz)

    def send_local(self, path, kind, keep):
        mine = lock_for('web ' + path)
        if not mine.acquire(timeout=1):   # the receiver's web server is slow or stuck: say so quickly, without queueing up
            return self.say(502, 'The receiver did not answer.')
        try:
            now = time.monotonic()
            with lock:
                hit, bad = local.get(path), local_failed.get(path)
            if not hit or now - hit[0] >= keep:
                if bad and now - bad < 3:
                    return self.say(502, 'The receiver did not answer.')
                status, body, zipped = from_web(path)
                try:
                    if status != 200:
                        raise ValueError(status)
                    data = tidy(kind, json.loads(gzip.decompress(body) if zipped else body))
                except (ValueError, OSError, EOFError, zlib.error):
                    with lock:
                        if len(local_failed) > 200:
                            local_failed.clear()
                        local_failed[path] = time.monotonic()
                    return self.say(404 if status == 404 else 502, 'Not found' if status == 404 else 'The receiver did not answer.')
                hit = (time.monotonic(), gzip.compress(json.dumps(data, separators=(',', ':')).encode('utf-8'), 5))
                with lock:
                    for old in [k for k, v in local.items() if hit[0] - v[0] > 900]:
                        del local[old]
                    local[path] = hit
        finally:
            mine.release()
        self.reply(200, b'', gz=hit[1], extra={'Cache-Control': 'public, max-age=300'} if keep >= 600 else None)

    def send_table(self, path):
        status, body, zipped = from_web(path)
        if status != 200:
            return self.say(404 if status == 404 else 502, 'Not found' if status == 404 else 'The receiver did not answer.')
        extra = {'Cache-Control': 'public, max-age=86400'}
        if zipped:
            extra['Content-Encoding'] = 'gzip'
        self.reply(200, body, 'application/json; charset=utf-8', extra)

    def send_check(self):
        with lock:
            recent = checked[1] if time.monotonic() - checked[0] < 30 and checked[1] else ''
        if not recent:
            report = {}
            for name, point, _, _ in NETWORKS:
                started = time.time()
                worked, status, text, count = ask(point.format('40.7', '-73.8', '5'))
                report[name] = {'answered': worked, 'status': status, 'milliseconds': int((time.time() - started) * 1000), 'aircraft': count, 'says': '' if worked else text[:160]}
            recent = json.dumps(report, indent=1)
            with lock:
                checked[0], checked[1] = time.monotonic(), recent
        self.reply(200, recent)

    def network_answer(self, path, asking):
        """Returns (status, text, extra headers) for one question to the flight networks. Nothing is sent from here,
        so no slow reader can hold up other people asking the same question."""
        m = POINT.fullmatch(path)
        if m:
            # Questions are rounded to a tenth of a degree and five nautical miles, so nearby viewers share one answer
            # and no exact position ever reaches a flight network.
            lat, lon, dist = float(m.group(1)), float(m.group(2)), int(m.group(3))
            if abs(lat) > 90 or abs(lon) > 180:
                return 404, '', None
            which, values, bucket = 1, ('%.1f' % lat, '%.1f' % lon, str(min(150, max(5, -(-dist // 5) * 5)))), net_bucket
        else:
            m = CALLSIGN.fullmatch(path)
            if m:
                which, values, bucket = 2, (m.group(1).upper(),), look_bucket
            else:
                m = REG.fullmatch(path)
                if not m:
                    return 404, '', None
                which, values, bucket = 3, (m.group(1).upper(),), look_bucket
        key = '%d/%s' % (which, '/'.join(values))

        def last(limit):   # the last answer to this question, if it is younger than the limit
            with lock:
                hit = kept.get(key)
            if hit is not None and time.monotonic() - hit[0] < limit:
                return 200, with_age(hit[1], time.monotonic() - hit[0]), {'X-Flight-Network': hit[2]}
            return None

        busy = (503, json.dumps({'error': 'The relay has asked the flight networks as often as it may for now.'}), {'Retry-After': '5'})
        mine = lock_for('net ' + key)
        if not mine.acquire(blocking=False):   # someone else is already asking this very question
            answer = last(STALE_SECONDS)
            if answer:
                return answer
            if not mine.acquire(timeout=10):
                return busy
        try:
            answer = last(KEEP_SECONDS)
            if answer:
                return answer
            with lock:
                bad = failed.get(key)
                recently_failed = bad is not None and time.monotonic() - bad < FAILED_SECONDS
                may_ask = not recently_failed and asking.take() and bucket.take()
            tried = []
            if may_ask:
                for i in range(len(NETWORKS)):
                    if i:   # every further network tried counts against the allowance too
                        with lock:
                            if not bucket.take():
                                break
                    index = (best[0] + i) % len(NETWORKS)
                    network = NETWORKS[index]
                    worked, status, text, _ = ask(network[which].format(*values))
                    if worked:
                        with lock:
                            now = time.monotonic()
                            best[0] = index
                            kept[key] = (now, text, network[0])
                            failed.pop(key, None)
                            for old in [k for k, v in kept.items() if now - v[0] > 45]:
                                del kept[old]
                        return 200, text, {'X-Flight-Network': network[0]}
                    tried.append('%s %s' % (network[0], status))
                with lock:
                    now = time.monotonic()
                    for old in [k for k, v in failed.items() if now - v > FAILED_SECONDS]:
                        del failed[old]
                    failed[key] = now
            answer = last(STALE_SECONDS)   # better the last answer, marked with its age, than none
            if answer:
                return answer
            if may_ask or recently_failed:
                return 502, json.dumps({'error': 'The flight networks did not answer.', 'tried': tried}), None
            return busy
        finally:
            mine.release()

    def log_message(self, *args):   # nothing about viewers or what they ask is written down
        pass


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64

    def process_request(self, request, client_address):
        if not connections.acquire(blocking=False):   # too many connections open: turn this one away at once
            return self.shutdown_request(request)
        try:
            super().process_request(request, client_address)
        except Exception:
            connections.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            connections.release()

    def handle_error(self, request, client_address):   # a broken or abandoned request is not worth a line in the log, and its address is not written down
        pass


class Server6(Server):
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        super().server_bind()


if __name__ == '__main__':
    server = Server(('0.0.0.0', PORT), Relay)
    try:   # a tunnel program on this receiver may look for "localhost" at its newer-style address first, so listen there as well
        also = Server6(('::1', PORT), Relay)
        threading.Thread(target=also.serve_forever, daemon=True).start()
    except OSError:
        pass
    server.serve_forever()
