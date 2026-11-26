# The board's program, started by code.py. Shows the flights near it in turns with the weather and the clock, and a
# flight overhead takes over the screen until it has passed. See board/README.md in the repository.
import gc
import time

import board
import digitalio
import microcontroller
import supervisor

from sky import logic, store
from sky.screen import Screen, WHITE, GREY, AMBER

VERSION = '1'
FLIGHTS_EVERY = 10          # seconds between asks for flights
WEATHER_EVERY = 15 * 60
UPDATE_EVERY = 60 * 60
CARD_TURN = 3               # the second line of a flight card changes every 3 seconds
HEALTHY = 10 * 60           # after an update, this long running means the new version works

supervisor.runtime.autoreload = False

up = digitalio.DigitalInOut(board.BUTTON_UP)
up.switch_to_input(pull=digitalio.Pull.UP)
setup_asked = not up.value

screen = Screen()
screen.show('skypuppy3d', 'flight board v' + VERSION)
config = store.load_config()

if config is None or setup_asked:
    from sky import setup
    setup.run(screen, config)

from sky.net import Net, seconds   # noqa: E402  (setup mode does not need the internet code)

net = Net()
screen.show('Joining Wi-Fi', config['ssid'])
tries = 0
while not net.connect(config['ssid'], config['password']):
    tries += 1
    if config.get('fresh') and tries >= 4:
        # the settings were just typed and do not work: back to setup, so the phone can fix them
        from sky import setup
        setup.run(screen, config, "Couldn't join that Wi-Fi. Check the name and password.")
    screen.show("Can't join Wi-Fi", 'Hold Up + replug', AMBER)
    time.sleep(20)
    screen.show('Joining Wi-Fi', config['ssid'])
if config.get('fresh'):
    config['fresh'] = False
    try:
        store.save_config(config)
    except OSError:
        pass

lat, lon = config['lat'], config['lon']
antenna = config.get('antenna', '')
overhead = logic.Overhead()
turns = logic.Rotation()
planes, planes_at = [], -999
weather, weather_at = None, -999
update_at = seconds() + 120          # the first look for an update, two minutes after start
failures = 0
was_overhead = False
started = seconds()
trial_open = True

screen.show('Looking for', 'flights nearby')

while True:
    try:
        now = seconds()
        if now - planes_at >= FLIGHTS_EVERY:
            got = net.planes(lat, lon, antenna)
            planes_at = now
            if got is not None:
                planes, failures = got, 0
            else:
                failures += 1
            if failures >= 6:
                planes = []          # a minute with no answer: stop showing flights that may have gone
            if not net.connect(config['ssid'], config['password'], timeout=10):
                screen.show("Can't reach Wi-Fi", 'Trying again', AMBER)
        if now - weather_at >= WEATHER_EVERY:
            weather_at = now
            w = net.weather(lat, lon)
            if w is not None:
                weather = w
        if now >= update_at:
            update_at = now + UPDATE_EVERY
            if net.update():
                screen.show('Updating', 'back in a moment')
                time.sleep(2)
                microcontroller.reset()
        utc = net.utc()
        if utc is not None:
            hour = logic.local_hour(utc, net.zone)
            screen.night(hour >= 23 or hour < 6)

        shown = logic.nearby(planes)
        over = overhead.update(now, planes)
        net.ask_routes(([over] if over else []) + shown)
        phase = now // CARD_TURN
        if over:
            top, bottom = logic.flight_lines(over, net.route(over), phase)
            flash = now - overhead.since < 3 and now % 2 == 0
            screen.show(top, bottom, WHITE if flash else logic.colour_of(over), WHITE)
            was_overhead = True
        else:
            if was_overhead:
                turns.restart()
                was_overhead = False
            kind, i = turns.frame(now, shown, weather is not None)
            if kind == 'flight':
                p = shown[i]
                top, bottom = logic.flight_lines(p, net.route(p), phase)
                screen.show(top, bottom, logic.colour_of(p), GREY)
            elif kind == 'weather':
                screen.show(weather[0], weather[1], WHITE, GREY)
            elif kind == 'credit':
                screen.show('Flights from', net.source or 'free networks', GREY, GREY)
            else:
                if utc is None:
                    screen.show('skypuppy3d', 'Waiting for time', WHITE, GREY)
                else:
                    a, b = logic.clock_lines(utc, net.zone)
                    screen.show(a, b, WHITE, GREY)
        if trial_open and now - started >= HEALTHY:
            store.update_worked()
            trial_open = False
        gc.collect()
        time.sleep(0.2)
    except MemoryError:
        microcontroller.reset()
    except Exception as e:   # anything unexpected: show it briefly, then carry on
        screen.show('Oops, retrying', str(e)[:21], AMBER)
        time.sleep(5)
