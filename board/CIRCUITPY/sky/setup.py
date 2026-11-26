# Setup mode: the board makes its own Wi-Fi network, shows its name on the panels, and serves the setup page to the
# phone that joins it. It comes on the first time the board starts, when the Up button is held while it is plugged
# in, and by itself when the Wi-Fi it was given would not let it join.
import time

import microcontroller
import socketpool
import wifi

from sky import store, web

NETWORK = 'skypuppy3d-setup'
ADDRESS = '192.168.4.1'


def heard_networks():
    names, seen = [], set()
    try:
        found = sorted(wifi.radio.start_scanning_networks(), key=lambda n: -n.rssi)
        wifi.radio.stop_scanning_networks()
    except (OSError, RuntimeError):
        return names
    for n in found:
        try:
            name = n.ssid
        except UnicodeError:
            continue
        if name and name not in seen and len(names) < 15:
            seen.add(name)
            names.append(name)
    return names


def run(screen, old, why=''):
    """Never returns: the board restarts once the phone has saved good settings."""
    old = dict(old or {})
    if why:
        old['error'] = why
    networks = heard_networks()
    try:
        wifi.radio.stop_station()
    except (AttributeError, OSError):
        pass
    wifi.radio.start_ap(NETWORK)
    pool = socketpool.SocketPool(wifi.radio)
    server = pool.socket(pool.AF_INET, pool.SOCK_STREAM)
    server.setsockopt(pool.SOL_SOCKET, pool.SO_REUSEADDR, 1)
    server.bind((str(wifi.radio.ipv4_address_ap or ADDRESS), 80))
    server.listen(2)
    server.settimeout(1)
    lines = (('Set me up: on your', 'phone join Wi-Fi'), ('Wi-Fi network:', NETWORK),
             ('Then open Safari to', ADDRESS))
    if why:
        lines = (("Couldn't join Wi-Fi", old.get('ssid', '')),) + lines
    turn = 0
    while True:
        top, bottom = lines[(turn // 4) % len(lines)]
        screen.show(top, bottom, screen_colour(top), 0x9aa4b0)
        turn += 1
        try:
            conn, _ = server.accept()
        except OSError:
            continue
        choice = None
        try:
            conn.settimeout(5)
            choice = web.handle(conn, networks, old, store.zip_place)
        except (OSError, RuntimeError, ValueError):
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass
        if choice is not None:
            try:
                store.save_config(choice)
            except OSError:
                screen.show("Can't save settings", 'Replug without Down')
                time.sleep(10)
                continue
            screen.show('Saved. Joining', choice['ssid'])
            time.sleep(3)
            microcontroller.reset()


def screen_colour(top):
    return 0xffb000 if top.startswith("Couldn't") else 0xffffff
