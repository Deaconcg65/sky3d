# The LED board's decisions, kept apart from the hardware so they can be tested on a computer (tools/board_test.py).
# Everything here runs on CircuitPython too: no os.path, no bisect, no dataclasses.
import math

OVERHEAD_MILES = 3.0      # a flight this close counts as overhead
OVERHEAD_FEET = 12000     # and only when it is lower than this
OVERHEAD_SECONDS = 20     # an overhead flight stays on the screen at least this long
NEARBY_MILES = 10.0       # the circle the board asks the free network about
NEARBY_SHOWN = 4          # how many nearby flights the flights app shows, closest first

# Airline callsign prefixes: (two-letter code, short name, colour). Taken from src/airlines.js, U.S. and nearby
# carriers only, to keep the board small.
AIRLINES = {
    'AAL': ('AA', 'American', 0x2a6ebb), 'DAL': ('DL', 'Delta', 0xc8102e), 'UAL': ('UA', 'United', 0x1b4f9c),
    'JBU': ('B6', 'JetBlue', 0x0a3fa8), 'SWA': ('WN', 'Southwest', 0xf2a900), 'NKS': ('NK', 'Spirit', 0xffe600),
    'FFT': ('F9', 'Frontier', 0x1f8a4c), 'ASA': ('AS', 'Alaska', 0x0b3d5b), 'HAL': ('HA', 'Hawaiian', 0x6a2c91),
    'AAY': ('G4', 'Allegiant', 0xf58220), 'SCX': ('SY', 'Sun Country', 0xf58220), 'MXY': ('MX', 'Breeze', 0x2d6cdf),
    'VXP': ('XP', 'Avelo', 0x5b2d8e), 'RPA': ('YX', 'Republic', 0x8a94a0), 'EDV': ('9E', 'Endeavor', 0xc8102e),
    'ENY': ('MQ', 'Envoy', 0x2a6ebb), 'JIA': ('OH', 'PSA', 0x2a6ebb), 'PDT': ('PT', 'Piedmont', 0x2a6ebb),
    'SKW': ('OO', 'SkyWest', 0x7a8793), 'ASH': ('YV', 'Mesa', 0x7a8793), 'GJS': ('G7', 'GoJet', 0x1b4f9c),
    'UCA': ('C5', 'CommuteAir', 0x1b4f9c), 'QXE': ('QX', 'Horizon', 0x0b3d5b), 'KAP': ('9K', 'Cape Air', 0x1c75bc),
    'FDX': ('FX', 'FedEx', 0x4d148c), 'UPS': ('5X', 'UPS', 0x5a3a1e), 'GTI': ('5Y', 'Atlas', 0x1b3a6b),
    'ABX': ('GB', 'ABX Air', 0x8a94a0), 'ACA': ('AC', 'Air Canada', 0xd22630), 'WJA': ('WS', 'WestJet', 0x00a9a5),
    'POE': ('PD', 'Porter', 0x1d3557), 'TSC': ('TS', 'Air Transat', 0x1a8fd6), 'AMX': ('AM', 'Aeromexico', 0x0b2a5b),
    'VOI': ('Y4', 'Volaris', 0x6a2c91), 'AVA': ('AV', 'Avianca', 0xd22630), 'CMP': ('CM', 'Copa', 0x1b4f9c),
    'BWA': ('BW', 'Caribbean', 0x00a1de), 'BAW': ('BA', 'British', 0x1d3f7a), 'VIR': ('VS', 'Virgin Atl', 0xc8102e),
    'DLH': ('LH', 'Lufthansa', 0x0a1d5c), 'AFR': ('AF', 'Air France', 0x1b3f8f), 'KLM': ('KL', 'KLM', 0x00a1de),
    'EJA': ('', 'NetJets', 0x9a9a9a), 'LXJ': ('', 'Flexjet', 0x9a3f4b), 'SIL': ('3M', 'Silver', 0x8a94a0),
}
PLAIN = 0xb0b0b0   # aircraft with no airline


def miles_between(lat1, lon1, lat2, lon2):
    """Great-circle distance in statute miles."""
    r = math.radians
    a = math.sin(r(lat2 - lat1) / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lon2 - lon1) / 2) ** 2
    return 3958.8 * 2 * math.asin(min(1.0, math.sqrt(a)))


def _num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)) and v == v and abs(v) < 1e7:
        return v
    return None


def _text(v, most):
    if not isinstance(v, str):
        return ''
    out = ''.join(c for c in v if 32 < ord(c) < 127)
    return out[:most]


