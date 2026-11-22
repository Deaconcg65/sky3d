# The setup page the board shows a phone. Only plain sockets are used, so this file also runs on a computer for the
# checks in tools/board_test.py. The board serves it on its own Wi-Fi network, at http://192.168.4.1, only while it
# is in setup mode.
from sky import logic

MOST_HEADERS = 2048
MOST_BODY = 1024

STYLE = ('body{font-family:-apple-system,Helvetica,Arial,sans-serif;margin:0;padding:20px;background:#0b1320;'
         'color:#e8eef7}h1{font-size:22px;margin:0 0 6px}p{color:#9fb0c8;line-height:1.4}label{display:block;'
         'margin:16px 0 6px;font-weight:600}input,select{width:100%;box-sizing:border-box;font-size:18px;padding:10px;'
         'border-radius:8px;border:1px solid #33445c;background:#111c2e;color:#e8eef7}button{margin-top:22px;'
         'width:100%;font-size:18px;padding:12px;border:0;border-radius:8px;background:#3b82f6;color:#fff}'
         '.err{background:#4a1d1d;color:#ffd7d7;padding:10px;border-radius:8px}.small{font-size:13px}')


def page(title, inner):
    return ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" '
            'content="width=device-width,initial-scale=1"><title>' + logic.escape(title) + '</title><style>' + STYLE +
            '</style></head><body>' + inner + '</body></html>')


def form_page(networks, zipcode='', antenna='', error=''):
    """The setup form: the home Wi-Fi (picked from the networks the board can hear, or typed), its password, the ZIP
    code where the board hangs, and, for a board at a house with its own antenna, that antenna's address."""
    opts = ''.join('<option value="%s">%s</option>' % (logic.escape(n), logic.escape(n)) for n in networks)
    inner = '<h1>Set up your flight board</h1><p>Tell it your home Wi-Fi and ZIP code. It restarts and starts ' \
            'showing the flights over you.</p>'
    if error:
        inner += '<p class="err">' + logic.escape(error) + '</p>'
    inner += '<form method="post" action="/save">'
    if networks:
        inner += ('<label for="pick">Wi-Fi network</label><select id="pick" name="pick">' + opts +
                  '<option value="">Another network (type it below)</option></select>'
                  '<label for="ssid">Or type its name</label>')
    else:
        inner += '<label for="ssid">Wi-Fi network name</label>'
    inner += ('<input id="ssid" name="ssid" maxlength="32" autocapitalize="none" autocomplete="off">'
              '<label for="password">Wi-Fi password</label>'
              '<input id="password" name="password" type="password" maxlength="63" autocomplete="off">'
              '<label for="zip">ZIP code where the board is</label>'
              '<input id="zip" name="zip" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" value="' +
              logic.escape(zipcode) + '">'
              '<label for="antenna">Your own antenna (leave empty if you have none)</label>'
              '<input id="antenna" name="antenna" maxlength="21" placeholder="192.168.1.20" value="' +
              logic.escape(antenna) + '" autocapitalize="none" autocomplete="off">'
              '<button type="submit">Save and restart</button></form>'
              '<p class="small">Flights from airplanes.live, adsb.lol and adsb.fi (opendata.adsb.fi). Weather from '
              'the National Weather Service. Routes from adsb.im and adsb.lol.</p>')
    return page('Flight board setup', inner)


def done_page(ssid):
    return page('Saved', '<h1>Saved</h1><p>The board is restarting and joining <b>' + logic.escape(ssid) +
                '</b>. Watch its screen. If the password was wrong, it comes back to setup by itself and you can '
                'join its network again.</p>')


def read_choice(fields, zip_lookup):
    """Check a submitted form. Returns (settings, error): the settings to save, or an error to show on the form."""
    ssid = (fields.get('ssid') or '').strip() or (fields.get('pick') or '').strip()
    password = fields.get('password') or ''
    zipcode = (fields.get('zip') or '').strip()
    antenna = logic.antenna_address(fields.get('antenna'))
    if not ssid or len(ssid.encode('utf-8')) > 32:
        return None, 'Pick your Wi-Fi network or type its name.'
    if len(password.encode('utf-8')) > 63 or (password and len(password) < 8):
        return None, 'A Wi-Fi password is 8 to 63 characters. Leave it empty only for a network with no password.'
    place = zip_lookup(zipcode)
    if place is None:
        return None, 'That ZIP code is not one the board knows. Type the five digits of the ZIP where it hangs.'
    if antenna is None:
        return None, 'The antenna address should look like 192.168.1.20, on your home network.'
    return {'ssid': ssid, 'password': password, 'zip': zipcode, 'lat': place[0], 'lon': place[1],
            'antenna': antenna, 'fresh': True}, ''


def read_request(conn):
    """Read one request from a phone. Returns (method, path, body) or None for anything that is not a short, plain
    request."""
    buf = bytearray(256)
    data = b''
    while b'\r\n\r\n' not in data:
        n = conn.recv_into(buf)
        if not n:
            return None
        data += bytes(buf[:n])
        if len(data) > MOST_HEADERS:
            return None
    head, body = data.split(b'\r\n\r\n', 1)
    lines = head.split(b'\r\n')
    first = lines[0].split(b' ')
    if len(first) < 2:
        return None
    try:
        method, path = first[0].decode(), first[1].decode()
    except UnicodeError:
        return None
    length = 0
    for line in lines[1:]:
        try:
            kv = line.decode().split(':', 1)
        except UnicodeError:
            return None
        if len(kv) == 2 and kv[0].strip().lower() == 'content-length':
            try:
                length = int(kv[1].strip())
            except ValueError:
                return None
    if length < 0 or length > MOST_BODY:
        return None
    while len(body) < length:
        n = conn.recv_into(buf)
        if not n:
            return None
        body += bytes(buf[:n])
    return method, path, body[:length]


def send(conn, status, html):
    data = html.encode('utf-8')
    head = ('HTTP/1.1 %s\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: %d\r\n'
            'Cache-Control: no-store\r\nConnection: close\r\n\r\n' % (status, len(data))).encode()
    for part in (head, data):
        view = memoryview(part)
        while len(view):
            n = conn.send(view)
            if not n:
                return
            view = view[n:]


def handle(conn, networks, old, zip_lookup):
    """Answer one request. Returns the settings to save when the phone sent a good form, otherwise None."""
    req = read_request(conn)
    if req is None:
        send(conn, '400 Bad Request', page('Not understood', '<p>Not understood.</p>'))
        return None
    method, path, body = req
    zipcode, antenna = old.get('zip', ''), old.get('antenna_typed', '')
    if method == 'POST' and path == '/save':
        fields = logic.form_fields(body)
        choice, error = read_choice(fields, zip_lookup)
        if choice is None:
            send(conn, '200 OK', form_page(networks, fields.get('zip', zipcode), fields.get('antenna', antenna), error))
            return None
        choice['antenna_typed'] = (fields.get('antenna') or '').strip()
        send(conn, '200 OK', done_page(choice['ssid']))
        return choice
    # every other address shows the form, so a phone that asks for anything lands on it
    send(conn, '200 OK', form_page(networks, zipcode, antenna, old.get('error', '')))
    return None
