"""Checks for the LED flight board's software (board/CIRCUITPY), run on a computer with ordinary Python 3:

    python3 -I tools/board_test.py

The hardware parts (the panels, Wi-Fi, the drive) only run on the board itself. Everything they decide with is in
sky/logic.py and sky/web.py, which these checks run directly; boot.py's update swap is run against a stand-in drive
in a temporary folder.
"""
import ast
import io
import json
import os
import py_compile
import socket
import sys
import tempfile
import threading
import types

sys.dont_write_bytecode = True   # leave no compiled files in board/CIRCUITPY
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', 'board', 'CIRCUITPY'))
sys.path.insert(0, ROOT)

from sky import logic, web   # noqa: E402

errors = []


def check(ok, what):
    print(('ok    ' if ok else 'FAIL  ') + what)
    if not ok:
        errors.append(what)


def plane(hexid='a1', flight='DAL1234', miles=1.0, alt=5000, ground=False, t='B738'):
    return {'hex': hexid, 'flight': flight, 'type': t, 'reg': 'N123', 'alt': None if ground else alt,
            'ground': ground, 'speed': 250, 'lat': 0, 'lon': 0, 'miles': miles}


# ---------- every file compiles ----------
for folder, _, names in os.walk(ROOT):
    for n in names:
        if n.endswith('.py'):
            p = os.path.join(folder, n)
            try:
                py_compile.compile(p, cfile=os.path.join(tempfile.gettempdir(), 'board_check.pyc'), doraise=True)
                ok = True
            except py_compile.PyCompileError:
                ok = False
            check(ok, 'compiles: ' + os.path.relpath(p, ROOT))

# ---------- reading flights ----------
home = (28.5384, -81.3789)   # Orlando
data = {'ac': [
    {'hex': 'AB12CD', 'flight': 'DAL1234 ', 't': 'B738', 'r': 'N801DZ', 'alt_baro': 4200, 'gs': 230.4,
     'lat': 28.55, 'lon': -81.38},
    {'hex': 'ab0001', 'flight': 'N172SP', 't': 'C172', 'alt_baro': 'ground', 'lat': 28.539, 'lon': -81.379},
    {'hex': 'ab0002', 'flight': 'AAL99', 'alt_baro': 35000, 'lat': 28.6, 'lon': -81.3},
    {'hex': 'ab0004', 'flight': 'JBU1', 'alt_baro': 9000, 'lat': 28.75, 'lon': -81.3},
    {'hex': 'ab0003', 'flight': '<b>x', 'lat': 'bad', 'lon': -81.3},
    {'flight': 'NOHEX', 'lat': 28.6, 'lon': -81.3},
]}
ps = logic.planes_from(data, *home)
check([p['hex'] for p in ps] == ['ab0001', 'ab12cd', 'ab0002', 'ab0004'], 'flights are read closest first, bad rows skipped')
check(ps[1]['flight'] == 'DAL1234' and ps[1]['miles'] < 1.0, 'callsign trimmed and distance worked out')
check(ps[0]['ground'] and ps[0]['alt'] is None, 'an aircraft on the ground has no height')
check(logic.planes_from({'aircraft': data['ac']}, *home) == ps, "an antenna's list reads the same way")
check(logic.planes_from('nonsense', *home) == [] and logic.planes_from({'ac': 5}, *home) == [], 'junk is ignored')
check([p['hex'] for p in logic.nearby(ps)] == ['ab12cd', 'ab0002'], 'nearby skips the ground and beyond 10 miles')
check(abs(logic.miles_between(28.4312, -81.3081, 33.6407, -84.4277) - 404) < 5, 'MCO to ATL is about 404 miles')

# ---------- a flight overhead ----------
o = logic.Overhead()
low = plane('a1', miles=2.0, alt=3000)
check(o.update(0, [low])['hex'] == 'a1', 'a low flight within 3 miles takes over')
check(o.update(5, [plane('a2', miles=0.5, alt=2000), plane('a1', miles=2.5, alt=3200)])['hex'] == 'a1',
      'it keeps the screen while another comes closer')