def planes_from(data, lat, lon):
    """The aircraft in one answer from a network or an antenna, closest first. Networks list them under "ac", an
    antenna under "aircraft". Aircraft with no position are left out. Text is limited to plain characters."""
    if not isinstance(data, dict):
        return []
    rows = data.get('ac')
    if not isinstance(rows, list):
        rows = data.get('aircraft')
    if not isinstance(rows, list):
        return []
    out = []
    for a in rows:
        if not isinstance(a, dict):
            continue
        la, lo = _num(a.get('lat')), _num(a.get('lon'))
        if la is None or lo is None or abs(la) > 90 or abs(lo) > 180:
            continue
        alt = a.get('alt_baro')
        ground = alt == 'ground'
        alt = _num(alt)
        if alt is None:
            alt = _num(a.get('alt_geom'))
        hexid = _text(a.get('hex'), 8).lower()
        if not hexid:
            continue
        out.append({
            'hex': hexid, 'flight': _text(a.get('flight'), 8).upper(), 'type': _text(a.get('t'), 4).upper(),
            'reg': _text(a.get('r'), 8).upper(), 'alt': None if ground else alt, 'ground': ground,
            'speed': _num(a.get('gs')), 'lat': la, 'lon': lo, 'miles': miles_between(lat, lon, la, lo),
        })
    out.sort(key=lambda p: p['miles'])
    return out


def airborne(p):
    return not p['ground'] and p['alt'] is not None


def is_overhead(p):
    return airborne(p) and p['miles'] <= OVERHEAD_MILES and p['alt'] < OVERHEAD_FEET


def nearby(planes):
    """The flights the flights app shows: airborne, inside the circle, closest first."""
    return [p for p in planes if airborne(p) and p['miles'] <= NEARBY_MILES][:NEARBY_SHOWN]


class Overhead:
    """Which flight, if any, has taken over the screen. A flight overhead takes over whatever is showing and keeps the
    screen until it has left (farther than 3 miles, or climbed above 12,000 feet), and for at least 20 seconds. While
    it holds the screen it keeps its place even if another flight comes closer, so the screen does not flicker."""

    def __init__(self):
        self.plane = None
        self.since = 0

    def update(self, now, planes):
        if self.plane is not None:
            same = None
            for p in planes:
                if p['hex'] == self.plane['hex']:
                    same = p
                    break
            if same is not None and is_overhead(same):
                self.plane = same
                return self.plane
            if now - self.since < OVERHEAD_SECONDS:
                if same is not None:
                    self.plane = same
                return self.plane
            self.plane = None
        for p in planes:
            if is_overhead(p):
                self.plane, self.since = p, now
                break
        return self.plane


def flight_name(p):
    """What the first line calls a flight: the airline's flight number (DL1234) for airlines, the callsign or the
    tail number for everything else."""
    cs = p['flight']
    a = AIRLINES.get(cs[:3]) if len(cs) > 3 and cs[3:4].isdigit() else None
    if a and a[0]:
        return a[0] + cs[3:]
    return cs or p['reg'] or p['hex'].upper()


def airline_of(p):
    cs = p['flight']
    if len(cs) > 3 and cs[3:4].isdigit():
        return AIRLINES.get(cs[:3])
    return None


def colour_of(p):
    a = airline_of(p)
    return a[2] if a else PLAIN


def fit(text, width=21):
    return text if len(text) <= width else text[:width]


def two_columns(left, right, width=21):
    """Left text and right text on one 21-character line, the right text pushed to the end."""
    right = right[:width]
    left = left[:max(0, width - len(right) - 1)]
    return left + ' ' * (width - len(left) - len(right)) + right


def height_text(p):
    if p['alt'] is None:
        return ''
    return thousands(int(round(p['alt'] / 100.0)) * 100) + ' ft'


def thousands(n):
    """12500 as "12,500". CircuitPython's format has no thousands separator."""
    s = str(abs(n))
    groups = []
    while len(s) > 3:
        groups.insert(0, s[-3:])
        s = s[:-3]
    groups.insert(0, s)
    return ('-' if n < 0 else '') + ','.join(groups)


def speed_text(p):
    return '' if p['speed'] is None else '%d kt' % int(round(p['speed']))


def flight_lines(p, route, phase):
    """The two lines for one flight. The second line takes turns: the route, then height and speed."""
    top = two_columns(flight_name(p), p['type'])
    facts = two_columns(height_text(p), speed_text(p))
    a = airline_of(p)
    if route:
        second = (route if phase % 2 == 0 else facts)
    elif a and phase % 2 == 0:
        second = a[1]
    else:
        second = facts
    return top, fit(second)


