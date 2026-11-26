# What the board keeps on its own drive: its settings (config.json, which never leaves the board), the ZIP code
# table, and the update list.
import json
import os

from sky import logic

CONFIG = '/config.json'
ZIPS = '/zips.bin'
MANIFEST = '/manifest.json'
REFUSED = '/manifest.refused'
TRIAL = '/update.trial'
TODO = '/update.todo'


def load_config():
    c = None
    for path in (CONFIG, CONFIG + '.tmp'):   # the spare copy is the settings when the power went mid-save
        try:
            with open(path) as f:
                c = json.load(f)
        except (OSError, ValueError):
            continue
        if path != CONFIG:
            # put that whole copy in its place first, so the next save through the spare cannot spoil the only copy
            try:
                os.remove(CONFIG)
            except OSError:
                pass
            try:
                os.rename(path, CONFIG)
            except OSError:
                pass
        break
    if not isinstance(c, dict) or not isinstance(c.get('ssid'), str) or not c['ssid']:
        return None
    if not all(isinstance(c.get(k), (int, float)) for k in ('lat', 'lon')):
        return None
    c.setdefault('password', '')
    c.setdefault('antenna', '')
    return c


def save_config(c):
    """Write the settings, through a spare file so a power cut cannot leave half of them."""
    with open(CONFIG + '.tmp', 'w') as f:
        json.dump(c, f)
    try:
        os.remove(CONFIG)
    except OSError:
        pass
    os.rename(CONFIG + '.tmp', CONFIG)


def zip_place(zipcode):
    try:
        size = os.stat(ZIPS)[6]
        with open(ZIPS, 'rb') as f:
            return logic.find_zip(f, size, zipcode)
    except OSError:
        return None


def load_manifest(path=MANIFEST):
    try:
        with open(path) as f:
            m = json.load(f)
        return m if isinstance(m, dict) else {}
    except (OSError, ValueError):
        return {}


def free_bytes():
    try:
        s = os.statvfs('/')
        return s[0] * s[3]
    except (OSError, AttributeError):
        return 0


def make_folders(path):
    parts = path.split('/')[:-1]
    here = ''
    for p in parts:
        here += '/' + p
        try:
            os.mkdir(here)
        except OSError:
            pass   # it is already there


def remove(path):
    try:
        os.remove(path)
    except OSError:
        pass


def read_list(path):
    """Read one of the update lists, which end with a line "end" so a half-written one is never trusted (boot.py
    reads them the same way). When the power went between clearing a list and putting its new copy in place, the
    copy beside it with ".new" on its name is the list."""
    for p in (path, path + '.new'):
        try:
            with open(p) as f:
                lines = [line.strip().split(' ', 1) for line in f if line.strip()]
        except (OSError, ValueError):
            continue
        if lines and lines[-1] == ['end']:
            if p != path:
                # put that whole copy in its place first, so the next write beside it cannot spoil the only copy
                remove(path)
                os.rename(p, path)
            return lines[:-1]
    return []


def write_list(path, lines):
    """Write an update list whole beside its place, then put it there."""
    with open(path + '.new', 'w') as f:
        for line in lines:
            f.write(line + '\n')
        f.write('end\n')
    remove(path)
    os.rename(path + '.new', path)


def update_worked():
    """The new version has run long enough: forget the earlier one that boot.py kept in case it had to come back.
    The trial list is first marked "worked", before any earlier file goes, so a power cut part way through never
    leads boot.py to take back an update that is already half cleared away; boot.py finishes the clearing instead."""
    lines = read_list(TRIAL)
    if not lines:
        return
    if lines[0] != ['worked']:
        write_list(TRIAL, ['worked'] + ['%s %s' % (t[0], t[1]) for t in lines[1:] if len(t) == 2])
    for t in lines[1:]:
        if len(t) == 2 and (t[1] == 'manifest.json' or logic.safe_path(t[1])):
            remove('/' + t[1] + '.old')
    remove(TRIAL)
    remove(TRIAL + '.new')


def update_on_trial():
    for p in (TRIAL, TRIAL + '.new'):
        try:
            os.stat(p)
            return True
        except OSError:
            pass
    return False