check(o.update(10, [plane('a1', miles=4.0, alt=3500)])['hex'] == 'a1', 'it stays for at least 20 seconds')
check(o.update(21, [plane('a1', miles=4.0, alt=3500)]) is None, 'it lets go once it has left and 20 seconds passed')
check(o.update(22, [plane('a3', miles=2.9, alt=12500)]) is None, 'above 12,000 feet is not overhead')
check(o.update(23, [plane('a4', miles=3.2, alt=2000)]) is None, 'beyond 3 miles is not overhead')
check(o.update(24, [plane('a5', miles=1.0, ground=True)]) is None, 'on the ground is not overhead')
o2 = logic.Overhead()
o2.update(0, [plane('b1', miles=1, alt=2000)])
check(o2.update(40, [plane('b1', miles=2.9, alt=11000)])['hex'] == 'b1', 'it keeps the screen while still overhead')
check(o2.update(41, []) is None, 'when it drops out of the data after 20 seconds it lets go')

# ---------- what a flight card says ----------
d = plane('c1', 'DAL1234', alt=12345)
top, second = logic.flight_lines(d, 'MCO>ATL', 0)
check(top == 'DL1234' + ' ' * 11 + 'B738' and len(top) == 21, 'first line: flight number left, type right')
check(second == 'MCO>ATL', 'second line starts with the route')
check(logic.flight_lines(d, 'MCO>ATL', 1)[1] == '12,300 ft' + ' ' * 6 + '250 kt', 'then height and speed')
check(logic.flight_lines(d, '', 0)[1] == 'Delta', 'with no route it shows the airline name')
g = plane('c2', 'N172SP', t='C172')
check(logic.flight_name(g) == 'N172SP' and logic.colour_of(g) == logic.PLAIN, 'a private plane keeps its callsign')
check(logic.flight_name(plane('c3', '')) == 'N123', 'no callsign: the tail number')
check(logic.flight_name(plane('c4', 'EJA567')) == 'EJA567', 'an airline with no two-letter code keeps its callsign')
check(logic.thousands(1234567) == '1,234,567' and logic.thousands(999) == '999', 'thousands separators')
check(logic.route_text({'_airports': [{'iata': 'MCO'}, {'iata': 'ATL'}]}) == 'MCO>ATL', 'a route reads MCO>ATL')
check(logic.route_text({'_airports': [{'icao': 'KORL'}, {'iata': 'tpa'}]}) == 'KORL>TPA', 'ICAO code when no IATA')
check(logic.route_text({'_airports': [{'iata': 'MCO'}, {'iata': 'MCO'}]}) == '', 'a route back to the same airport')
check(logic.route_text({'_airports': [{'iata': 'MCO'}, {'iata': 'ATL'}], 'plausible': False}) == '',
      'a route the service doubts is not shown')

# ---------- the apps taking turns ----------
r = logic.Rotation(card_seconds=6, weather_seconds=10, clock_seconds=8)
two = [plane('d1'), plane('d2')]
seen = []
t = 0
while t < 60:
    f = r.frame(t, two, True)
    if not seen or seen[-1] != f:
        seen.append(f)
    t += 1
check(seen[:5] == [('flight', 0), ('flight', 1), ('weather', 0), ('clock', 0), ('flight', 0)],
      'turns: each nearby flight, then weather, then the clock')
r2 = logic.Rotation()
check(r2.frame(0, [], False) == ('clock', 0), 'with no flights and no weather the clock shows')
r3 = logic.Rotation(card_seconds=6)
r3.frame(0, two, True)
r3.frame(6, two, True)
check(r3.frame(7, two[:1], True) != ('flight', 1), 'a flight that has gone is skipped at once')
r4 = logic.Rotation(card_seconds=1, weather_seconds=1, clock_seconds=1, credit_seconds=1)
kinds = [r4.frame(t, [], True)[0] for t in range(60)]
check('credit' in kinds, 'the flight data credit shows every tenth round')

# ---------- time ----------
check(logic.http_date('Sun, 22 Nov 2026 15:04:05 GMT') == 1795359845, 'reads the Date a web server sends')
check(logic.http_date('garbage') is None and logic.http_date('') is None, 'a bad Date is ignored')
check(logic.civil_from_days(logic.days_from_civil(2024, 2, 29)) == (2024, 2, 29), 'dates convert both ways')
check(logic.nth_sunday(2026, 3, 2) == 8 and logic.nth_sunday(2026, 11, 1) == 1, 'daylight time 2026: Mar 8, Nov 1')
ny = 'America/New_York'
before = logic.days_from_civil(2026, 3, 8) * 86400 + 6 * 3600 + 59 * 60     # 1:59 AM EST
after = logic.days_from_civil(2026, 3, 8) * 86400 + 7 * 3600                # 3:00 AM EDT
check(logic.utc_offset(before, ny) == -5 * 3600 and logic.utc_offset(after, ny) == -4 * 3600,
      'clocks spring forward at 2 AM on the second Sunday in March')
