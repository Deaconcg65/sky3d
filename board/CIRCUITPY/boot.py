# Runs once when the board powers up, before code.py. This file is never changed by the board's updates.
#
# Normally the board keeps its own drive, so it can save its settings and install updates; a computer then sees the
# drive as read-only. Hold the Down button while plugging the board in to give the drive to the computer instead,
# for copying files onto it.
import board
import digitalio
import os
import storage

down = digitalio.DigitalInOut(board.BUTTON_DOWN)
down.switch_to_input(pull=digitalio.Pull.UP)
to_computer = not down.value
down.deinit()

if not to_computer:
    storage.remount('/', readonly=False)


def plain(path):
    # the same rule the updater uses (sky/logic.py, safe_path), written out here because this file never changes;
    # manifest.json is allowed here because the update itself replaces it
    ok = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-./'
    if not 0 < len(path) <= 80 or any(c not in ok for c in path):
        return False
    parts = path.split('/')
    if len(parts) > 3 or any(p in ('', '.', '..') or p.startswith('.') for p in parts):
        return False
    low = path.lower()   # the drive does not tell BOOT.PY from boot.py
    if low in ('boot.py', 'code.py', 'config.json', 'settings.toml', 'update.todo', 'update.trial', 'update.swap'):
        return False
    return not (low.endswith('.new') or low.endswith('.old'))


def there(path):
    try:
        os.stat('/' + path)
        return True
    except OSError:
        return False


def gone(path):
    try:
        os.remove('/' + path)
    except OSError:
        pass


def move(a, b):
    gone(b)
    if there(a):
        os.rename('/' + a, '/' + b)


def read_list(name):
    try:
        with open('/' + name) as f:
            return [line.strip().split(' ', 1) for line in f if line.strip()]
    except OSError:
        return []


def rename(a, b):
    os.rename('/' + a, '/' + b)


def write_list(name, first, steps):
    with open('/' + name, 'w') as f:
        if first is not None:
            f.write(first + '\n')
        for t in steps:
            f.write('%s %s\n' % (t[0], t[1]))


if not to_computer:
    # 1. Finish an update that the board downloaded before it restarted. Each new file sits beside the old one with
    # ".new" on its name, and update.todo lists them. The old files are kept with ".old" on their names, and
    # update.trial lists them, until the new version has run for ten minutes (sky/app.py then clears them).
    # update.swap is written before the first file is touched and removed after the last, and every step below can
    # be run again, so a power cut part way through is finished at the next start instead of leaving a mix.
    swap = read_list('update.swap')
    todo = swap or read_list('update.todo')
    if todo:
        names = [t[1].lower() for t in todo if len(t) == 2]
        good = all(len(t) == 2 and t[0] in ('put', 'del') and plain(t[1]) for t in todo)
        good = good and len(set(names)) == len(names)
        if good and not swap:
            good = all(there(t[1] + '.new') for t in todo if t[0] == 'put')
            if good:
                for t in todo:
                    gone(t[1] + '.old')   # left from long ago, not part of this update
                write_list('update.swap', None, todo)
        if good:
            for t in todo:
                name = t[1]
                if t[0] == 'put' and not there(name + '.new'):
                    continue                         # already swapped in
                if there(name):
                    if there(name + '.old'):
                        gone(name)                   # the old file is already kept aside
                    else:
                        rename(name, name + '.old')
                if t[0] == 'put':
                    rename(name + '.new', name)
            write_list('update.trial', '0', todo)
            gone('update.swap')
        else:
            for t in todo:
                if len(t) == 2 and plain(t[1]):
                    gone(t[1] + '.new')
        gone('update.todo')

    # 2. An update on trial: count this start. After three starts that each stopped before ten minutes, put the
    # earlier version back, and keep the update list that failed so the board does not fetch it again.
    trial = read_list('update.trial')
    if trial:
        try:
            starts = int(trial[0][0]) + 1
        except (ValueError, IndexError):
            starts = 99
        steps = [t for t in trial[1:] if len(t) == 2 and plain(t[1])]
        if starts > 3:
            move('manifest.json', 'manifest.refused')
            for t in steps:
                if t[0] == 'put':
                    gone(t[1])
                move(t[1] + '.old', t[1])
            gone('update.trial')
        else:
            with open('/update.trial', 'w') as f:
                f.write('%d\n' % starts)
                for t in steps:
                    f.write('%s %s\n' % (t[0], t[1]))
