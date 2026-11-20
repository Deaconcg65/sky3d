#!/usr/bin/env python3
"""3D sky relay and front door.

This small program runs on the receiver itself and does two jobs.

1. Relay. Web browsers are not allowed to read the free flight networks directly, because those networks do not give web
   pages that permission. The 3D sky page asks the relay, the relay asks a flight network over the home internet
   connection, and the relay hands the answer back. It passes on only four kinds of question: aircraft around a point,
   one flight by callsign, one aircraft by registration, and (since version 3.7) a typed place, which it looks up with the
   OpenStreetMap place finder (Nominatim) so that the place finder sees this receiver's address instead of each viewer's.
   For a place, only the words the viewer typed are sent, at most one question a second and about 200 an hour for everyone
   together, and answers are kept for a day so the same words are not sent twice.
   Since version 3.9 it also asks the route services (adsb.im, then ADSB.lol) where flights are going, for up to ten
   flights at a time, because web pages are not always allowed to ask them directly either. Only each flight's callsign
   and roughly where it is (to a hundredth of a degree) are sent. A route found is kept for six hours and a flight no
   service knows for ten minutes, so the same flight is not asked about again meanwhile.
   Since version 3.11 it also asks Planespotters.net for a photo of one aircraft, by its transponder code (and, when that
   finds none, its registration). Only those two are sent. A photo found is kept for a day and an aircraft with none for
   six hours, and Planespotters is asked at most about once every two seconds for everyone together. The relay hands on
   only the photo's address, its size, the photographer's name and the address of its page on Planespotters, which the
   page must show with the photo. The photo itself is then loaded by the viewer's browser from Planespotters.

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
import gzip, ipaddress, json, math, os, re, socket, threading, time, unicodedata, urllib.error, urllib.parse, urllib.request, zlib
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
# The place finder. Its rules: no more than one request a second, a name for the program that asks, answers kept and not
# asked for again, and no searching as someone types. The page asks only when the viewer presses Enter or Find.
PLACES = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q={0}'
# The route services, asked in this order. When neither answers at all, the route table they are both built from is read
# instead, a few flights at a time; that table cannot say whether a route fits where the aircraft is, so it is used only then.
ROUTE_SERVICES = [('adsb.im', 'https://adsb.im/api/0/routeset'), ('adsb.lol', 'https://api.adsb.lol/api/0/routeset')]
STANDING = 'https://vrs-standing-data.adsb.lol/routes/{0}/{1}.json'
# Aircraft photos (version 3.11). No key or account is needed; each photo must be shown with its photographer's name and a
# link to its page on Planespotters.
PHOTOS_HEX = 'https://api.planespotters.net/pub/photos/hex/{0}'
PHOTOS_REG = 'https://api.planespotters.net/pub/photos/reg/{0}'
TEST = os.environ.get('SKY3D_RELAY_TEST')   # for testing only: one stand-in network at this address
if TEST:
    NETWORKS = [('stand-in', TEST + '/v2/point/{0}/{1}/{2}', TEST + '/v2/callsign/{0}', TEST + '/v2/reg/{0}')]
    PLACES = TEST + '/search?format=jsonv2&limit=5&q={0}'
    ROUTE_SERVICES = [('stand-in', TEST + '/routeset')]
    STANDING = TEST + '/standing/{0}/{1}.json'
    PHOTOS_HEX, PHOTOS_REG = TEST + '/photos/hex/{0}', TEST + '/photos/reg/{0}'

A = re.ASCII
POINT = re.compile(r'/v2/point/(-?[0-9]{1,2}(?:\.[0-9]{1,4})?)/(-?[0-9]{1,3}(?:\.[0-9]{1,4})?)/([0-9]{1,3})', A)
CALLSIGN = re.compile(r'/v2/callsign/([A-Za-z0-9]{2,8})', A)
REG = re.compile(r'/v2/reg/([A-Za-z0-9-]{2,8})', A)
ROUTE_ITEM = r'([A-Z0-9]{2,8}),(-?[0-9]{1,2}(?:\.[0-9]{1,2})?),(-?[0-9]{1,3}(?:\.[0-9]{1,2})?)'
ROUTES = re.compile(r'/routes/(%s(?:;%s){0,9})' % (ROUTE_ITEM, ROUTE_ITEM), A)   # up to ten flights: callsign, latitude, longitude
PHOTO = re.compile(r'/photo/([0-9a-f]{6})(?:/([A-Z0-9-]{2,10}))?', A)   # one aircraft: its transponder code, and its registration when known
PHOTO_SRC = re.compile(r'https://[a-z0-9.-]{1,60}\.plnspttrs\.net/[A-Za-z0-9/_.-]{1,200}', A)   # where Planespotters keeps its photos
PHOTO_PAGE = re.compile(r'https://www\.planespotters\.net/photo/[A-Za-z0-9/_.-]{1,200}', A)
PLACE = re.compile(r"/place/([A-Za-z0-9%._~!$&'()*+,;=:@-]{1,280})", A)   # the typed words, as the page encodes them
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
AIRCRAFT_FACTS = ('hex', 'type', 'flight', 'r', 't', 'desc', 'category', 'dbFlags', 'alt_baro', 'alt_geom', 'gs', 'tas', 'track', 'true_heading',
                  'baro_rate', 'geom_rate', 'lat', 'lon', 'seen', 'seen_pos', 'squawk', 'emergency')
RECEIVER_FACTS = ('version', 'refresh', 'history')
VERSION_FACTS = ('databaseVersion', 'tar1090Version')

KEEP_SECONDS = 4.0      # people watching the same sky share one answer for this long
STALE_SECONDS = 30.0    # when the flight networks cannot be asked again yet, an answer up to this old is handed out, marked with its age
FAILED_SECONDS = 10.0   # a question no flight network could answer is not asked again for this long
NETWORK_REST = 300.0    # a flight network that just refused or timed out is tried after the others for this long
NET_RATE, NET_BURST = float(os.environ.get('SKY3D_NET_RATE', '0.75')), 6          # questions a second to the flight networks about an area, for all viewers together
LOOK_RATE, LOOK_BURST = float(os.environ.get('SKY3D_LOOK_RATE', '0.25')), 4       # the same for single flights, kept apart so one cannot starve the other
VIEWER_RATE, VIEWER_BURST = float(os.environ.get('SKY3D_VIEWER_RATE', '5')), 150  # requests a second from one viewer; the page itself needs about one and a half
ASK_RATE, ASK_BURST = float(os.environ.get('SKY3D_ASK_RATE', '0.5')), 5           # new questions to the flight networks one viewer may cause; the page needs under half that
PLACE_RATE, PLACE_BURST = 1.0, 1          # questions a second to the place finder, for all viewers together: its own limit
PLACE_HOURLY = 200                         # and about this many an hour, so nobody can turn the relay into a heavy user of it
PLACE_KEEP = 24 * 3600.0                   # a place found is kept this long, and the same words are not sent again meanwhile
ROUTE_RATE, ROUTE_BURST = 0.5, 10        # questions a second to the route services, for all viewers together
ROUTE_VIEWER_RATE, ROUTE_VIEWER_BURST = 0.25, 5   # route questions one viewer may cause, half of all, so no one viewer can use up the rest
ROUTE_KEEP, ROUTE_NONE = 6 * 3600.0, 600.0   # a route found is kept this long; a flight no service knows is not asked about again for this long
PHOTO_RATE, PHOTO_BURST = 0.5, 4          # questions a second to Planespotters, for all viewers together
PHOTO_KEEP, PHOTO_NONE = 24 * 3600.0, 6 * 3600.0   # a photo found is kept a day; an aircraft with none is not asked about again for six hours
MAX_BODY = 8 * 1024 * 1024
MAX_AT_ONCE = 48        # requests being answered at once
MAX_CONNECTIONS = 96    # connections open at once


class Bucket:
    """An allowance that refills steadily: take() says whether one more request is allowed right now."""
    def __init__(self, rate, burst):
        self.rate, self.burst, self.tokens, self.t = rate, burst, float(burst), time.monotonic()

    def ready(self):
        """Whether one more request would be allowed right now, without taking it."""
        now = time.monotonic()
        self.tokens = min(self.burst, self.tokens + (now - self.t) * self.rate)
        self.t = now
        return self.tokens >= 1

    def take(self):
        if self.ready():
            self.tokens -= 1
            return True
        return False


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


lock = threading.Lock()
kept, failed, best = {}, {}, [0]         # flight network answers by question, questions nobody could answer, and which network answered last
network_down = {}                        # when each flight network last refused or timed out, by its place in NETWORKS
net_bucket, look_bucket = Bucket(NET_RATE, NET_BURST), Bucket(LOOK_RATE, LOOK_BURST)
place_bucket, place_hour = Bucket(PLACE_RATE, PLACE_BURST), Bucket(PLACE_HOURLY / 3600.0, 20)
route_bucket = Bucket(ROUTE_RATE, ROUTE_BURST)
photo_bucket = Bucket(PHOTO_RATE, PHOTO_BURST)
photos_kept, photos_failed = {}, {}     # photo answers by transponder code (or code/registration), and those Planespotters could not answer just now
routes_kept = {}                         # routes by callsign: (when, the route or None)
places_kept, places_failed = {}, {}     # place answers by the typed words, and words the place finder could not answer just now
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
    """Keep only the listed facts about each aircraft. Of the record flags (dbFlags) only the military mark is passed on
    (version 3.12, for the military paint); the others, such as an owner's request for privacy, are dropped."""
    out = []
    for a in aircraft:
        if not isinstance(a, dict):
            continue
        f = {k: a[k] for k in AIRCRAFT_FACTS if k in a and isinstance(a[k], (str, int, float))}
        if 'dbFlags' in f:
            try:
                f['dbFlags'] = int(f['dbFlags']) & 1
            except (TypeError, ValueError, OverflowError):
                del f['dbFlags']
        out.append(f)
    return out


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