fall = logic.days_from_civil(2026, 11, 1) * 86400 + 6 * 3600 - 1            # 1:59:59 AM EDT
check(logic.utc_offset(fall, ny) == -4 * 3600 and logic.utc_offset(fall + 1, ny) == -5 * 3600,
      'and fall back at 2 AM on the first Sunday in November')
check(logic.utc_offset(after, 'America/Phoenix') == -7 * 3600, 'Arizona keeps standard time')
check(logic.utc_offset(after, 'America/Indiana/Indianapolis') == -4 * 3600, 'Indiana zones go by their prefix')
check(logic.utc_offset(after + 2 * 3600, 'America/Indiana/Knox') == -5 * 3600 and
      logic.utc_offset(after, 'America/Indiana/Knox') == -6 * 3600, 'but Knox, Indiana is Central')
check(logic.clock_lines(1795359845, ny) == ('10:04 AM', 'Sun Nov 22'), 'clock: 10:04 AM, Sun Nov 22')
check(logic.local_hour(1795359845, 'America/Chicago') == 9, 'local hour for night dimming')

# ---------- weather ----------
obs = {'properties': {'temperature': {'value': 22.2, 'unitCode': 'wmoUnit:degC'}, 'textDescription': 'Partly Cloudy'}}
period = {'name': 'This Afternoon', 'temperature': 81, 'shortForecast': 'Sunny'}
check(logic.weather_lines(obs, period) == ('Now 72F Partly Cloudy', 'Today 81F Sunny'), 'weather lines')
check(logic.weather_lines({'properties': {'temperature': {'value': None}}}, None) == ('', ''),
      'weather with no reading shows nothing')
check(logic.weather_lines(None, {'name': 'Tuesday Night', 'temperature': 60, 'shortForecast': 'Rain\x07'})[1] ==
      'Tuesday 60F Rain', 'odd characters are dropped from the forecast')

