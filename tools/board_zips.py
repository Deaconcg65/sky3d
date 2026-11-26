"""Build board/CIRCUITPY/zips.bin, the ZIP code table the LED board uses to turn a ZIP code into a place.

The table comes from the us-zips package (MIT license), which lists the Census Bureau's ZIP Code Tabulation Areas
with their centre points. Give the path of that package's key-value.js. The file is read as text and never run.

Each record is 9 bytes, sorted by ZIP code: the ZIP as a 3-byte number, then latitude and longitude as signed
3-byte numbers in ten-thousandths of a degree (about 11 metres). The board finds a ZIP by halving the file.

    python3 -I tools/board_zips.py path/to/us-zips/key-value.js
"""
import os
import re
import sys

ROW = re.compile(r'\["(\d{5})",\s*\{latitude:\s*(-?\d+(?:\.\d+)?),\s*longitude:\s*(-?\d+(?:\.\d+)?)\}\]')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'board', 'CIRCUITPY', 'zips.bin')


def pack(z, lat, lon):
    out = bytearray(int(z).to_bytes(3, 'big'))
    for v in (lat, lon):
        out += int(round(v * 10000)).to_bytes(3, 'big', signed=True)
    return bytes(out)


def main(path):
    with open(path, encoding='utf-8') as f:
        text = f.read()
    rows = {}
    for z, la, lo in ROW.findall(text):
        la, lo = float(la), float(lo)
        if -90 <= la <= 90 and -180 <= lo <= 180:
            rows[z] = (la, lo)
    if len(rows) < 30000:
        sys.exit('Only %d ZIP codes were read; expected more than 30,000.' % len(rows))
    with open(OUT, 'wb') as f:
        for z in sorted(rows):
            f.write(pack(z, *rows[z]))
    print('%d ZIP codes written to board/CIRCUITPY/zips.bin' % len(rows))


if __name__ == '__main__':
    main(sys.argv[1])
