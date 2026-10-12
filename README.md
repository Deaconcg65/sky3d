# 3D sky

Live aircraft from a readsb or dump1090 receiver, drawn in three dimensions in a web browser. The camera glides from aircraft to aircraft, settles beside each one, then pulls back to the whole sky.

New in version 3.5:

- Sharing the page outside your house, safely. The relay is now also a front door: point a secure tunnel at it and people outside reach the 3D sky page and nothing else on the receiver. See "Sharing it outside your house" below.
- My places are private by design. They live in the viewer's own browser and are never sent to the receiver or saved on it. On a shared address they are not even kept in the browser unless the viewer ticks "Keep my places on this device", so nothing is left behind on a borrowed computer.
- The exact place on screen never leaves the browser. The flight network is asked about a position rounded to a tenth of a degree, about seven miles.
- When several screens watch the same sky they share one answer from the flight network, and aircraft now stay smooth when they do. Before, a shared answer a few seconds old could make aircraft step backwards.
- The relay refuses pages on other sites, limits how often any one viewer may ask, and never asks the flight networks more than about 60 times a minute however many people are watching.

New in version 3.4, both editions:

- My places. In the settings, give a place a name and paste its latitude and longitude from Google Earth or Google Maps. It gets a label and a marker on the ground and joins the "Center the sky on" list. Places are kept in your browser only.
- Listen. A button, and the L key, open LiveATC.net's own page for the airport nearest the view, in a new tab. The page does not play the audio itself.
- A guard against wrong routes. The route table is kept by volunteers and listed by callsign, so it is sometimes wrong. An aircraft low to the ground that is near neither end of its listed route no longer shows that route. Low aircraft with no route show "Arriving at", "Departing" or "Near" the airport beside them.
- Regional airlines that fly for one partner are shown by the partner's name and flight number, for example "Delta Air Lines, operated by Endeavor Air" and "DL 5123".

Fixed in version 3.3.1: the S key now closes the settings panel after a setting has been changed, in both editions.

New in version 3.3:

- Network edition: a setting for the most aircraft to take from the flight network, from 25 to 130.
- The corner count and the caption now credit your antenna with any aircraft it has heard in the last 20 seconds.

New in version 3.2:

- The network edition reads the flight network through a relay that runs on the receiver, because browsers may not read it directly and the networks turn away cloud hosting. See "The relay" below. Its install line now installs the page and the relay together.

New in version 3:

- The network edition, described above. In it, any aircraft your antenna hears is drawn from your antenna. The flight network only fills in the rest. The caption says which is which, and the corner readout counts both.
- The home edition is unchanged in behaviour. The code that reads the flight network is left out of it when it is built, not just switched off.

New in version 2:

- Aircraft wear their airline's colours, painted by zones (body, belly, stripe, tail, engines, wing tips). About 45 airlines have a full paint recipe. No logos or lettering.
- Red beacons flash on top of the tail fin and under the belly, by day as well as by night.
- Day, night, dawn and dusk follow the computer's clock and the sunrise and sunset for the place on screen. Dawn is cooler and pinker than dusk.
- Live weather for the place on screen: cloud, rain, snow, fog, wind and thunderstorms. Above the clouds, at cruising height, the sky clears.
- A small readout in the corner gives the time, sunrise, sunset and weather. It can be switched off in the settings.

New in version 2.1:

- In the dark, the flashing lights light the aircraft itself. The white wing tip strobes brighten the wings and body for an instant and the red beacons throw a brief red wash on the tail and belly.
- Landing lights with a beam, at dusk, at night and at dawn, on aircraft descending below 5,000 feet. A setting adds departures or switches them off. The receiver does not report lights, so this is judged from height and rate of descent.

It comes in two editions, built from the same source:

- **Home edition**, `sky3d.html`. Your receiver's own antenna and nothing else. This is the original, and it stays that way.
- **Network edition**, `sky3d-network.html`. Your antenna joined by a public flight network, so you also see what your antenna cannot hear: aircraft too low or too far, and the traffic around any airport you choose. It works with no receiver at all, from the network alone. A setting switches between "My antenna and the flight network", "My antenna only" and "The flight network only".

Each edition is one self-contained page. Nothing is installed. Put the page on the receiver's web server and open it.

A copy of the network edition is published at https://deaconcg65.github.io/sky3d/ . Away from a receiver it cannot show aircraft, for the reason given under "The relay" below.

## Install on a receiver that runs readsb with the tar1090 map page

Log in to the receiver and run one of these lines. The same line also updates an existing copy to the latest version.

Home edition, your antenna only:

    sudo mkdir -p /var/www/html/sky && sudo wget -O /var/www/html/sky/index.html https://raw.githubusercontent.com/Deaconcg65/sky3d/main/sky3d.html

Network edition, your antenna joined by the flight network. This also installs the small relay it needs (see "The relay" below):

    wget -q -O /tmp/sky3d-install.sh https://raw.githubusercontent.com/Deaconcg65/sky3d/main/relay/install.sh && sudo bash /tmp/sky3d-install.sh

Both lines put the page at the same address, so pick one. To change editions later, run the other line.

Then open `http://<receiver address>/sky/` in a browser on the same network.

It starts centered between LaGuardia and Kennedy in New York. If you are somewhere else, press S, choose "Another airport" under "Center the sky on", and type your airport code.

To remove it: `sudo rm -r /var/www/html/sky`. If you installed the network edition, also remove its relay: `sudo systemctl disable --now sky3d-relay && sudo rm -r /etc/systemd/system/sky3d-relay.service /usr/local/lib/sky3d`

