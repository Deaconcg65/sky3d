# Credits and data licenses

The MIT license in LICENSE covers the code in `src/` and `tools/`.

The built page `sky3d.html` and the files in `build/` also contain work by others:

- **three.js**, (c) 2010-2024 three.js authors, MIT License. Bundled into `sky3d.html`.
- **GSHHG** shoreline data by Paul Wessel and Walter H. F. Smith, GNU Lesser General Public License. Used, simplified, for the shoreline around New York and southern New England in `build/geo.json`.
- **Natural Earth** land, lakes and state lines, public domain. Used for the rest of the map and for the Hudson River.
- **United States Census Bureau** cartographic boundary files, public domain. Used for state lines near New York.
- **OurAirports** airports and runways, public domain. In `build/airports.json`.

At run time the page reads aircraft types, airline names and trail history from the tar1090 map page on the receiver, if it is there, and asks the adsb.im and api.adsb.lol services for routes and for the position of a followed flight.

Weather data by [Open-Meteo.com](https://open-meteo.com/), Creative Commons Attribution 4.0. The page asks api.open-meteo.com for the current weather at the place on screen. Open-Meteo's free service is for non-commercial use.

Network edition only: aircraft positions beyond the receiver's own antenna come from [ADSB.lol](https://adsb.lol/), Open Database License, with airplanes.live and adsb.fi as fallbacks. These are free community services for personal, non-commercial use, and their terms and limits can change.
