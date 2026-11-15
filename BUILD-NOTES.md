# Build notes: version 3.7 (November 15, 2026)

Written for whoever picks this up next, including a code reviewer. It records what is done, what is left in order, why some choices were made, and how to build and test. Version 3.7 is pull request https://github.com/Deaconcg65/sky3d/pull/2 (branch v3.7-watch-list into main). Version 3.6 was pull request 1, merged November 15.

## What this version is

A self-contained 3D web page that shows live aircraft from a home Raspberry Pi ADS-B receiver (readsb and tar1090). Two editions are built from one source: the home edition (antenna only) and the network edition (antenna plus public flight networks, through the relay in relay/relay.py). The page is shared on the internet at skypuppy3d.com through a Cloudflare tunnel, so treat every viewer as untrusted.

## Done in 3.7

- Watch list (both editions). Settings hold up to 10 tail numbers or flight numbers, kept on the device like Follow. N2RF is on the list to start on the receiver's own screens (plain http address); guests on the shared https address start with an empty list. Every second the page looks for each one among the aircraft it is tracking. In the network edition it also asks the flight networks through the relay, one entry at a time: a flight number with an airline code (DAL2210) as a callsign, anything else as a registration. One question at most every 15 seconds, so each entry is asked about every two minutes with one entry and every 150 seconds with ten, and never while the page is already tracking it (seen in the last 30 seconds). With no relay beside the page, nothing is asked.
- The alert: a line at the top of the page, "N2RF is in the air: Cessna 525C Citation CJ4, 41,000 feet, near ..., 140 miles from New York", with Follow (sets Follow to that aircraft) and Dismiss. Also a short two-note chime (only after the viewer has touched the page, as browsers require; setting "Play a sound"), the tab title "N2RF spotted - 3D sky", and on the https address only, if the viewer allows it, a browser notification while the page is in the background. A new alert for the same aircraft comes only after it has been out of sight for 20 minutes. Each row in the settings list shows when the aircraft was last seen.
- Find a place (both editions). In the settings, type and press Enter or Find. An airport code is found in the page's airport list. In the network edition anything else goes to the relay as a fourth kind of question, /place/<typed words>, and the relay asks the OpenStreetMap place finder (Nominatim): only the typed words, at most one question a second and about 200 an hour for all viewers together, answers kept a day, the program named in its User-Agent, answers cut to name, position and kind. A picked result joins My places (same keep rules) and centers the sky. The home edition has no relay, so it searches its airport list by code, name or city.
- Follow and the watch list share one way of recognizing an aircraft (callsign, reported registration, registration from the aircraft table, or hex code, dashes ignored). Codex found that Follow on an alert could miss an aircraft whose tail number came only from the aircraft table; fixed, with a browser check. Follow also keeps a dashed tail number (9H-ABC) for the registration question, so an aircraft found only through the networks, with a callsign of its own, can be followed from its alert (second Codex finding, with a browser check).
- tools/sim.js now creates dl/db before saving aircraft tables into it (a fresh clone printed "curl: (56) Failure writing output").
- Checks: tools/door.js covers the relay's place questions (only the words go out, answers trimmed, kept, one a second, bad input refused) and passes. tools/controls.js has new checks for the watch list and Find a place, not yet run (no browser in the build container).

## Done in 3.6

- Keys: A auto tour (also pauses Follow until a flight is followed again), W wide, F fly, plus and minus zoom, H or ? help window, slash search, T trail length, C captions, S settings, L Listen, Space hold, right arrow next aircraft (when not flying), Escape closes the topmost window or leaves fly mode or a locked aircraft. Full screen moved to Shift and F.
- Fly mode: drag to look, up and down arrows move along the view, left and right arrows turn, Shift with up or down climbs and descends, wheel or plus and minus zoom. Returns to the auto tour after a pause (setting, default 30 seconds).
- Click an aircraft for its details for a while (setting, default 15 seconds). Double click zooms in and stays with it.
- Search over the aircraft the page is tracking: airline, flight number, tail number, plane type, origin or destination. Routes come from one batched request to the volunteer route table when the box opens, and a route that fails the nearness guard is shown as "route not known".
- Milwaukee added to the airport list. New York remains the default.
- Review fixes from Codex (commit 11155c8): fly mode direction, A with Follow, keyboard ownership while windows are open, stale search picks, scrolling search on short screens, on-screen-only clicks, database tail numbers, the 737 MAX alias, one request per database shard, screen reader support for results, a guard for incomplete route entries.
- Second Codex review (on GitHub, of commit 05b5935): after A pauses Follow, W and N or right arrow work again for the tour, and Escape or the fly timeout clears a Space hold so the tour moves on. One helper, followOwns(), now decides whether Follow has the camera; the network area lookup uses it too, so a paused Follow no longer pulls the network question toward the followed flight. Two checks were added to tools/controls.js for these.
- Third Codex review (of commit 4b6cb9d): a flight submitted in Settings, Follow, now takes the camera from a locked aircraft or fly mode; before, a lock kept the camera as long as the locked aircraft stayed in reach. A check was added to tools/controls.js.
- Fourth Codex review (of commit 4a15953): while following a flight, clicking another aircraft and then pressing N, right arrow or W no longer leaves the followed flight without its caption. Those keys now end the clicked details the same way their timer does. A check was added to tools/controls.js.