def route_text(answer):
    """The route a route service gave for one flight, as "MCO>ATL", or '' when there is none worth showing."""
    if not isinstance(answer, dict) or answer.get('plausible') in (False, 0):
        return ''
    aps = answer.get('_airports')
    if not isinstance(aps, list) or len(aps) < 2:
        return ''
    codes = []
    for a in aps[:4]:
        if not isinstance(a, dict):
            return ''
        c = _text(a.get('iata'), 3) or _text(a.get('icao'), 4)
        if not c:
            return ''
        codes.append(c.upper())
    if codes[0] == codes[-1]:
        return ''
    return '>'.join(codes)


# ---------- the apps, taking turns ----------

class Rotation:
    """The apps take turns on the screen: nearby flights (one card each, closest first), then weather, then the
    clock. An app with nothing to show is skipped. Every tenth round ends with a short credit for the flight data."""

    def __init__(self, card_seconds=6, weather_seconds=10, clock_seconds=8, credit_seconds=4):
        self.card_seconds, self.weather_seconds = card_seconds, weather_seconds
        self.clock_seconds, self.credit_seconds = clock_seconds, credit_seconds
        self.queue, self.until, self.current, self.rounds = [], 0, None, 0

    def _plan(self, flights, have_weather):
        q = [('flight', i, self.card_seconds) for i in range(len(flights))]
        if have_weather:
            q.append(('weather', 0, self.weather_seconds))
        q.append(('clock', 0, self.clock_seconds))
        self.rounds += 1
        if self.rounds % 10 == 0:
            q.append(('credit', 0, self.credit_seconds))
        return q

    def frame(self, now, flights, have_weather):
        """What to show now: ('flight', index), ('weather', 0), ('clock', 0) or ('credit', 0)."""
        if self.current is not None and now < self.until:
            kind, i = self.current
            if kind != 'flight' or i < len(flights):
                return self.current
        while True:
            if not self.queue:
                self.queue = self._plan(flights, have_weather)
            kind, i, secs = self.queue.pop(0)
            if kind == 'flight' and i >= len(flights):
                continue
            if kind == 'weather' and not have_weather:
                continue
            self.current, self.until = (kind, i), now + secs
            return self.current

    def restart(self):
        """After a flight overhead has gone, the turns start again from the top."""
        self.queue, self.current, self.until = [], None, 0


# ---------- time ----------

MONTHS = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')
DAYS = ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')


def days_from_civil(y, m, d):
    """Days since 1970-01-01 for a date (Howard Hinnant's method)."""
    y -= m <= 2
    era = (y if y >= 0 else y - 399) // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def civil_from_days(z):
    z += 719468
    era = (z if z >= 0 else z - 146096) // 146097
    doe = z - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = mp + (3 if mp < 10 else -9)
    return y + (m <= 2), m, d


def http_date(text):
    """Seconds since 1970 (UTC) from a web server's Date header, such as "Sun, 22 Nov 2026 15:04:05 GMT"."""
    try:
        parts = text.replace(',', ' ').split()
        d, mon, y, hms = int(parts[1]), MONTHS.index(parts[2][:1].upper() + parts[2][1:3].lower()) + 1, int(parts[3]), parts[4].split(':')
        if not (1 <= d <= 31 and 2020 <= y <= 2200):
            return None
        return days_from_civil(y, mon, d) * 86400 + int(hms[0]) * 3600 + int(hms[1]) * 60 + int(hms[2])
    except (ValueError, IndexError, AttributeError):
        return None


# Standard offset from UTC in hours for the U.S. time zone names the Weather Service gives, and whether the zone
# keeps daylight saving time. Zones under America/Indiana, America/Kentucky and America/North_Dakota go by their
# prefix.
ZONES = {
    'America/New_York': (-5, True), 'America/Detroit': (-5, True), 'America/Indiana': (-5, True),
    'America/Kentucky': (-5, True), 'America/Chicago': (-6, True), 'America/Menominee': (-6, True),
    'America/North_Dakota': (-6, True), 'America/Indiana/Knox': (-6, True), 'America/Indiana/Tell_City': (-6, True),
    'America/Denver': (-7, True), 'America/Boise': (-7, True), 'America/Phoenix': (-7, False),
    'America/Los_Angeles': (-8, True), 'America/Anchorage': (-9, True), 'America/Juneau': (-9, True),
    'America/Sitka': (-9, True), 'America/Nome': (-9, True), 'America/Yakutat': (-9, True),
    'America/Metlakatla': (-9, True), 'America/Adak': (-10, True), 'Pacific/Honolulu': (-10, False),
    'America/Puerto_Rico': (-4, False), 'America/St_Thomas': (-4, False), 'Pacific/Guam': (10, False),
    'Pacific/Pago_Pago': (-11, False),
}


