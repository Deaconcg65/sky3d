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


def load_config():
    try:
        with open(CONFIG) as f:
            c = json.load(f)
    except (OSError, ValueError):
        return None
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


def update_worked():
    """The new version has run long enough: forget the earlier one that boot.py kept in case it had to come back."""
    try:
        with open(TRIAL) as f:
            lines = [line.strip().split(' ', 1) for line in f if line.strip()]
    except OSError:
        return
    for t in lines[1:]:
        if len(t) == 2 and (t[1] == 'manifest.json' or logic.safe_path(t[1])):
            remove('/' + t[1] + '.old')
    remove(TRIAL)


def update_on_trial():
    try:
        os.stat(TRIAL)
        return True
    except OSError:
        return False
