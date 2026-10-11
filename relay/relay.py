#!/usr/bin/env python3
"""3D sky relay.

Web browsers are not allowed to read the free flight networks directly, because those networks do not give web pages
that permission. This relay is the go-between. It runs on the receiver itself: the 3D sky page asks the relay, the relay
asks a flight network over the home internet connection, and the relay hands the answer back to the page.

It listens on port 8099 and passes on only three kinds of question: aircraft around a point, one flight by callsign,
and one aircraft by registration. Opening http://<receiver address>:8099/check shows which flight networks answer it.

It needs nothing beyond the Python that comes with Raspberry Pi OS. It must run from a home internet connection:
the flight networks refuse or ration requests that come from shared cloud hosting.
"""
import json, os, re, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get('SKY3D_RELAY_PORT', '8099'))
AGENT = 'Mozilla/5.0 (compatible; 3d-sky-relay; +https://github.com/Deaconcg65/sky3d)'
NETWORKS = [
    ('adsb.lol', 'https://api.adsb.lol/v2/point/{0}/{1}/{2}', 'https://api.adsb.lol/v2/callsign/{0}', 'https://api.adsb.lol/v2/reg/{0}'),
    ('adsb.fi', 'https://opendata.adsb.fi/api/v2/lat/{0}/lon/{1}/dist/{2}', 'https://opendata.adsb.fi/api/v2/callsign/{0}', 'https://opendata.adsb.fi/api/v2/registration/{0}'),
    ('airplanes.live', 'https://api.airplanes.live/v2/point/{0}/{1}/{2}', 'https://api.airplanes.live/v2/callsign/{0}', 'https://api.airplanes.live/v2/reg/{0}'),
    ('adsb.one', 'https://api.adsb.one/v2/point/{0}/{1}/{2}', 'https://api.adsb.one/v2/callsign/{0}', 'https://api.adsb.one/v2/reg/{0}'),
]
TEST = os.environ.get('SKY3D_RELAY_TEST')   # for testing only: one stand-in network at this address
if TEST:
    NETWORKS = [('stand-in', TEST + '/v2/point/{0}/{1}/{2}', TEST + '/v2/callsign/{0}', TEST + '/v2/reg/{0}')]
POINT = re.compile(r'^/v2/point/(-?\d{1,2}(?:\.\d{1,4})?)/(-?\d{1,3}(?:\.\d{1,4})?)/(\d{1,3})$')
CALLSIGN = re.compile(r'^/v2/callsign/([A-Za-z0-9]{2,8})$')
REG = re.compile(r'^/v2/reg/([A-Za-z0-9-]{2,8})$')
KEEP_SECONDS = 4.0     # several screens watching the same sky share one answer, which goes easy on the flight networks
kept, lock, best = {}, threading.Lock(), [0]


def ask(address):
    """Ask one flight network. Returns (worked, status, text, how many aircraft)."""
    try:
        with urllib.request.urlopen(urllib.request.Request(address, headers={'Accept': 'application/json', 'User-Agent': AGENT}), timeout=7) as answer:
            status, text = answer.status, answer.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return False, e.code, e.read().decode('utf-8', 'replace')[:300], None
    except Exception as e:   # the network is down, slow, or not reachable
        return False, 0, str(e)[:300], None
    try:
        data = json.loads(text)
        aircraft = data.get('ac', data.get('aircraft')) if isinstance(data, dict) else None
    except ValueError:
        aircraft = None
    if not isinstance(aircraft, list):
        return False, status, text[:300], None
    return True, status, text, len(aircraft)


class Relay(BaseHTTPRequestHandler):
    server_version = '3d-sky-relay'

    def reply(self, status, body, kind='application/json; charset=utf-8', extra=None):
        data = body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Max-Age', '86400')
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/':
            return self.reply(200, '3D sky relay is running.', 'text/plain; charset=utf-8')
        if path == '/check':   # which flight networks answer this relay, asked for the sky over New York
            report = {}
            for name, point, _, _ in NETWORKS:
                started = time.time()
                worked, status, text, count = ask(point.format('40.71', '-73.83', '5'))
                report[name] = {'answered': worked, 'status': status, 'milliseconds': int((time.time() - started) * 1000), 'aircraft': count, 'says': '' if worked else text[:160]}
            return self.reply(200, json.dumps(report, indent=1))
        m = POINT.match(path)
        if m:
            which, values = 1, m.groups()
        else:
            m = CALLSIGN.match(path)
            if m:
                which, values = 2, (m.group(1).upper(),)
            else:
                m = REG.match(path)
                if not m:
                    return self.reply(404, 'Not found', 'text/plain; charset=utf-8')
                which, values = 3, (m.group(1).upper(),)
        with lock:
            hit = kept.get(path)
            if hit and time.time() - hit[0] < KEEP_SECONDS:
                return self.reply(200, hit[1], extra={'X-Flight-Network': hit[2]})
        tried = []
        for i in range(len(NETWORKS)):
            index = (best[0] + i) % len(NETWORKS)
            network = NETWORKS[index]
            worked, status, text, _ = ask(network[which].format(*values))
            if worked:
                with lock:
                    best[0] = index
                    kept[path] = (time.time(), text, network[0])
                    for old in [k for k, v in kept.items() if time.time() - v[0] > 60]:
                        del kept[old]
                return self.reply(200, text, extra={'X-Flight-Network': network[0]})
            tried.append('%s %s' % (network[0], status))
        self.reply(502, json.dumps({'error': 'The flight networks did not answer.', 'tried': tried}))

    def log_message(self, *args):   # keep the receiver's log quiet
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', PORT), Relay).serve_forever()
