# Build notes: version 3.6 (November 15, 2026)

Written for whoever picks this up next, including a code reviewer. It records what is done, what is left in order, why some choices were made, and how to build and test. The pull request is https://github.com/Deaconcg65/sky3d/pull/1 (branch v3.6-controls into main).

## What this version is

A self-contained 3D web page that shows live aircraft from a home Raspberry Pi ADS-B receiver (readsb and tar1090). Two editions are built from one source: the home edition (antenna only) and the network edition (antenna plus public flight networks, through the relay in relay/relay.py). The page is shared on the internet at skypuppy3d.com through a Cloudflare tunnel, so treat every viewer as untrusted.

## Done in 3.6

- Keys: A auto tour (also pauses Follow until a flight is followed again), W wide, F fly, plus and minus zoom, H or ? help window, slash search, T trail length, C captions, S settings, L Listen, Space hold, right arrow next aircraft (when not flying), Escape closes the topmost window or leaves fly mode or a locked aircraft. Full screen moved to Shift and F.
- Fly mode: drag to look, up and down arrows move along the view, left and right arrows turn, Shift with up or down climbs and descends, wheel or plus and minus zoom. Returns to the auto tour after a pause (setting, default 30 seconds).
- Click an aircraft for its details for a while (setting, default 15 seconds). Double click zooms in and stays with it.
- Search over the aircraft the page is tracking: airline, flight number, tail number, plane type, origin or destination. Routes come from one batched request to the volunteer route table when the box opens, and a route that fails the nearness guard is shown as "route not known".
- Milwaukee added to the airport list. New York remains the default.
- Review fixes from Codex (commit 11155c8): fly mode direction, A with Follow, keyboard ownership while windows are open, stale search picks, scrolling search on short screens, on-screen-only clicks, database tail numbers, the 737 MAX alias, one request per database shard, screen reader support for results, a guard for incomplete route entries.
- Second Codex review (on GitHub, of commit 05b5935): after A pauses Follow, W and N or right arrow work again for the tour, and Escape or the fly timeout clears a Space hold so the tour moves on. One helper, followOwns(), now decides whether Follow has the camera; the network area lookup uses it too, so a paused Follow no longer pulls the network question toward the followed flight. Two checks were added to tools/controls.js for these.

## Left to do, in order

1. Codex reviews the branch on GitHub ("@codex review" on pull request 1; AGENTS.md gives it this file and the deliberate decisions). Findings come back to Claude to check and fix. Do not merge before Codex has no new real findings.
2. Merge the pull request. Then on the Raspberry Pi, run the installer line from the README and confirm the settings window ends with "Version 3.6, network edition, November 15, 2026".
3. Version 3.7: watch list (first entry N2RF, a Citation CJ4) and typed locations (airport, city or zip first; street addresses only with a privacy notice).
4. Version 3.8: aircraft gallery with realistic shapes (757, Gulfstream, Airbus, Citation CJ4, helicopter), a legend page with airline and military paint, and paint options for other aircraft including silly ones.
5. A no-antenna install for people who have no receiver (a relay that serves the page by itself on any always-on home computer, plus a README start-here section). The flight networks refuse cloud hosting, so it must run on a home connection.
6. Open items outside the code: a phone showed "403 Forbidden" on the shared address (waiting for a screenshot with the address bar); decide whether to keep the Cloudflare sign-in invite list or open the site; the combat flight game (fictional targets only) is logged and not started.

## Decisions and why

- Search covers every aircraft the page is tracking, not only those in view. Codex (finding 7) asked for a viewport check on search. This was not done on purpose: a viewer who searches for a flight wants to find it even when the camera is looking elsewhere, and flying to it is the point of the result. The wording in the box was corrected from "on screen" to "being tracked", which was the real flaw. Clicking on the sky does need the aircraft on screen, and that was fixed.
- The camera has no single owner yet. Codex recommended one explicit owner (tour, follow, fly or lock). It was adopted only in a small way: a follow.tour flag so A really leaves Follow, and a leaveControls function so Escape and the fly timeout return to Follow when one is active. A full rewrite of the camera modes was not done because it is a large change to the code that has been working for the auto tour, with no new mode yet that needs it. It should be done before the watch list jump-to-flight and the gallery add more ways to take the camera. A reviewer who disagrees should say so.
- Fly mode uses the camera's real heading, which is the negative of its orbit angle (orbit angle 90 faces west). The existing tour code uses the orbit angle directly; its behavior was not changed in this version.
- Escape always closes the topmost window first, wherever keyboard focus is, and gives focus back to the page. Keys are ignored behind the help, search and settings windows so nothing steers behind them.
- A drag or the mouse wheel starts fly mode by itself, so the mouse needs no mode switch. Touch is not designed in: no pinch zoom, double tap untested.
- Left arrow as "previous flight" was dropped because left arrow turns in fly mode.
- Search sends only callsigns and aircraft positions, never the viewer's place or typed text, to the route services, as the caption already does. Results are drawn with textContent.
- Plane type search spells out common type codes (B752 as 757, A20N as A320 neo) in the TYPE_WORDS table in src/main.js, because the data carries the short code and people type the name on the side of the aircraft.

## How to build

    npm install three@0.160.0 esbuild
    node tools/build.js

This writes build/sky3d.html (home edition) and build/sky3d-network.html (network edition). Copy both to the repository root to publish them. The map data files build/geo.json and build/airports.json are committed. To rebuild them, see "Build from source" in README.md.

## How to test

Start the simulated receiver in one window, then run the checks in another. Playwright and Chromium are needed.

    node tools/sim.js 8090

The simulator serves the home edition at http://localhost:8090/sky/ and the network edition at http://localhost:8090/net/ with simulated aircraft.

    node tools/controls.js     version 3.6 checks: fly heading at four headings, key ownership, search, follow and A (prints PASS or FAIL)
    node tools/ui.js           settings, follow, hold, reload
    node tools/shot.js         screenshots at chosen times
    node tools/live.js         the network edition with and without a receiver in reach
    node tools/door.js         the relay front door

The review loop on November 15 ran in a container with no browser, so the checks added there were written but not run; run node tools/controls.js once on a machine with Chromium before merging.

Things not tested: touch screens, Safari, a real antenna's data, the shared address through Cloudflare. The simulator has no real aircraft types, so plane type search was checked by logic and with fixtures, not with live data. Weather requests to the outside are blocked in the test environment, so a console error about them in the tests is expected.

## Files

- src/main.js: the page's code. src/template.html: the page and its styles. src/scene.js and src/util.js: drawing and helpers. src/airlines.js: airline names and paint.
- relay/relay.py and relay/install.sh: the relay and the one-line installer for the Pi. The relay was not changed in 3.6.
- sky3d.html and sky3d-network.html at the root are generated by tools/build.js. Review src/ instead of these.