# ---------- the ZIP code table ----------
zips = os.path.join(ROOT, 'zips.bin')
size = os.path.getsize(zips)
check(size % 9 == 0 and size // 9 > 30000, 'the ZIP table holds more than 30,000 ZIP codes')
with open(zips, 'rb') as f:
    orlando = logic.find_zip(f, size, '32801')
    nyc = logic.find_zip(f, size, '10001')
    first = logic.find_zip(f, size, '00601')
    check(orlando and abs(orlando[0] - 28.54) < 0.05 and abs(orlando[1] + 81.38) < 0.05, 'ZIP 32801 is Orlando')
    check(nyc and abs(nyc[0] - 40.75) < 0.01, 'ZIP 10001 is New York')
    check(first is not None, 'the first ZIP in the table is found')
    check(logic.find_zip(f, size, '00000') is None and logic.find_zip(f, size, '3280') is None and
          logic.find_zip(f, size, 'abcde') is None, 'a ZIP that is not real is not found')
    recs = f.seek(0) or f.read()
    zs = [int.from_bytes(recs[i:i + 3], 'big') for i in range(0, len(recs), 9)]
    check(zs == sorted(zs) and len(set(zs)) == len(zs), 'the table is sorted with no ZIP twice')

# ---------- updates ----------
check(logic.safe_path('sky/app.py') and logic.safe_path('sky/logic.py') and logic.safe_path('lib/a/b.py'),
      'plain board paths may be updated')
for bad in ('boot.py', 'code.py', 'config.json', 'config.json.tmp', 'manifest.json', 'update.trial', 'x.py.old', '../x.py', 'sky/../boot.py', '/code.py', '.hidden',
            'sky/.x', 'a/b/c/d.py', 'x.py.new', 'sky//x.py', 'sp ace.py', 'x\\y.py', '', 'a' * 81,
            'BOOT.py', 'Boot.PY', 'CONFIG.JSON', 'Code.py', 'x.py.NEW', 'x.py.Old', 'UPDATE.TRIAL', 'update.swap'):
    check(not logic.safe_path(bad), 'never updated: ' + repr(bad[:20]))
sha = 'a' * 64
remote = {'files': {'sky/app.py': {'sha': sha, 'size': 10}, 'sky/new.py': {'sha': 'b' * 64, 'size': 5}}}
local = {'files': {'sky/app.py': {'sha': sha, 'size': 10}, 'sky/old.py': {'sha': 'c' * 64, 'size': 5}}}
check(logic.plan_update(local, remote) == ([('sky/new.py', 'b' * 64, 5)], ['sky/old.py']),
      'only changed files are fetched, dropped ones removed')
check(logic.plan_update({}, remote)[0] == [('sky/app.py', sha, 10), ('sky/new.py', 'b' * 64, 5)],
      'a board with no list fetches everything')
check(logic.plan_update(local, remote, refused={'files': remote['files']}) is None,
      'the list that boot.py had to take back is not fetched again')
check(logic.plan_update(local, remote, refused={'files': {}}) is not None, 'a different list is fetched')
for name in ('boot.py', 'code.py'):
    check(logic.plan_update(local, {'files': {'sky/app.py': {'sha': sha, 'size': 10}, name: {'sha': sha, 'size': 1}}})
          is None, 'a list naming %s is refused whole' % name)
check(logic.plan_update(local, {'files': {'sky/app.py': {'sha': sha, 'size': 10}, 'SKY/App.py': {'sha': sha, 'size': 1}}})
      is None, 'a list with two spellings of one file is refused')
check(logic.plan_update({'files': {'Sky/Old.py': {'sha': sha, 'size': 1}}},
                        {'files': {'sky/app.py': {'sha': sha, 'size': 10}, 'sky/old.py': {'sha': sha, 'size': 1}}})[1]
      == [], 'a file kept under another spelling is not removed')
check(logic.plan_update(local, {'files': {'sky/app.py': {'sha': 'xyz', 'size': 10}}}) is None, 'a bad checksum')
check(logic.plan_update(local, {'files': {'sky/x.py': {'sha': sha, 'size': 1}}}) is None, 'a list with no app')
check(logic.plan_update(local, {'files': {'sky/app.py': {'sha': sha, 'size': 10 ** 7}}}) is None, 'a huge file')
check(logic.plan_update(local, None) is None and logic.plan_update(local, {'files': []}) is None, 'junk lists')
check(logic.hex_of(b'\x00\xff') == '00ff', 'checksums print as hex')

# the update list in the repository is current
import subprocess   # noqa: E402
res = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'board_manifest.py'), '--check'],
                     capture_output=True, text=True)
check(res.returncode == 0, 'board/CIRCUITPY/manifest.json is up to date')
with open(os.path.join(ROOT, 'manifest.json')) as f:
    man = json.load(f)
check(logic.plan_update({}, man) is not None, 'the repository list passes the board\'s own checks')
check(not any(k in man['files'] for k in ('boot.py', 'code.py', 'config.json')),
      'the list never names boot.py, code.py or settings')

# ---------- boot.py finishes an update ----------
tree = ast.parse(open(os.path.join(ROOT, 'boot.py')).read())


class PowerCut(Exception):
    pass


def run_boot(drive, down_held=False, cut_after=None):
    """Run boot.py against a stand-in drive. cut_after stops it, as a power cut would, after that many steps on the
    drive, where a step is a rename, a removal or one write into a file (which stays half written)."""
    real = os
    steps = [0]

    def step():
        if cut_after is not None and steps[0] >= cut_after:
            raise PowerCut()
        steps[0] += 1

    def rename(a, b):
        step()
        real.rename(at(a), at(b))

    def remove(p):
        if real.path.exists(at(p)):
            step()
        real.remove(at(p))

    class Cutting:
        def __init__(self, f):
            self.f = f

        def __enter__(self):
            return self

        def __exit__(self, *a):
            self.f.close()

        def write(self, text):
            step()
            self.f.write(text)

        def __iter__(self):
            return iter(self.f)

    def opener(p, mode='r', *a, **k):
        f = open(at(p), mode, *a, **k)
        return Cutting(f) if 'w' in mode else f

    def at(p):
        return real.path.join(drive, p.lstrip('/'))

    fake_os = types.SimpleNamespace(
        remove=remove, rename=rename,
        stat=lambda p: real.stat(at(p)))
    pin = types.SimpleNamespace(value=not down_held, switch_to_input=lambda pull=None: None, deinit=lambda: None)
    mods = {'board': types.SimpleNamespace(BUTTON_DOWN=1),
            'digitalio': types.SimpleNamespace(DigitalInOut=lambda p: pin, Pull=types.SimpleNamespace(UP=1)),
            'storage': types.SimpleNamespace(remount=lambda *a, **k: None), 'os': fake_os}
    saved = {k: sys.modules.get(k) for k in mods}
    sys.modules.update(mods)
    try:
        exec(compile(tree, 'boot.py', 'exec'), {'open': opener, '__name__': 'boot'})
    except PowerCut:
        return True
    finally:
        for k, v in saved.items():
            if v is None:
                del sys.modules[k]
            else:
                sys.modules[k] = v