def place_words(encoded):
    """The typed words from the address the page asked for, tidied, or None when they are not something to look up."""
    try:
        text = urllib.parse.unquote(encoded, errors='strict')
    except UnicodeDecodeError:
        return None
    text = ' '.join(text.split())
    if not 2 <= len(text) <= 100 or any(unicodedata.category(c)[0] == 'C' for c in text):
        return None
    return text


def ask_places(text):
    """Ask the place finder. Returns (worked, status, text). The answer is rebuilt from a name and a position for each
    place, so nothing else the place finder sends is ever handed on."""
    headers = {'Accept': 'application/json', 'Accept-Language': 'en', 'User-Agent': AGENT}
    try:
        with outward.open(urllib.request.Request(PLACES.format(urllib.parse.quote(text, safe='')), headers=headers), timeout=8) as answer:
            status, raw = answer.status, answer.read(1024 * 1024).decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return False, e.code, ''
    except Exception:   # the place finder is down, slow, or not reachable
        return False, 0, ''
    try:
        data = json.loads(raw)
    except ValueError:
        return False, status, ''
    if not isinstance(data, list):
        return False, status, ''
    out = []
    for p in data[:5]:
        if not isinstance(p, dict) or not isinstance(p.get('display_name'), str) or not p['display_name'].strip():
            continue
        try:
            lat, lon = float(p.get('lat')), float(p.get('lon'))
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(lat) and math.isfinite(lon) and abs(lat) <= 90 and abs(lon) <= 180):
            continue
        kind = p.get('type') if isinstance(p.get('type'), str) else ''
        out.append({'name': ' '.join(p['display_name'].split())[:160], 'lat': round(lat, 5), 'lon': round(lon, 5), 'kind': kind[:30]})
    return True, status, json.dumps({'places': out}, separators=(',', ':'))