The page reads `/tar1090/data/aircraft.json` once a second. It also looks in `/data/` and `/skyaware/data/`, so a dump1090-fa receiver works too. To point it somewhere else, add `?data=/some/path/` to the address.

## The relay (network edition only)

Web browsers are not allowed to read the free flight networks directly, because those networks do not give web pages that permission. The network edition therefore reads them through a relay: a small helper, `relay/relay.py`, that runs on the receiver, fetches the list over your home internet connection, and hands it to the page. It listens on port 8099 inside your home network and passes on only three kinds of question: aircraft around a point, one flight by callsign, and one aircraft by registration. It tries four free flight networks in turn. Opening `http://<receiver address>:8099/check` from inside your home network shows which of them are answering.

The relay has to run at home. The flight networks ration or refuse requests that come from shared cloud hosting, so a relay on a free cloud service does not work. For the same reason the public copy of the network edition cannot show aircraft by itself.

The install line for the network edition, above, installs the page and the relay together. Without the relay the network edition still shows everything your own antenna hears.

The relay answers the 3D sky page that came from the same address and refuses pages on other sites. It keeps no log of who asks or what they ask.

## Sharing it outside your house

To let people outside your home network watch, with your antenna in the picture, run a secure tunnel on the receiver and point it at the relay, `http://localhost:8099`, not at the receiver's web server on port 80. It was written with Cloudflare Tunnel in mind. The relay is built to be the only thing an outside address reaches. Through it, an outsider can open:

- the 3D sky page, at `/sky/`. The bare address forwards there.
- your antenna's aircraft list and the last few minutes of history, cut down to the few facts the page draws: which aircraft, where, how high, how fast and which way. Everything else is left behind, including every clue to where the antenna stands: the receiver's own position, each aircraft's distance and direction from the antenna, signal strength, and the rough positions a receiver guesses from its own.
- the aircraft type tables the page reads.
- the relay itself, under `/sky-relay`.

Nothing else on the receiver can be reached that way: not the tar1090 map page, not its statistics, not any other page on the web server. Search engines are asked not to list the address.

Things to know before you open it to anyone:

- Open means open. Anyone who has the address can watch. If you want to choose who gets in, put the tunnel provider's sign-in in front of it.
- The picture of what your antenna hears is a rough hint of where it is, to within some tens of miles. The exact spot is never sent.
- Everyone who watches uses your home internet connection, lightly: about 400 kilobytes to open the page, then a few kilobytes a second.
- The relay's limits protect the flight networks and your connection. Each viewer may send about 5 requests a second (the page needs about one and a half) and may cause a new question to the flight networks about once every two seconds. In total the flight networks are asked at most about 60 times a minute: 45 about areas and 15 about single flights. When that is reached, viewers get the last answer, marked with its age, for up to 30 seconds.
- Viewers who arrive through a tunnel all appear to come from the receiver itself, so the tunnel has to say who each one is. Cloudflare Tunnel does, in a header named `CF-Connecting-IP`, and that is what the relay reads. For another tunnel, set `SKY3D_VIEWER_HEADER` in the relay's service file to the header it uses. Without one, all outside viewers share a single allowance.
- The check page, `/check`, answers only another computer inside your home network, never an outside viewer.

`tools/door.js` checks all of this against the stand-in receiver.

## What leaves your network

Nothing from your antenna is sent anywhere, in either edition. These lookups go out:

- The route (origin and destination) of the aircraft being visited, from the adsb.im route service that the tar1090 map page also uses, with api.adsb.lol as a fallback.
- In follow mode only, the position of the one flight you named, from api.adsb.lol, while it is beyond your antenna's reach.
- Network edition only: the aircraft around the place on screen, fetched by the relay on your receiver from api.adsb.lol (with adsb.fi, airplanes.live and adsb.one as fallbacks). Only the centre of the view, rounded to a tenth of a degree (about seven miles), and a radius are sent. Choose "My antenna only" to switch this off. The home edition never makes this request.
- The weather for the place on screen, from api.open-meteo.com. Only a position rounded to a quarter of a degree (about 17 miles) is sent. Choose "Always clear" under Weather in the settings to switch this off.

Your own places ("My House" and the like) are never sent anywhere by name or by exact position. Centering the sky on one sends only the rounded positions described above.

## Build from source

    npm install three@0.160.0 esbuild
    python3 tools/geo.py <folder of downloaded map data> build/geo.json <folder of GSHHG data>
    python3 tools/airports.py <folder of OurAirports csv files> build/airports.json
    node tools/build.js

`tools/build.js` writes both editions to `build/`. The switch between them is the `__NET__` value it sets.

`tools/sim.js` is a stand-in receiver for testing. `tools/motion.js` drives the page with a step-by-step clock and measures how smooth the camera and aircraft are. `tools/paint.js` draws a line-up of aircraft in their paint. `tools/wx.js` checks each weather choice. `tools/lights.js` checks the landing lights. `tools/blend.js` and `tools/live.js` check the network edition. `tools/door.js` checks the relay as a front door, `tools/places.js` checks that places stay private, and `tools/aged.js` checks that aircraft stay smooth when viewers share an answer.

To add or correct an airline's paint, edit the `LIVERY` table in `src/airlines.js`.

## Credits

three.js (MIT). Shorelines from GSHHG (Wessel and Smith, LGPL) and Natural Earth (public domain). State lines from the United States Census Bureau. Airports and runways from OurAirports (public domain). Weather data by Open-Meteo.com (CC BY 4.0). Flight network data by ADSB.lol (ODbL), a community network of volunteer receivers. Aircraft types, airline names and trail history come from the tar1090 map page already on the receiver.

No support is promised. Use it, change it, share it.