## Left to do, in order

1. Done November 15: version 3.6 reviewed clean by Codex, browser checks passed on Chris's Mac (23 of 23), merged.
2. On the Raspberry Pi, run the installer line from the README and confirm the settings window ends with the new version. After 3.7 merges this shows "Version 3.7, network edition, November 15, 2026". The relay changed in 3.7, and the installer installs it too.
3. Version 3.7 (pull request 2, built; see "Done in 3.7"): watch list (first entry N2RF, a Citation CJ4) and typed locations (airport, city or zip first; street addresses only with a privacy notice).
   Decisions from Chris (November 15):
   - Watch list: he wants an alert, and he builds his own list of aircraft to be alerted about whenever one is seen anywhere, not only by the antenna. N2RF stays the first entry.
   - Typed places: yes to an outside lookup service that turns a typed place into a location.
   Rules for the place lookup: look up only when the viewer presses Enter or picks Search, never on each keystroke; send only the typed text, never the viewer's position; no API key in the page; keep to the service's usage limits and identify the app; cache answers; draw results with textContent.
   Recommended design (not yet built): in the network edition, send place lookups through the relay on the Pi as a fourth kind of question, like the three it already passes on. The relay then identifies the app, keeps the service's limit of about one request a second, shares and caches answers, and the service sees the Pi's address instead of each viewer's. The home edition has no relay, so it offers the airport list only.
   "Seen anywhere" means asking the flight networks by registration through the relay, which allows about 15 single-flight questions a minute for everyone together. So the watch list needs a size limit (about 10 aircraft, each checked every two minutes or so).
   Built: alerts while the page is open. Still open for Chris: an alert when no page is open would need the Pi to watch and send a notification to his phone, which is a bigger piece of work and needs a way to reach him.
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
- Watch list questions share the relay's single-flight allowance (about 15 a minute for everyone) with Follow. A full list of 10 costs one page about 4 questions a minute, so a few viewers with full lists could slow Follow down for others. The list is capped at 10, and guests on the shared address start with an empty list, to keep this small.
- The watch list asks the flight networks even when "Aircraft from" is set to the antenna only, because each entry is something the viewer asked for by name. Follow already behaves this way.
- Watch alerts do not move the camera. Follow on the alert hands the aircraft to the existing Follow, so no new camera mode was added before the camera owner rewrite.
- A watch entry is normalized like Follow: DL1234 becomes DAL1234, and a registration with a dash (C-GABC) keeps the dash for the network question and is compared without it.
- The place finder is OpenStreetMap's Nominatim because it needs no account or key and its usage rules (one request a second, name the program, keep answers, no search as you type) are the ones this page already planned around. Its data needs the credit "OpenStreetMap", shown under the box and in the page's header comment.
- A typed place becomes one of My places rather than a new kind of center, so it gets the same privacy rules: kept only on this device, and on the shared address only when "Keep my places" is ticked.
- Plane type search spells out common type codes (B752 as 757, A20N as A320 neo) in the TYPE_WORDS table in src/main.js, because the data carries the short code and people type the name on the side of the aircraft.

## How to build

    npm install three@0.160.0 esbuild
    node tools/build.js

This writes build/sky3d.html (home edition) and build/sky3d-network.html (network edition). Copy both to the repository root to publish them. The map data files build/geo.json and build/airports.json are committed. To rebuild them, see "Build from source" in README.md.

## How to test

Start the simulated receiver in one window, then run the checks in another. Playwright and Chromium are needed.

    node tools/sim.js 8090

The simulator serves the home edition at http://localhost:8090/sky/ and the network edition at http://localhost:8090/net/ with simulated aircraft.

    node tools/controls.js     version 3.6 and 3.7 checks: fly heading, key ownership, search, follow and A, watch list, find a place (prints PASS or FAIL)
    node tools/ui.js           settings, follow, hold, reload
    node tools/shot.js         screenshots at chosen times
    node tools/live.js         the network edition with and without a receiver in reach
    node tools/door.js         the relay front door

Run node tools/build.js before node tools/sim.js, because the simulator serves the built pages from build/. The relay checks need the simulator and the relay running together (see the top of tools/door.js), then node tools/door.js.

The review loops on November 15 ran in a container with no browser, so the browser checks added there were written but not run; run node tools/controls.js once on a machine with Chromium before merging.

Things not tested: touch screens, Safari, a real antenna's data, the shared address through Cloudflare. The simulator has no real aircraft types, so plane type search was checked by logic and with fixtures, not with live data. Weather requests to the outside are blocked in the test environment, so a console error about them in the tests is expected.

## Files

- src/main.js: the page's code. src/template.html: the page and its styles. src/scene.js and src/util.js: drawing and helpers. src/airlines.js: airline names and paint.
- relay/relay.py and relay/install.sh: the relay and the one-line installer for the Pi. In 3.7 the relay gained the place question (/place/...).
- sky3d.html and sky3d-network.html at the root are generated by tools/build.js. Review src/ instead of these.