def photo_of(raw):
    """The first usable photo in a Planespotters answer, rebuilt from its address, size, photographer and page only,
    or None when it has none. Anything that is not where Planespotters keeps its photos and pages is dropped."""
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    photos = data.get('photos') if isinstance(data, dict) else None
    for ph in photos if isinstance(photos, list) else []:
        if not isinstance(ph, dict):
            continue
        for size in ('thumbnail_large', 'thumbnail'):
            t = ph.get(size)
            if not isinstance(t, dict) or not isinstance(t.get('src'), str) or not PHOTO_SRC.fullmatch(t['src']):
                continue
            link, by = ph.get('link'), ph.get('photographer')
            if not isinstance(link, str) or not PHOTO_PAGE.fullmatch(link) or not isinstance(by, str):
                break
            dims = t.get('size') if isinstance(t.get('size'), dict) else {}
            w, h = dims.get('width'), dims.get('height')
            return {'src': t['src'], 'w': w if isinstance(w, int) and 0 < w < 5000 else None, 'h': h if isinstance(h, int) and 0 < h < 5000 else None,
                    'link': link, 'by': ' '.join(by.split())[:80]}
    return None


def ask_photo_once(url):
    """Ask Planespotters one question. Returns (worked, photo or None)."""
    try:
        with outward.open(urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': AGENT}), timeout=8) as answer:
            raw = answer.read(512 * 1024).decode('utf-8', 'replace')
    except Exception:   # refused, slow, or not reachable
        return False, None
    return True, photo_of(raw)


def ask_photo(hexid, reg):
    """Ask Planespotters for a photo of one aircraft, by hex code and then by registration. Returns (worked, photo or None)."""
    worked, found = ask_photo_once(PHOTOS_HEX.format(hexid))
    if worked and not found and reg:
        worked, found = ask_photo_once(PHOTOS_REG.format(urllib.parse.quote(reg, safe='')))
    return worked, found


def airport(a):
    """One airport of a route, rebuilt from its names and position only."""
    if not isinstance(a, dict):
        return None
    try:
        lat, lon = float(a.get('lat')), float(a.get('lon'))
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(lat) and math.isfinite(lon) and abs(lat) <= 90 and abs(lon) <= 180):
        return None
    out = {k: ' '.join(a[k].split())[:80] for k in ('name', 'location', 'iata', 'icao') if isinstance(a.get(k), str)}
    out.update(lat=round(lat, 5), lon=round(lon, 5))
    return out