def zone_rule(name):
    if name in ZONES:
        return ZONES[name]
    parts = (name or '').split('/')
    if len(parts) > 2 and '/'.join(parts[:2]) in ZONES:
        return ZONES['/'.join(parts[:2])]
    return (-5, True)   # Eastern, for a name not in the list


def nth_sunday(y, m, n):
    """Day of the month of the nth Sunday."""
    first = days_from_civil(y, m, 1)
    weekday = (first + 3) % 7          # 1970-01-01 was a Thursday; 0 is Monday
    first_sunday = 1 + (6 - weekday) % 7
    return first_sunday + 7 * (n - 1)


def utc_offset(utc, zone):
    """Seconds to add to UTC for local time. U.S. daylight time runs from 2 AM local on the second Sunday in March
    to 2 AM local on the first Sunday in November."""
    hours, dst = zone_rule(zone)
    base = hours * 3600
    if not dst:
        return base
    y = civil_from_days(utc // 86400)[0]
    start = days_from_civil(y, 3, nth_sunday(y, 3, 2)) * 86400 + 2 * 3600 - base
    end = days_from_civil(y, 11, nth_sunday(y, 11, 1)) * 86400 + 2 * 3600 - (base + 3600)
    return base + 3600 if start <= utc < end else base


def clock_lines(utc, zone):
    """The clock app's two lines: "7:42 PM" and "Sun Nov 22"."""
    t = utc + utc_offset(utc, zone)
    days = t // 86400
    y, m, d = civil_from_days(days)
    secs = t % 86400
    h, mi = secs // 3600, (secs % 3600) // 60
    ampm = 'AM' if h < 12 else 'PM'
    h12 = h % 12 or 12
    weekday = DAYS[(days + 3) % 7]
    return '%d:%02d %s' % (h12, mi, ampm), '%s %s %d' % (weekday, MONTHS[m - 1], d)


def local_hour(utc, zone):
    return ((utc + utc_offset(utc, zone)) % 86400) // 3600


# ---------- weather ----------

def weather_lines(now_obs, period):
    """The weather app's two lines from the Weather Service: the temperature now and what it looks like, then the
    forecast for the next period, such as "Tonight 61F Clear"."""
    top, second = '', ''
    if isinstance(now_obs, dict):
        p = now_obs.get('properties') if isinstance(now_obs.get('properties'), dict) else {}
        t = p.get('temperature') if isinstance(p.get('temperature'), dict) else {}
        c = _num(t.get('value'))
        words = _text_words(p.get('textDescription'))
        if c is not None:
            top = two_columns('Now %dF' % int(round(c * 9 / 5 + 32)), words, 21)
    if isinstance(period, dict):
        temp = _num(period.get('temperature'))
        name = _text_words(period.get('name'))
        name = SHORT_PERIODS.get(name, name.split(' ')[0] if name else '')
        words = _text_words(period.get('shortForecast'))
        if temp is not None:
            second = fit('%s %dF %s' % (name, int(temp), words))
    return top, second


SHORT_PERIODS = {'This Afternoon': 'Today', 'This Morning': 'Today', 'Overnight': 'Tonight', 'Today': 'Today',
                 'Tonight': 'Tonight'}


def _text_words(v):
    if not isinstance(v, str):
        return ''
    return ' '.join(''.join(c if 31 < ord(c) < 127 else ' ' for c in v).split())[:40]


# ---------- the ZIP code table ----------

ZIP_RECORD = 9


def zip_record(rec):
    z = int.from_bytes(rec[0:3], 'big')
    la = _signed24(rec[3:6]) / 10000.0
    lo = _signed24(rec[6:9]) / 10000.0
    return z, la, lo


def _signed24(b):
    v = int.from_bytes(b, 'big')
    return v - 0x1000000 if v & 0x800000 else v


def find_zip(f, size, zipcode):
    """Look up a five-digit ZIP code in the open table file. Returns (latitude, longitude) or None."""
    if not (isinstance(zipcode, str) and len(zipcode) == 5 and zipcode.isdigit()):
        return None
    want = int(zipcode)
    lo, hi = 0, size // ZIP_RECORD - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        f.seek(mid * ZIP_RECORD)
        z, la, lon = zip_record(f.read(ZIP_RECORD))
        if z == want:
            return la, lon
        if z < want:
            lo = mid + 1
        else:
            hi = mid - 1
    return None


# ---------- updates ----------

SAFE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-./'
NEVER_UPDATED = ('boot.py', 'code.py', 'config.json', 'manifest.json', 'manifest.refused', 'settings.toml',
                 'update.todo', 'update.trial')


def safe_path(path):
    """Whether a file named in the update list may be written. Only plain names below the board's own folders, never
    a file that holds the owner's settings, never boot.py or code.py (which start the board and bring back the earlier
    version when an update fails), and nothing that climbs out of the folder."""
    if not isinstance(path, str) or not 0 < len(path) <= 80:
        return False
    if any(c not in SAFE for c in path) or path.startswith('/') or path.startswith('.') or '//' in path:
        return False
    parts = path.split('/')
    if len(parts) > 3 or any(p in ('', '.', '..') or p.startswith('.') for p in parts):
        return False
    if path in NEVER_UPDATED or path.endswith('.new') or path.endswith('.old'):
        return False
    return True


def plan_update(local, remote, refused=None):
    """Compare the update list on the board with the one in the repository. Returns (fetch, remove): the files to
    download, as (path, sha, size), and the files the board had from an earlier list that the new list dropped.
    Returns None when the new list is not one to trust, or is the very list that boot.py had to take back."""
    if not isinstance(remote, dict) or not isinstance(remote.get('files'), dict):
        return None
    if isinstance(refused, dict) and refused.get('files') == remote['files']:
        return None
    have = local.get('files') if isinstance(local, dict) and isinstance(local.get('files'), dict) else {}
    fetch = []
    total = 0
    for path, f in remote['files'].items():
        if not safe_path(path) or not isinstance(f, dict):
            return None
        sha, size = f.get('sha'), f.get('size')
        if not (isinstance(sha, str) and len(sha) == 64 and all(c in '0123456789abcdef' for c in sha)):
            return None
        if not (isinstance(size, int) and not isinstance(size, bool) and 0 <= size <= 1024 * 1024):
            return None
        total += size
        old = have.get(path)
        if not (isinstance(old, dict) and old.get('sha') == sha):
            fetch.append((path, sha, size))
    if total > 3 * 1024 * 1024 or 'sky/app.py' not in remote['files']:
        return None
    remove = [p for p in have if p not in remote['files'] and safe_path(p)]
    fetch.sort()
    remove.sort()
    return fetch, remove


def hex_of(digest):
    return ''.join('%02x' % b for b in digest)


# ---------- the setup page ----------

def escape(text):
    return (text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .replace('"', '&quot;').replace("'", '&#39;'))


def form_fields(body):
    """Read a submitted form (application/x-www-form-urlencoded) into a dict of text."""
    out = {}
    if isinstance(body, (bytes, bytearray)):
        body = bytes(body)
    else:
        body = str(body).encode('utf-8')
    for pair in body.split(b'&'):
        if not pair:
            continue
        kv = pair.split(b'=', 1)
        out[_unquote(kv[0])] = _unquote(kv[1] if len(kv) > 1 else b'')
    return out


def _unquote(b):
    b = b.replace(b'+', b' ')
    out = bytearray()
    i = 0
    while i < len(b):
        c = b[i]
        if c == 37 and i + 2 < len(b) and _ishex(b[i + 1:i + 3]):   # '%'
            out.append(int(bytes(b[i + 1:i + 3]).decode(), 16))
            i += 3
        else:
            out.append(c)
            i += 1
    try:
        return bytes(out).decode('utf-8')
    except UnicodeError:
        return ''.join(chr(c) for c in out)


def _ishex(two):
    return len(two) == 2 and all(c in b'0123456789abcdefABCDEF' for c in two)


def antenna_address(text):
    """The owner's own antenna, as typed on the setup page: "192.168.1.20" or "192.168.1.20:8099". Only an address
    on a home network is taken. Returns the address of its aircraft list, or '' for none."""
    text = (text or '').strip()
    if not text:
        return ''
    if text.startswith('http://'):
        text = text[7:]
    text = text.split('/')[0]
    hp = text.split(':', 1)
    host, port = hp[0], (hp[1] if len(hp) > 1 else '')
    nums = host.split('.')
    if len(nums) != 4 or not all(n.isdigit() and len(n) <= 3 and int(n) <= 255 for n in nums):
        return None
    a, b = int(nums[0]), int(nums[1])
    if not (a == 10 or (a == 172 and 16 <= b <= 31) or (a == 192 and b == 168)):
        return None
    if port and not (port.isdigit() and 0 < int(port) < 65536):
        return None
    return 'http://%s:%s/data/aircraft.json' % (host, port or '8099')
