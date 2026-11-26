#!/usr/bin/env python3
"""Build the place list that the followed flight's location line uses (version 3.12.2).

Source: GeoNames (geonames.org, Creative Commons Attribution 4.0), every place of 1,000 people or more, as packed in the
all-the-cities npm package 3.1.0 (MIT license), file cities.pbf. Download it into dl/ (which is not committed) with
    curl -sS -o dl/all-the-cities.tgz https://registry.npmjs.org/all-the-cities/-/all-the-cities-3.1.0.tgz
    mkdir -p dl/towns && tar -xzf dl/all-the-cities.tgz -C dl/towns
and run as: python3 -I tools/towns.py dl/towns/package/cities.pbf build/towns.txt

Kept: every place of 1,000 or more in the United States and Canada, places of 15,000 or more elsewhere, and the three
largest places of every country, so island countries far out at sea (Bermuda, Greenland, the Faroes) still show.

Written format, plain text so the page can carry it unparsed until a flight is first followed:
    @CT                       a line starting with @ names the region of the lines under it (state, province or country)
    Danbury<TAB>4139<TAB>-7345   a place: name, then latitude and longitude in hundredths of a degree
"""
import sys

CANADA = {'01': 'AB', '02': 'BC', '03': 'MB', '04': 'NB', '05': 'NL', '07': 'NS', '08': 'ON', '09': 'PE', '10': 'QC',
          '11': 'SK', '12': 'YT', '13': 'NT', '14': 'NU'}
COUNTRY = dict(line.split(' ', 1) for line in """
AD Andorra
AE United Arab Emirates
AF Afghanistan
AG Antigua and Barbuda
AI Anguilla
AL Albania
AM Armenia
AO Angola
AR Argentina
AS American Samoa
AT Austria
AU Australia
AW Aruba
AX Aland Islands
AZ Azerbaijan
BA Bosnia and Herzegovina
BB Barbados
BD Bangladesh
BE Belgium
BF Burkina Faso
BG Bulgaria
BH Bahrain
BI Burundi
BJ Benin
BL Saint Barthelemy
BM Bermuda
BN Brunei
BO Bolivia
BQ Caribbean Netherlands
BR Brazil
BS Bahamas
BT Bhutan
BW Botswana
BY Belarus
BZ Belize
CC Cocos Islands
CD Democratic Republic of the Congo
CF Central African Republic
CG Republic of the Congo
CH Switzerland
CI Ivory Coast
CK Cook Islands
CL Chile
CM Cameroon
CN China
CO Colombia
CR Costa Rica
CU Cuba
CV Cape Verde
CW Curacao
CX Christmas Island
CY Cyprus
CZ Czechia
DE Germany
DJ Djibouti
DK Denmark
DM Dominica
DO Dominican Republic
DZ Algeria
EC Ecuador
EE Estonia
EG Egypt
EH Western Sahara
ER Eritrea
ES Spain
ET Ethiopia
FI Finland
FJ Fiji
FK Falkland Islands
FM Micronesia
FO Faroe Islands
FR France
GA Gabon
GB United Kingdom
GD Grenada
GE Georgia
GF French Guiana
GG Guernsey
GH Ghana
GI Gibraltar
GL Greenland
GM Gambia
GN Guinea
GP Guadeloupe
GQ Equatorial Guinea
GR Greece
GT Guatemala
GU Guam
GW Guinea-Bissau
GY Guyana
HK Hong Kong
HN Honduras
HR Croatia
HT Haiti
HU Hungary
ID Indonesia
IE Ireland
IL Israel
IM Isle of Man
IN India
IQ Iraq
IR Iran
IS Iceland
IT Italy
JE Jersey
JM Jamaica
JO Jordan
JP Japan
KE Kenya
KG Kyrgyzstan
KH Cambodia
KI Kiribati
KM Comoros
KN Saint Kitts and Nevis
KP North Korea
KR South Korea
KW Kuwait
KY Cayman Islands
KZ Kazakhstan
LA Laos
LB Lebanon
LC Saint Lucia
LI Liechtenstein
LK Sri Lanka
LR Liberia
LS Lesotho
LT Lithuania
LU Luxembourg
LV Latvia
LY Libya
MA Morocco
MC Monaco
MD Moldova
ME Montenegro
MF Saint Martin
MG Madagascar
MH Marshall Islands
MK North Macedonia
ML Mali
MM Myanmar
MN Mongolia
MO Macau
MP Northern Mariana Islands
MQ Martinique
MR Mauritania
MS Montserrat
MT Malta
MU Mauritius
MV Maldives
MW Malawi
MX Mexico
MY Malaysia
MZ Mozambique
NA Namibia
NC New Caledonia
NE Niger
NF Norfolk Island
NG Nigeria
NI Nicaragua
NL Netherlands
NO Norway
NP Nepal
NR Nauru
NU Niue
NZ New Zealand
OM Oman
PA Panama
PE Peru
PF French Polynesia
PG Papua New Guinea
PH Philippines
PK Pakistan
PL Poland
PM Saint Pierre and Miquelon
PR Puerto Rico
PS Palestine
PT Portugal
PW Palau
PY Paraguay
QA Qatar
RE Reunion
RO Romania
RS Serbia
RU Russia
RW Rwanda
SA Saudi Arabia
SB Solomon Islands
SC Seychelles
SD Sudan
SE Sweden
SG Singapore
SH Saint Helena
SI Slovenia
SJ Svalbard
SK Slovakia
SL Sierra Leone
SM San Marino
SN Senegal
SO Somalia
SR Suriname
SS South Sudan
ST Sao Tome and Principe
SV El Salvador
SX Sint Maarten
SY Syria
SZ Eswatini
TC Turks and Caicos Islands
TD Chad
TG Togo
TH Thailand
TJ Tajikistan
TL Timor-Leste
TM Turkmenistan
TN Tunisia
TO Tonga
TR Turkey
TT Trinidad and Tobago
TV Tuvalu
TW Taiwan
TZ Tanzania
UA Ukraine
UG Uganda
UY Uruguay
UZ Uzbekistan
VA Vatican City
VC Saint Vincent and the Grenadines
VE Venezuela
VG British Virgin Islands
VI US Virgin Islands
VN Vietnam
VU Vanuatu
WF Wallis and Futuna
WS Samoa
XK Kosovo
YE Yemen
YT Mayotte
ZA South Africa
ZM Zambia
ZW Zimbabwe
""".strip().splitlines())


