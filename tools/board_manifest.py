"""Write board/CIRCUITPY/manifest.json, the list the LED boards read once an hour to see what changed.

Every file under board/CIRCUITPY is listed with its size and its SHA-256 and SHA-1, except boot.py and code.py
(which a board never replaces), the owner's own settings (config.json, settings.toml) and anything whose name starts with a dot.
Run it after changing any board file, and commit the new list with the change:

    python3 -I tools/board_manifest.py          write the list
    python3 -I tools/board_manifest.py --check  fail if the list is out of date
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', 'board', 'CIRCUITPY'))
SKIP = ('boot.py', 'code.py', 'manifest.json', 'manifest.refused', 'config.json', 'settings.toml')


def listing():
    files = {}
    for folder, dirs, names in os.walk(ROOT):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d != '__pycache__')
        for n in sorted(names):
            path = os.path.relpath(os.path.join(folder, n), ROOT).replace(os.sep, '/')
            if n.startswith('.') or path in SKIP or n.endswith('.pyc'):
                continue
            with open(os.path.join(folder, n), 'rb') as f:
                data = f.read()
            files[path] = {'sha': hashlib.sha256(data).hexdigest(), 'sha1': hashlib.sha1(data).hexdigest(),
                           'size': len(data)}
    return {'board': 'skypuppy3d LED flight board', 'files': files}


def main():
    text = json.dumps(listing(), indent=1, sort_keys=True) + '\n'
    out = os.path.join(ROOT, 'manifest.json')
    if '--check' in sys.argv:
        try:
            with open(out, encoding='utf-8') as f:
                same = f.read() == text
        except OSError:
            same = False
        if not same:
            sys.exit('board/CIRCUITPY/manifest.json is out of date: run python3 -I tools/board_manifest.py')
        print('board/CIRCUITPY/manifest.json is up to date')
        return
    with open(out, 'w', encoding='utf-8') as f:
        f.write(text)
    print('board/CIRCUITPY/manifest.json lists %d files' % len(json.loads(text)['files']))


if __name__ == '__main__':
    main()
