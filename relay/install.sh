#!/bin/bash
# Installs or updates the 3D sky network edition and its relay on a receiver that runs readsb with the tar1090 map page.
# The relay is also the front door for sharing the page outside the house: see the top of relay/relay.py and the README.
# Run it with sudo. It is safe to run again: it replaces the page and the relay with the versions it was given.
#   sudo bash install.sh [address of the folder holding sky3d-network.html and relay/relay.py]
set -e
BASE="${1:-https://raw.githubusercontent.com/Deaconcg65/sky3d/main}"
if [ "$(id -u)" != "0" ]; then echo "Please run this with sudo."; exit 1; fi
command -v python3 >/dev/null || { echo "Python 3 is not installed on this receiver. Nothing was changed."; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# download everything first, so a failed download changes nothing
wget -q -O "$TMP/page.html" "$BASE/sky3d-network.html" || { echo "The page could not be downloaded. Nothing was changed."; exit 1; }
wget -q -O "$TMP/relay.py" "$BASE/relay/relay.py" || { echo "The relay could not be downloaded. Nothing was changed."; exit 1; }
grep -q "network edition" "$TMP/page.html" || { echo "The page did not download properly. Nothing was changed."; exit 1; }
python3 -m py_compile "$TMP/relay.py" || { echo "The relay did not download properly. Nothing was changed."; exit 1; }
mkdir -p /var/www/html/sky /usr/local/lib/sky3d
cp "$TMP/page.html" /var/www/html/sky/index.html
cp "$TMP/relay.py" /usr/local/lib/sky3d/relay.py
chmod 644 /var/www/html/sky/index.html /usr/local/lib/sky3d/relay.py
cat > /etc/systemd/system/sky3d-relay.service <<'UNIT'
[Unit]
Description=3D sky relay and front door (fetches nearby aircraft from a public flight network for the 3D sky page, and is the only thing a shared address reaches)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/python3 /usr/local/lib/sky3d/relay.py
Restart=always
RestartSec=5
DynamicUser=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable -q sky3d-relay.service
systemctl restart sky3d-relay.service
sleep 2
echo
if systemctl is-active -q sky3d-relay.service; then echo "3D sky network edition and relay installed."; else echo "The page is installed but the relay did not start. Run: sudo journalctl -u sky3d-relay -n 20"; exit 1; fi
# the front door: what a shared address would reach. Checked here, on the receiver itself, before anything outside depends on it.
DOOR="http://127.0.0.1:${SKY3D_RELAY_PORT:-8099}"
if wget -q -T 8 -O - "$DOOR/sky/" 2>/dev/null | grep -q "network edition"; then echo "Front door check: the 3D sky page answers."; else echo "Front door check: the 3D sky page did NOT answer at $DOOR/sky/"; fi
if wget -q -T 8 -O - "$DOOR/tar1090/data/aircraft.json" 2>/dev/null | grep -q '"aircraft"'; then echo "Front door check: the antenna's aircraft list answers."; else echo "Front door check: the antenna's aircraft list did NOT answer. The page will still show the flight network."; fi
if wget -q -T 8 -O /dev/null "$DOOR/tar1090/" 2>/dev/null; then echo "Front door check: the map page is reachable and should NOT be. Do not share the address yet."; else echo "Front door check: the map page stays out of reach."; fi
# to remove: sudo systemctl disable --now sky3d-relay && sudo rm -r /etc/systemd/system/sky3d-relay.service /usr/local/lib/sky3d /var/www/html/sky
