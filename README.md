# 3D sky

Live aircraft from a readsb or dump1090 receiver, drawn in three dimensions in a web browser. The camera glides from aircraft to aircraft, settles beside each one, then pulls back to the whole sky.

New in version 3.10: regional flights from Republic, SkyWest and Mesa are named for the airline passengers booked, such as "Delta Air Lines, operated by Republic Airways" over DL 5604, when the route shows which partner it is, and "flying for a partner" when it does not; Horizon Air shows as Alaska Airlines; aircraft at or just below sea level read "near the ground" instead of minus so many feet; a private aircraft says so, and an airline flight with no route found says "Route not known" instead of a blank line.

New in version 3.9: click an airport code on the map (JFK, LGA, EWR and the others) to make that airport the center of the sky; the 747 is drawn with its hump, the A380 with its double deck the whole length, and small single-engine planes with a propeller; business jets such as Citations, Learjets and Gulfstreams have their own shape with the engines at the back and a T-tail; the shape changes as soon as the aircraft's type is known, even while the camera rides on it; origins and destinations are asked through the relay on the receiver, and the caption names both ends of the trip, with Departing or Arriving in front near an airport.

New in version 3.8.1: the arrow keys no longer stop working after a setting is ticked (an arrow key now closes the settings and takes the controls, and a click on the sky closes the settings, My places and search); in fly mode the keys are listed in the lower right corner for as long as you fly; and small planes such as the Cessna 172 are no longer drawn as four-engine airliners, the Hawker business jet no longer as a helicopter, and the Airbus A318 and A319 no longer as wide bodies.

New in version 3.8: satellite photos on the ground, switched on in the settings with "Satellite photos on the ground". The photos are EOxCloudless (Sentinel-2) pictures, free for personal, non-commercial use. Each viewer's browser fetches them straight from EOX, so the receiver does no extra work. Where a photo has not loaded, the drawn map shows as before.