def route_of(x, judged=True):
    """A route as the page reads it, or None when it is not one to show: two or more airports, and not marked by the
    service as impossible for where the aircraft is."""
    if not isinstance(x, dict) or not isinstance(x.get('_airports'), list):
        return None
    aps = [airport(a) for a in x['_airports'][:8]]
    if len(aps) < 2 or not all(aps) or (judged and x.get('plausible') in (False, 0)):
        return None
    return {'airport_codes': '-'.join(a.get('icao') or a.get('iata') or '?' for a in aps), '_airports': aps}


def post_routes(url, flights):
    """Ask one route service about some flights. Returns its answers by callsign, or None when it did not answer."""
    body = json.dumps({'planes': [{'callsign': c, 'lat': la, 'lng': lo} for c, la, lo in flights]}).encode('utf-8')
    headers = {'Accept': 'application/json', 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': AGENT}
    try:
        with outward.open(urllib.request.Request(url, data=body, headers=headers, method='POST'), timeout=8) as answer:
            data = json.loads(answer.read(1024 * 1024).decode('utf-8', 'replace'))
    except Exception:   # the service is down, slow, refuses, or sent something that is not JSON
        return None
    if not isinstance(data, list):
        return None
    return {x.get('callsign'): x for x in data if isinstance(x, dict) and isinstance(x.get('callsign'), str)}


def ask_routes(flights):
    """Ask the route services about some flights, given as (callsign, latitude, longitude). Returns (found, unknown,
    doubted): the routes found by callsign, the callsigns a service answered for with no route at all, and the callsigns
    whose route a service judged impossible for the position given. A flight in none of these was not answered for.
    Only "unknown" may be remembered by callsign alone: "doubted" depends on the position the asker sent, and anyone
    can send any position. Only the callsigns and positions are sent."""
    found, unknown, doubted, answered = {}, set(), set(), False
    left = list(flights)
    for _, url in ROUTE_SERVICES:
        if not left:
            break
        with lock:
            if not route_bucket.take():
                break
        got = post_routes(url, left)
        if got is None:
            continue
        answered = True
        for c, _, _ in left:
            r = route_of(got.get(c))
            if r:
                found[c] = r
                doubted.discard(c)
            elif route_of(got.get(c), judged=False):
                doubted.add(c)   # the service has a route, but not one this position fits
        left = [f for f in left if f[0] not in found]
    if answered:
        unknown.update(c for c, _, _ in left if c not in doubted)
    elif STANDING:
        for c, _, _ in left[:4]:   # neither service answered: read the route table itself, a few flights at a time
            if not re.fullmatch(r'[A-Z]{2,3}[0-9][A-Z0-9]{0,4}', c, A):
                continue
            with lock:
                if not route_bucket.take():
                    break
            try:
                with outward.open(urllib.request.Request(STANDING.format(c[:2], c), headers={'Accept': 'application/json', 'User-Agent': AGENT}), timeout=6) as answer:
                    r = route_of(json.loads(answer.read(256 * 1024).decode('utf-8', 'replace')), judged=False)
            except urllib.error.HTTPError as e:
                if e.code == 404:   # the table has no route for this flight
                    unknown.add(c)
                continue
            except Exception:
                continue
            if r:
                found[c] = r
            else:
                unknown.add(c)
    return found, unknown, doubted


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
            return viewers.setdefault(viewer, (Bucket(VIEWER_RATE, VIEWER_BURST), Bucket(ASK_RATE, ASK_BURST), Bucket(ROUTE_VIEWER_RATE, ROUTE_VIEWER_BURST)))

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
        general, asking, routing = self.allowances(viewer)
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
        m = ROUTES.fullmatch(path)
        if m:
            status, body, extra = self.route_answer(m.group(1), routing)
            return self.reply(status, body, extra=extra)
        m = PHOTO.fullmatch(path)
        if m:
            status, body, extra = self.photo_answer(m.group(1), m.group(2) or '', asking)
            return self.reply(status, body, extra=extra)
        m = PLACE.fullmatch(path)
        if m:
            status, body, extra = self.place_answer(m.group(1), asking)
            return self.reply(status, body, extra=extra) if status != 404 else self.say(404, 'Not found')
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
            for name, url in ROUTE_SERVICES:   # and the route services (version 3.9), asked about one well-known flight
                started = time.time()
                got = post_routes(url, [('DAL1311', 26.7, -80.1)])
                report['routes from ' + name] = {'answered': got is not None, 'milliseconds': int((time.time() - started) * 1000), 'knows the test flight': bool(got and route_of(got.get('DAL1311'), judged=False))}
            started = time.time()   # and Planespotters (version 3.11), asked for a photo of one aircraft
            worked, found = ask_photo('a0e34a', 'N557NW')
            report['photos from Planespotters'] = {'answered': worked, 'milliseconds': int((time.time() - started) * 1000), 'found a photo': bool(found)}
            recent = json.dumps(report, indent=1)
            with lock:
                checked[0], checked[1] = time.monotonic(), recent
        self.reply(200, recent)

    def route_answer(self, items, routing):
        """Returns (status, text, extra headers) for up to ten flights' routes: a list with an entry for each flight that
        could be answered for, its airports empty when no service knows a route to show."""
        flights, seen = [], set()
        for item in items.split(';'):
            c, la, lo = item.split(',')
            la, lo = float(la), float(lo)
            if c not in seen and abs(la) <= 90 and abs(lo) <= 180:
                seen.add(c)
                flights.append((c, la, lo))
        out, ask = [], []
        with lock:
            now = time.monotonic()
            for f in flights:
                hit = routes_kept.get(f[0])
                if hit and now - hit[0] < (ROUTE_KEEP if hit[1] else ROUTE_NONE):
                    out.append(dict(hit[1], callsign=f[0]) if hit[1] else {'callsign': f[0], '_airports': []})
                else:
                    ask.append(f)
        if ask:
            with lock:   # the viewer's own allowance first, so one viewer cannot spend what the route services allow everyone
                may_ask = route_bucket.ready() and routing.take()
            if not may_ask:
                if out:
                    return 200, json.dumps(out, separators=(',', ':')), None
                return 503, json.dumps({'error': 'The route services have been asked as often as they may for now. Try again in a moment.'}), {'Retry-After': '4'}
            found, unknown, doubted = ask_routes(ask)
            with lock:
                now = time.monotonic()
                if len(routes_kept) > 5000:
                    for old in [k for k, v in routes_kept.items() if now - v[0] > (ROUTE_KEEP if v[1] else ROUTE_NONE)]:
                        del routes_kept[old]
                    if len(routes_kept) > 5000:
                        for old in sorted(routes_kept, key=lambda k: routes_kept[k][0])[:1000]:
                            del routes_kept[old]
                for c, r in found.items():
                    routes_kept[c] = (now, r)
                    out.append(dict(r, callsign=c))
                for c in unknown:
                    routes_kept[c] = (now, None)
                    out.append({'callsign': c, '_airports': []})
                for c in doubted:   # answered for this asker only, and not remembered, so a wrong position cannot hide a route from others
                    out.append({'callsign': c, '_airports': []})
        if not out:
            return 502, json.dumps({'error': 'The route services did not answer.'}), None
        return 200, json.dumps(out, separators=(',', ':')), None

    def photo_answer(self, hexid, reg, asking):
        """Returns (status, text, extra headers) for a photo of one aircraft: {"photo": {...}} or {"photo": null}.
        The answer by hex code is kept under the hex code alone and shared with everyone. The answer by registration is only
        as good as the registration the viewer sent, so it is kept under the hex code and that registration together: one
        viewer's registration never changes what another viewer sees, and a miss by hex code never stops a later question
        by registration."""
        busy = (503, json.dumps({'error': 'Planespotters has been asked as often as it may for now. Try again in a moment.'}), {'Retry-After': '3'})
        failed = (502, json.dumps({'error': 'Planespotters did not answer.'}), None)
        mine = lock_for('photo ' + hexid)
        if not mine.acquire(timeout=10):
            return busy
        try:
            first = True
            for key, url in [(hexid, PHOTOS_HEX.format(hexid))] + ([(hexid + '/' + reg, PHOTOS_REG.format(urllib.parse.quote(reg, safe='')))] if reg else []):
                now = time.monotonic()
                with lock:
                    hit, bad = photos_kept.get(key), photos_failed.get(key)
                if hit and now - hit[0] < (PHOTO_KEEP if hit[1] else PHOTO_NONE):
                    found = hit[1]
                elif bad and now - bad < 60:
                    return failed
                else:
                    with lock:   # every question sent counts against the allowance, the one by registration too
                        may_ask = photo_bucket.ready() and (asking.take() if first else True) and photo_bucket.take()
                    if not may_ask:
                        return busy
                    first = False
                    worked, found = ask_photo_once(url)
                    with lock:
                        now = time.monotonic()
                        if worked:
                            if len(photos_kept) > 3000:
                                for old in sorted(photos_kept, key=lambda k: photos_kept[k][0])[:600]:
                                    del photos_kept[old]
                            photos_kept[key] = (now, found)
                            photos_failed.pop(key, None)
                        else:
                            if len(photos_failed) > 300:
                                photos_failed.clear()
                            photos_failed[key] = now
                    if not worked:
                        return failed
                if found:
                    break
            return 200, json.dumps({'photo': found}, separators=(',', ':')), None
        finally:
            mine.release()

    def place_answer(self, encoded, asking):
        """Returns (status, text, extra headers) for one typed place. The words are the only thing sent on."""
        text = place_words(encoded)
        if text is None:
            return 404, '', None
        key = text.casefold()
        busy = (503, json.dumps({'error': 'The place finder has been asked as often as it may for now. Try again in a moment.'}), {'Retry-After': '2'})
        mine = lock_for('place ' + key)
        if not mine.acquire(timeout=10):
            return busy
        try:
            now = time.monotonic()
            with lock:
                hit, bad = places_kept.get(key), places_failed.get(key)
            if hit and now - hit[0] < PLACE_KEEP:
                return 200, hit[1], None
            if bad and now - bad < 30:
                return 502, json.dumps({'error': 'The place finder did not answer.'}), None
            with lock:   # the viewer's own allowance, the place finder's one a second, and the hourly ceiling, all or nothing
                may_ask = place_hour.ready() and place_bucket.ready() and asking.take() and place_bucket.take() and place_hour.take()
            if not may_ask:
                return busy
            worked, status, body = ask_places(text)
            with lock:
                now = time.monotonic()
                if worked:
                    for old in [k for k, v in places_kept.items() if now - v[0] > PLACE_KEEP]:
                        del places_kept[old]
                    if len(places_kept) > 1000:   # still too many: let go of the oldest
                        for old in sorted(places_kept, key=lambda k: places_kept[k][0])[:200]:
                            del places_kept[old]
                    places_kept[key] = (now, body)
                    places_failed.pop(key, None)
                else:
                    if len(places_failed) > 200:
                        places_failed.clear()
                    places_failed[key] = now
            if worked:
                return 200, body, None
            return 502, json.dumps({'error': 'The place finder did not answer.'}), None
        finally:
            mine.release()

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
                with lock:   # the networks that failed lately are tried last, so one that times out does not hold every question up
                    order = sorted(((best[0] + i) % len(NETWORKS) for i in range(len(NETWORKS))),
                                   key=lambda n: time.monotonic() - network_down.get(n, -1e9) < NETWORK_REST)
                for i, index in enumerate(order):
                    if i:   # every further network tried counts against the allowance too
                        with lock:
                            if not bucket.take():
                                break
                    network = NETWORKS[index]
                    worked, status, text, _ = ask(network[which].format(*values))
                    if not worked:
                        with lock:
                            network_down[index] = time.monotonic()
                    if worked:
                        with lock:
                            now = time.monotonic()
                            best[0] = index
                            network_down.pop(index, None)
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
