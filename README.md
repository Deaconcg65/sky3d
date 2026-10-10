# 3D sky

Live aircraft from a readsb or dump1090 receiver, drawn in three dimensions in a web browser. The camera glides from aircraft to aircraft, settles beside each one, then pulls back to the whole sky. The sky colour follows the real time of day.

It is one self-contained page, `sky3d.html`. Nothing is installed. Put the page on the receiver's web server and open it.

## Install on a receiver that runs readsb with the tar1090 map page

Log in to the receiver and run this one line. It also updates an existing copy to the latest version.

    sudo mkdir -p /var/www/html/sky && sudo wget -O /var/www/html/sky/index.html https://raw.githubusercontent.com/Deaconcg65/sky3d/main/sky3d.html

Then open `http://<receiver address>/sky/` in a browser on the same network.

It starts centered between LaGuardia and Kennedy in New York. If you are somewhere else, press S, choose "Another airport" under "Center the sky on", and type your airport code.

To remove it: `sudo rm -r /var/www/html/sky`

The page reads `/tar1090/data/aircraft.json` once a second. It also looks in `/data/` and `/skyaware/data/`, so a dump1090-fa receiver works too. To point it somewhere else, add `?data=/some/path/` to the address.

## What leaves your network

Nothing from your antenna is sent anywhere. Two lookups go out, each carrying only a flight's callsign:

- The route (origin and destination) of the aircraft being visited, from the adsb.im route service that the tar1090 map page also uses, with api.adsb.lol as a fallback.
- In follow mode only, the position of the one flight you named, from api.adsb.lol, while it is beyond your antenna's reach.

## Build from source

    npm install three@0.160.0 esbuild
    python3 tools/geo.py <folder of downloaded map data> build/geo.json <folder of GSHHG data>
    python3 tools/airports.py <folder of OurAirports csv files> build/airports.json
    node tools/build.js

`tools/sim.js` is a stand-in receiver for testing. `tools/motion.js` drives the page with a step-by-step clock and measures how smooth the camera and aircraft are.

## Credits

three.js (MIT). Shorelines from GSHHG (Wessel and Smith, LGPL) and Natural Earth (public domain). State lines from the United States Census Bureau. Airports and runways from OurAirports (public domain). Aircraft types, airline names and trail history come from the tar1090 map page already on the receiver.

No support is promised. Use it, change it, share it.
