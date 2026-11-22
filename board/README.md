# skypuppy3d LED flight board

A strip of LED lights for a wall or a table that shows the flights near it, in turns with the weather and the
clock. A flight overhead, within 3 miles and below 12,000 feet, takes over the screen until it has passed.

The plan, the parts and the reasons are in BUILD-NOTES.md under version 3.15. This folder is the board's software.

## What is in here

- `CIRCUITPY/` is copied as it is onto the board's drive. It runs on CircuitPython.
  - `boot.py` runs first at every start. It decides who may write to the drive, finishes a downloaded update, and
    puts the earlier version back when an update keeps failing. Updates never change it.
  - `code.py` only starts `sky/app.py`, the board's program, and restarts the board if it stops with an error.
    Updates never change it either.
  - `sky/logic.py` holds every decision: which flight is overhead, what each line says, the turns, the time
    zone, the ZIP code lookup, which update files may be written. `sky/web.py` is the setup page. Both run on a
    computer too, for the checks in `tools/board_test.py`.
  - `sky/net.py` asks the internet for flights, routes, weather and updates. `sky/screen.py` draws on the panels.
    `sky/setup.py` runs setup mode. `sky/store.py` reads and writes the board's own files.
  - `zips.bin` is the ZIP code table, built by `tools/board_zips.py`.
  - `manifest.json` lists every file with its size and checksum, built by `tools/board_manifest.py`.
  - `lib/` holds three Adafruit libraries (MIT license, see `lib/LICENSES.txt`).
- The board's own settings live only on the board, in `config.json`. That file is never in this repository.

## Setting it up where it hangs

1. Plug the board in. Its screen says to join the Wi-Fi network **skypuppy3d-setup** with a phone.
2. On the phone, join that network, then open Safari and go to **192.168.4.1**.
3. Pick the home Wi-Fi, type its password and the ZIP code, and tap **Save and restart**.

If the password was wrong, the board comes back to setup by itself after a couple of minutes. To change the Wi-Fi
later, hold the **Up** button while plugging the board in.

## Updates

Once an hour the board asks this repository, on GitHub, for `board/CIRCUITPY/manifest.json` from the main branch.
When a file's checksum has changed, it downloads that file beside the old one, checks its size and checksum, and
restarts; `boot.py` then swaps the new files in before anything else runs and keeps the old ones aside. When the
new version has run for ten minutes, the old files are cleared away. When it stops three starts in a row before
that, `boot.py` puts the old version back and remembers that list, so the board does not fetch it again; the next
change merged to main is tried as usual. Nothing ever connects in to the board, so
the home router needs no change and no account is needed. Anything merged to main reaches every board within the
hour, so every change to this folder goes through review first.

After changing any file in `CIRCUITPY/`, run `python3 -I tools/board_manifest.py` and commit the new list with it.
`python3 -I tools/board_test.py` checks the decisions, the setup page, the update rules and the swap in `boot.py`,
and that the list is current.

## Copying files onto the board by hand

Hold the **Down** button while plugging the board in. Its drive then opens on the computer for writing, as
CIRCUITPY. Unplug it and plug it in again without a button to go back to normal.

## Where its data comes from

- Flights: [airplanes.live](https://airplanes.live/), then [ADSB.lol](https://adsb.lol/), then
  [adsb.fi](https://adsb.fi/) when one does not answer, once every 10 seconds for a circle of about 10 miles. Each is
  a free community service for personal, non-commercial use. A board at a house with its own antenna reads that
  antenna first.
- Routes: adsb.im, then ADSB.lol, at most once a minute for up to five flights. Only the callsign and position are
  sent.
- Weather: the National Weather Service (api.weather.gov), every 15 minutes.
- The time: from the Date that these web servers send with every answer.
- ZIP codes: the Census Bureau's ZIP Code Tabulation Areas, by way of the us-zips package (MIT license).