New in version 3.7.1: press P for a small window with just your places; one click moves the sky there. Moving the sky to a far place now rises, fades and comes down instead of gliding across the map (only a fade with the system's reduce motion setting). Captions show where more flights come from, including the leg of a flight that makes a stop. To add one of My places, type an address, a city or a latitude and longitude, then pick the right answer; it is looked up the same way as Find a place. Also fixed: a place added while the page was open in a second tab or window could be lost, and a note could say a place would be forgotten after Keep my places was ticked.

New in version 3.7:

- Watch list, both editions. In the settings, list up to 10 tail numbers or flight numbers (N2RF is there to start on your own screens). When one is seen, an alert line appears at the top of the page with Follow and Dismiss, with a short chime. The home edition alerts when your antenna hears one. The network edition also asks the flight networks about each one, through the relay, about every two minutes, so it alerts wherever in the world the aircraft is flying. A new alert for the same aircraft comes only after it has been out of sight for 20 minutes. On the secure (https) address you can also allow a browser notification for when the page is in the background. Alerts come only while a page is open.
- Find a place. In the settings, type an airport code, a city, a zip code or an address and press Enter or Find, then pick a result to center the sky there. It joins My places. Airport codes are found on the page itself. In the network edition anything else is looked up through the relay on your receiver with the OpenStreetMap place finder, so the place finder sees your receiver's address, not the viewer's. Only the typed words are sent, and only when Enter or Find is pressed. The home edition searches its own airport list by code, name or city.

New in version 3.6, both editions: you can take the controls. Press H in the page for the full list.

- Keys. A is the auto tour, W pulls back to the whole sky, F takes the controls (fly mode), plus and minus zoom, S is the settings, L is Listen, Space holds on an aircraft. Full screen moved to Shift and F. T changes the trail length and C turns captions on or off.
- Fly mode. Drag with the mouse to look around, use the arrow keys to move (up and down go forward and back, left and right turn, Shift with up or down climbs or descends), and use the mouse wheel or plus and minus to zoom. With no input for a while, the page goes back to the auto tour.
- Click an aircraft to see its details for a while (a setting). Double click to zoom in and stay with it. Escape or A goes back to the auto tour. Pressing A also pauses Follow until you follow a flight again.
- Taking over (version 3.12.1). When you fly, click or double-click an aircraft, or pick one in search, the auto tour stops moving from plane to plane and waits. It starts again after the time you choose in the settings (a minute, 3 minutes, 5 minutes, or never), counted from the last time you touched the controls. A, W or Escape starts it again at once.
- Search. Press the slash key, or the Search button, and look for aircraft on screen by airline, flight number, tail number, plane type (757, A320, helicopter), origin or destination. It looks through the aircraft the page is tracking, not only the ones in view. Origins and destinations come from the volunteer route table, which has gaps, so a flight with no route on file says "route not known" and is never guessed.
- Network edition: Milwaukee joins the list of places to center on. New York is still the default.

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

Web browsers are not allowed to read the free flight networks directly, because those networks do not give web pages that permission. The network edition therefore reads them through a relay: a small helper, `relay/relay.py`, that runs on the receiver, fetches the list over your home internet connection, and hands it to the page. It listens on port 8099 inside your home network and passes on only four kinds of question: aircraft around a point, one flight by callsign, one aircraft by registration, and a typed place. It tries four free flight networks in turn. Places are looked up with the OpenStreetMap place finder (Nominatim), at most once a second and about 200 times an hour for all viewers together, and each answer is kept for a day so the same words are not sent again. Opening `http://<receiver address>:8099/check` from inside your home network shows which of them are answering.

The relay has to run at home. The flight networks ration or refuse requests that come from shared cloud hosting, so a relay on a free cloud service does not work. For the same reason the public copy of the network edition cannot show aircraft by itself.

The install line for the network edition, above, installs the page and the relay together. Without the relay the network edition still shows everything your own antenna hears.

The relay answers the 3D sky page that came from the same address and refuses pages on other sites. It keeps no log of who asks or what they ask.

## Sharing it outside your house

To let people outside your home network watch, with your antenna in the picture, run a secure tunnel on the receiver and point it at the relay, `http://localhost:8099`, not at the receiver's web server on port 80. It was written with Cloudflare Tunnel in mind. The relay is built to be the only thing an outside address reaches. Through it, an outsider can open:

- the 3D sky page, at `/sky/`. The bare address forwards there.
- your antenna's aircraft list and the last few minutes of history, cut down to the few facts the page draws: which aircraft, where, how high, how fast and which way, plus only the military mark from each aircraft's record flags (for the military paint; other flags, such as an owner's privacy request, are dropped). Everything else is left behind, including every clue to where the antenna stands: the receiver's own position, each aircraft's distance and direction from the antenna, signal strength, and the rough positions a receiver guesses from its own.
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
- Network edition only, the watch list: each tail number or flight number on it, asked about by the relay on your receiver, one at a time, each about every two minutes, and never while the page already sees it.
- Network edition only, Find a place: the words you typed, sent by the relay on your receiver to nominatim.openstreetmap.org when you press Enter or Find. Airport codes are found on the page and sent nowhere. If you type a street address, that address is what is sent. Your position is never sent with it.
- Only when you press Photo or I on a caption: the aircraft's hex code and tail number, sent to api.planespotters.net to find a photo. In the network edition the relay on your receiver asks, at most one question every two seconds for all viewers together, and keeps each answer a day; in the home edition your own browser asks. The photo itself then loads in your browser from Planespotters' picture server, which sees your address but is not told where you are.
- The weather for the place on screen, from api.open-meteo.com. Only a position rounded to a quarter of a degree (about 17 miles) is sent. Choose "Always clear" under Weather in the settings to switch this off.

- Only with "Satellite photos on the ground" switched on (it is off to start): photo tiles of the area on screen, fetched by the viewer's own browser from tiles.maps.eox.at, not through the receiver. The tiles asked for show EOX roughly which area is on screen, down to a few miles when close in, including around one of your places when the sky is centered on it.

Your own places ("My House" and the like) are never sent anywhere by name or by exact position. Centering the sky on one sends only the rounded positions described above.

## Build from source

    npm install three@0.160.0 esbuild
    python3 tools/geo.py <folder of downloaded map data> build/geo.json <folder of GSHHG data>
    python3 tools/airports.py <folder of OurAirports csv files> build/airports.json
    python3 -I tools/towns.py <cities.pbf from the all-the-cities package, see the top of tools/towns.py> build/towns.txt
    node tools/build.js

`tools/build.js` writes both editions to `build/`. The switch between them is the `__NET__` value it sets.

`tools/sim.js` is a stand-in receiver for testing. `tools/motion.js` drives the page with a step-by-step clock and measures how smooth the camera and aircraft are. `tools/paint.js` draws a line-up of aircraft in their paint. `tools/wx.js` checks each weather choice. `tools/lights.js` checks the landing lights. `tools/blend.js` and `tools/live.js` check the network edition. `tools/door.js` checks the relay as a front door, `tools/places.js` checks that places stay private, and `tools/aged.js` checks that aircraft stay smooth when viewers share an answer.

To add or correct an airline's paint, edit the `LIVERY` table in `src/airlines.js`.

## Credits

three.js (MIT). Shorelines from GSHHG (Wessel and Smith, LGPL) and Natural Earth (public domain). State lines from the United States Census Bureau. Airports and runways from OurAirports (public domain). Places from GeoNames (CC BY 4.0). Weather data by Open-Meteo.com (CC BY 4.0). Flight network data by ADSB.lol (ODbL), a community network of volunteer receivers. Aircraft types, airline names and trail history come from the tar1090 map page already on the receiver.

No support is promised. Use it, change it, share it.