def write(drive, path, text):
    p = os.path.join(drive, path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w') as f:
        f.write(text)


def read(drive, path):
    try:
        with open(os.path.join(drive, path)) as f:
            return f.read()
    except OSError:
        return None


with tempfile.TemporaryDirectory() as drive:
    write(drive, 'sky/app.py', 'old')
    write(drive, 'sky/gone.py', 'old')
    write(drive, 'manifest.json', 'old list')
    write(drive, 'sky/app.py.new', 'new')
    write(drive, 'sky/added.py.new', 'added')
    write(drive, 'manifest.json.new', 'new list')
    write(drive, 'update.todo', 'put sky/app.py\nput sky/added.py\ndel sky/gone.py\nput manifest.json\nend\n')
    run_boot(drive)
    check(read(drive, 'sky/app.py') == 'new' and read(drive, 'sky/added.py') == 'added' and
          read(drive, 'sky/app.py.new') is None, 'boot.py swaps in the new files')
    check(read(drive, 'sky/gone.py') is None and read(drive, 'manifest.json') == 'new list', 'and drops removed ones')
    check(read(drive, 'update.todo') is None and read(drive, 'sky/app.py.old') == 'old', 'keeping the old ones aside')
    check(read(drive, 'update.trial').split('\n')[0] == '1', 'the first start of the new version is counted')
    run_boot(drive)
    run_boot(drive)
    check(read(drive, 'sky/app.py') == 'new' and read(drive, 'update.trial').split('\n')[0] == '3',
          'three starts that stopped early are counted')
    run_boot(drive)
    check(read(drive, 'sky/app.py') == 'old' and read(drive, 'sky/gone.py') == 'old' and
          read(drive, 'sky/added.py') is None and read(drive, 'manifest.json') == 'old list',
          'on the fourth start the earlier version comes back')
    check(read(drive, 'manifest.refused') == 'new list' and read(drive, 'update.trial') is None,
          'and the failed list is kept so it is not fetched again')

with tempfile.TemporaryDirectory() as drive:
    write(drive, 'sky/app.py', 'old')
    write(drive, 'sky/app.py.new', 'new')
    write(drive, 'manifest.json.new', 'new list')
    write(drive, 'update.todo', 'put sky/app.py\nput manifest.json\nend\n')
    run_boot(drive)
    sys.modules.pop('sky.store', None)
    from sky import store   # noqa: E402

    real_open, real_remove, real_stat = open, os.remove, os.stat
    store.open = lambda p, *a, **k: real_open(os.path.join(drive, p.lstrip('/')), *a, **k)
    store.os = types.SimpleNamespace(remove=lambda p: real_remove(os.path.join(drive, p.lstrip('/'))),
                                     stat=lambda p: real_stat(os.path.join(drive, p.lstrip('/'))),
                                     rename=lambda p, q: os.rename(os.path.join(drive, p.lstrip('/')),
                                                                   os.path.join(drive, q.lstrip('/'))))
    check(store.update_on_trial(), 'the program can tell an update is on trial')
    store.update_worked()
    check(read(drive, 'sky/app.py.old') is None and read(drive, 'manifest.json.old') is None and
          read(drive, 'update.trial') is None, 'after ten good minutes the old version is cleared away')
    check(not store.update_on_trial(), 'and the next update may come')
    run_boot(drive)
    check(read(drive, 'sky/app.py') == 'new', 'a version that proved itself stays')
    write(drive, 'sky/app.py.new', 'newer')
    store.write_list(store.TODO, ['put sky/app.py'])
    run_boot(drive)
    check(read(drive, 'sky/app.py') == 'newer' and store.update_on_trial(),
          'the list the updater writes is the one boot.py reads')

with tempfile.TemporaryDirectory() as drive:
    write(drive, 'sky/app.py', 'old')
    write(drive, 'sky/a.py', 'old')
    write(drive, 'sky/a.py.new', 'new')
    write(drive, 'update.todo', 'put sky/a.py\nput sky/app.py\nend\n')    # sky/app.py.new never finished downloading
    run_boot(drive)
    check(read(drive, 'sky/app.py') == 'old' and read(drive, 'sky/a.py') == 'old', 'half an update is not swapped in')
    check(read(drive, 'sky/a.py.new') is None and read(drive, 'update.todo') is None, 'its pieces are cleared away')

def staged(drive):
    write(drive, 'sky/app.py', 'old app')
    write(drive, 'sky/net.py', 'old net')
    write(drive, 'sky/gone.py', 'old gone')
    write(drive, 'manifest.json', 'old list')
    for name, text in (('sky/app.py', 'new app'), ('sky/net.py', 'new net'), ('sky/added.py', 'new added'),
                       ('manifest.json', 'new list')):
        write(drive, name + '.new', text)
    write(drive, 'update.todo', 'put sky/app.py\nput sky/net.py\nput sky/added.py\ndel sky/gone.py\n'
                                'put manifest.json\nend\n')


NEW = {'sky/app.py': 'new app', 'sky/net.py': 'new net', 'sky/added.py': 'new added', 'sky/gone.py': None,
       'manifest.json': 'new list'}
OLD = {'sky/app.py': 'old app', 'sky/net.py': 'old net', 'sky/added.py': None, 'sky/gone.py': 'old gone',
       'manifest.json': 'old list'}
JOURNALS = ('update.todo', 'update.swap', 'update.trial')


def leftovers(drive):
    return [n for j in JOURNALS for n in (j, j + '.new') if read(drive, n) is not None]


whole = True
for cut in range(0, 200):
    with tempfile.TemporaryDirectory() as drive:
        staged(drive)
        if not run_boot(drive, cut_after=cut):
            break
        run_boot(drive)
        now = {k: read(drive, k) for k in NEW}
        if now != NEW or read(drive, 'update.swap') is not None or read(drive, 'update.todo') is not None:
            whole = False
            print('      power cut after %d steps left %r' % (cut, now))
check(whole and cut > 20, 'a power cut at any step of the swap, writes included, is finished at the next start')

whole, tried = True, 0
for which in range(5):   # the start that loses power: the swap, the three that count, the one that takes it back
    for cut in range(0, 200):
        with tempfile.TemporaryDirectory() as drive:
            staged(drive)
            for _ in range(which):
                run_boot(drive)
            if not run_boot(drive, cut_after=cut):
                break
            tried += 1
            for _ in range(6):
                run_boot(drive)
            if ({k: read(drive, k) for k in OLD} != OLD or read(drive, 'manifest.refused') != 'new list' or
                    leftovers(drive)):
                whole = False
                print('      power cut on start %d after %d steps left %r, refused %r, lists %r' % (
                    which + 1, cut, {k: read(drive, k) for k in OLD}, read(drive, 'manifest.refused'),
                    leftovers(drive)))
check(whole and tried > 50, 'a power cut at any step of any start on trial still ends with the earlier version back')


def store_on(drive, cut_after=None):
    """Point sky/store.py at a stand-in drive, losing power after cut_after removals, renames or writes."""
    steps = [0]

    def at(p):
        return os.path.join(drive, p.lstrip('/'))

    def step():
        if cut_after is not None and steps[0] >= cut_after:
            raise PowerCut()
        steps[0] += 1

    def remove(p):
        if os.path.exists(at(p)):
            step()
        os.remove(at(p))

    def rename(a, b):
        step()
        os.rename(at(a), at(b))

    class Cutting:
        def __init__(self, f):
            self.f = f

        def __enter__(self):
            return self

        def __exit__(self, *a):
            self.f.close()

        def write(self, text):
            step()
            self.f.write(text)

    def opener(p, mode='r', *a, **k):
        f = open(at(p), mode, *a, **k)
        return Cutting(f) if 'w' in mode else f

    store.open = opener
    store.os = types.SimpleNamespace(remove=remove, rename=rename, stat=lambda p: os.stat(at(p)))


whole, tried = True, 0
for which in range(3):   # the start on which the new version reaches ten good minutes
    for cut in range(0, 200):
        with tempfile.TemporaryDirectory() as drive:
            staged(drive)
            for _ in range(which + 1):
                run_boot(drive)
            store_on(drive, cut)
            try:
                store.update_worked()
                break
            except PowerCut:
                pass
            tried += 1
            marked = store.read_list(store.TRIAL)[:1] == [['worked']]
            run_boot(drive)
            store_on(drive)
            store.update_worked()   # the next start that runs ten good minutes
            for _ in range(4):
                run_boot(drive)
            now = {k: read(drive, k) for k in NEW}
            olds = [k for k in NEW if read(drive, k + '.old') is not None]
            if now not in (NEW, OLD) or (marked and now != NEW) or olds or leftovers(drive):
                whole = False
                print('      power cut on start %d after %d steps of clearing left %r, old %r, lists %r' % (
                    which + 1, cut, {k: read(drive, k) for k in NEW}, olds, leftovers(drive)))
check(whole and tried > 3, 'a power cut while clearing away the earlier version never leaves a mix or takes it back')

with tempfile.TemporaryDirectory() as drive:
    store_on(drive)
    write(drive, 'config.json.tmp', json.dumps({'ssid': 'Home', 'lat': 28.5, 'lon': -81.4}))
    check((store.load_config() or {}).get('ssid') == 'Home', 'settings saved just as the power went are found')
    write(drive, 'config.json', json.dumps({'ssid': 'Old', 'lat': 1, 'lon': 2}))
    write(drive, 'config.json.tmp', '{"ssid": "Ha')
    check((store.load_config() or {}).get('ssid') == 'Old', 'a half-written spare copy leaves the settings alone')
    store.save_config({'ssid': 'New', 'lat': 1, 'lon': 2})
    check(store.load_config()['ssid'] == 'New' and read(drive, 'config.json.tmp') is None, 'settings are saved')

with tempfile.TemporaryDirectory() as drive:
    staged(drive)
    write(drive, 'update.todo', 'put sky/app.py\nput sky/net.py\n')   # cut before the rest of the list was written
    run_boot(drive)
    check(read(drive, 'sky/app.py') == 'old app' and read(drive, 'sky/net.py') == 'old net' and
          read(drive, 'update.trial') is None, 'a half-written to-do list is not trusted')
    staged(drive)
    write(drive, 'update.swap', 'put sky/app.py\n')                       # the first line of a swap list, no end
    run_boot(drive)
    check({k: read(drive, k) for k in NEW} == NEW and not read(drive, 'update.swap'),
          'a half-written swap list is passed over for the whole to-do list')

with tempfile.TemporaryDirectory() as drive:
    write(drive, 'boot.py', 'mine')
    write(drive, 'BOOT.PY.new', 'evil')
    write(drive, 'update.todo', 'put BOOT.PY\nend\n')
    run_boot(drive)
    check(read(drive, 'boot.py') == 'mine', 'a to-do naming BOOT.PY is refused too')

with tempfile.TemporaryDirectory() as drive:
    for name in ('boot.py', 'code.py'):
        write(drive, name, 'mine')
        write(drive, name + '.new', 'evil')
        write(drive, 'update.todo', 'put %s\nend\n' % name)
        run_boot(drive)
        check(read(drive, name) == 'mine', 'a to-do naming %s is refused' % name)

with tempfile.TemporaryDirectory() as drive:
    write(drive, 'sky/app.py', 'old')
    write(drive, 'sky/app.py.new', 'new')
    write(drive, 'update.todo', 'put sky/app.py\nend\n')
    run_boot(drive, down_held=True)
    check(read(drive, 'sky/app.py') == 'old' and read(drive, 'update.todo') is not None,
          'with Down held the drive is left to the computer and nothing is swapped')

# ---------- the setup page ----------
check(logic.escape('<a href="x">&\'') == '&lt;a href=&quot;x&quot;&gt;&amp;&#39;', 'text on the page is escaped')
check(logic.form_fields(b'ssid=My+Home%21&password=p%26ss%3Dw0rd&zip=32801') ==
      {'ssid': 'My Home!', 'password': 'p&ss=w0rd', 'zip': '32801'}, 'a form is read with its escapes')
check(logic.form_fields(b'ssid=Caf%C3%A9&x') == {'ssid': 'Café', 'x': ''}, 'accented Wi-Fi names survive')
check(logic.form_fields(b'a=%zz%4') == {'a': '%zz%4'}, 'a broken escape is kept as typed')
check(logic.antenna_address('192.168.50.224') == 'http://192.168.50.224:8099/data/aircraft.json', 'antenna address')
check(logic.antenna_address('http://10.0.0.5:8080/') == 'http://10.0.0.5:8080/data/aircraft.json', 'with a port')
check(logic.antenna_address('') == '', 'no antenna is fine')
for bad in ('8.8.8.8', 'example.com', '192.168.1.300', '192.168.1.2:99999', '172.32.0.1'):
    check(logic.antenna_address(bad) is None, 'not a home antenna: ' + bad)


def lookup(z):
    return (28.54, -81.38) if z == '32801' else None


good, err = web.read_choice({'pick': 'Home', 'password': 'longenough', 'zip': '32801'}, lookup)
check(good and good['ssid'] == 'Home' and good['lat'] == 28.54 and good['fresh'] and not err, 'a good form is taken')
check(web.read_choice({'ssid': ' Typed ', 'pick': 'Home', 'password': '', 'zip': '32801'}, lookup)[0]['ssid'] ==
      'Typed', 'a typed name wins over the list')
check(web.read_choice({'pick': 'Home', 'password': 'short', 'zip': '32801'}, lookup)[0] is None,
      'a password under 8 characters is refused')
check(web.read_choice({'pick': 'Home', 'password': 'longenough', 'zip': '99999'}, lookup)[0] is None,
      'an unknown ZIP is refused')
check(web.read_choice({'pick': '', 'zip': '32801'}, lookup)[0] is None, 'no network is refused')
check(web.read_choice({'pick': 'Home', 'zip': '32801', 'antenna': '8.8.8.8'}, lookup)[0] is None,
      'an antenna outside the home is refused')
pg = web.form_page(['<script>alert(1)</script>', 'Home'], '32801', '', 'Oops & more')
check('<script>alert' not in pg and '&lt;script&gt;' in pg and 'Oops &amp; more' in pg,
      'network names and errors cannot add to the page')


def ask(raw, networks=('Home',), old=None):
    a, b = socket.socketpair()
    out = {}

    def serve():
        out['choice'] = web.handle(b, list(networks), old or {}, lookup)
        b.close()

    th = threading.Thread(target=serve)
    th.start()
    a.sendall(raw)
    got = b''
    while True:
        chunk = a.recv(4096)
        if not chunk:
            break
        got += chunk
    th.join(5)
    a.close()
    return got.decode('utf-8', 'replace'), out.get('choice')


html, choice = ask(b'GET /hotspot-detect.html HTTP/1.1\r\nHost: captive.apple.com\r\n\r\n')
check(html.startswith('HTTP/1.1 200') and 'Set up your flight board' in html and choice is None,
      'any address shows the setup form')
body = b'pick=Home&ssid=&password=longenough&zip=32801&antenna='
html, choice = ask(b'POST /save HTTP/1.1\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: %d\r\n\r\n'
                   % len(body) + body)
check('Saved' in html and choice and choice['zip'] == '32801', 'posting the form saves the settings')
body = b'pick=Home&password=longenough&zip=12345'
html, choice = ask(b'POST /save HTTP/1.1\r\nContent-Length: %d\r\n\r\n' % len(body) + body)
check('not one the board knows' in html and choice is None and 'value="12345"' in html,
      'a bad ZIP shows the form again with the error and what was typed')
html, choice = ask(b'POST /save HTTP/1.1\r\nContent-Length: 999999\r\n\r\n')
check(html.startswith('HTTP/1.1 400') and choice is None, 'an oversized form is refused')
class Feed:
    def __init__(self, data):
        self.data = data

    def recv_into(self, buf):
        n = min(len(buf), len(self.data))
        buf[:n], self.data = self.data[:n], self.data[n:]
        return n


check(web.read_request(Feed(b'GET / HTTP/1.1\r\nX: ' + b'y' * 3000 + b'\r\n\r\n')) is None,
      'oversized headers are refused')
check(web.read_request(Feed(b'GET /a HTTP/1.1\r\n\r\n')) == ('GET', '/a', b''), 'a short request is read')
html, _ = ask(b'GET / HTTP/1.1\r\n\r\n', old={'error': "Couldn't join that Wi-Fi."})
check("Couldn&#39;t join that Wi-Fi." in html, 'the form says why the board came back to setup')

print('errors: %d' % len(errors))
sys.exit(1 if errors else 0)