def varint(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1; r |= (c & 0x7f) << s; s += 7
        if c < 0x80:
            return r, i


def zigzag(n):
    return (n >> 1) ^ -(n & 1)


def read(path):
    """The places in cities.pbf, decoded the way the package's own index.js does (positions are kept as running sums)."""
    b = open(path, 'rb').read(); i = 0; lat = lon = 0; out = []
    while i < len(b):
        n, i = varint(b, i); end = i + n; c = {'pop': 0, 'admin': ''}
        while i < end:
            key, i = varint(b, i); tag, wire = key >> 3, key & 7
            if wire == 0:
                v, i = varint(b, i)
                if tag == 9: c['pop'] = v
                elif tag == 10: lon += zigzag(v); c['lon'] = lon / 1e5
                elif tag == 11: lat += zigzag(v); c['lat'] = lat / 1e5
            elif wire == 2:
                n2, i = varint(b, i); text = b[i:i + n2].decode('utf8'); i += n2
                if tag == 2: c['name'] = text
                elif tag == 3: c['country'] = text
                elif tag == 8: c['admin'] = text
            else:
                raise SystemExit('cities.pbf has a field this tool does not know (wire type %d). Nothing was written.' % wire)
        out.append(c)
    return out


def region(c):
    if c['country'] == 'US': return c['admin'] if len(c['admin']) == 2 and c['admin'].isalpha() else ''
    if c['country'] == 'CA': return CANADA.get(c['admin'], '')
    return COUNTRY.get(c['country'], '')


def main():
    places = [c for c in read(sys.argv[1]) if c.get('name') and 'lat' in c and c.get('country')]
    big = {}
    for c in places:
        big.setdefault(c['country'], []).append(c)
    top = set()
    for cc, l in big.items():
        for c in sorted(l, key=lambda c: -c['pop'])[:3]: top.add(id(c))
    keep = [c for c in places if region(c) and ((c['country'] in ('US', 'CA') and c['pop'] >= 1000) or c['pop'] >= 15000 or id(c) in top)]
    missing = sorted({c['country'] for c in places if not region(c) and c['country'] not in ('US', 'CA')})
    keep.sort(key=lambda c: (region(c), -c['pop']))
    lines, last = [], None
    for c in keep:
        name = ' '.join(c['name'].replace('\t', ' ').split())
        if not name: continue
        r = region(c)
        if r != last: lines.append('@' + r); last = r
        lines.append('%s\t%d\t%d' % (name, round(c['lat'] * 100), round(c['lon'] * 100)))
    with open(sys.argv[2], 'w') as f:
        f.write('\n'.join(lines) + '\n')
    print('%d places, %d KB.%s' % (len(keep), sum(len(x.encode()) + 1 for x in lines) // 1024,
          (' Countries with no name here, left out: ' + ' '.join(missing)) if missing else ''))


main()
