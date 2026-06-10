#!/bin/bash
set -euo pipefail

# =============================================================================
# setup_https.sh
# -----------------------------------------------------------------------------
# Configures HTTPS (and therefore WSS) for the game on an AWS EC2 instance using:
#   - No-IP free-tier dynamic DNS (kept current by the No-IP DUC)
#   - Let's Encrypt / Certbot for the TLS certificate
#   - Nginx as a reverse proxy in front of the Node server (port $GAME_PORT)
#
# The browser client auto-selects ws:// or wss:// from window.location.protocol,
# so once the site is served over HTTPS the WebSocket signaling automatically
# upgrades to wss:// — no code or flag changes needed. Nginx terminates TLS and
# proxies down to plain ws://127.0.0.1:$GAME_PORT.
#
# Run the game first (setupScripts/run_game.sh) so the server is listening, then
# run this script.
#
# Secrets are read from setupScripts/.env (see .env.example). Never commit .env.
# =============================================================================

# --- Load configuration from .env -------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found."
  echo "Copy the template and fill it in:"
  echo "  cp $SCRIPT_DIR/.env.example $ENV_FILE && chmod 600 $ENV_FILE"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Validate required variables (without printing their values).
missing=0
for var in DOMAIN EMAIL GAME_PORT NOIP_USERNAME NOIP_PASSWORD; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: required variable '$var' is empty in $ENV_FILE"
    missing=1
  fi
done
[ "$missing" -eq 0 ] || exit 1

echo "=== HTTPS setup for $DOMAIN (proxying to 127.0.0.1:$GAME_PORT) ==="

# --- Install packages --------------------------------------------------------
echo "Installing nginx, certbot, and helper tools..."
sudo apt update
sudo DEBIAN_FRONTEND=noninteractive apt install -y \
  nginx certbot python3-certbot-nginx dnsutils curl

# --- Install & configure the No-IP Dynamic Update Client (noip-duc) ----------
install_noip_duc() {
  if command -v noip-duc >/dev/null 2>&1; then
    echo "noip-duc already installed."
    return 0
  fi

  echo "Installing No-IP DUC (noip-duc) from the official No-IP tarball..."
  local arch tmp deb
  arch="$(dpkg --print-architecture)"   # e.g. amd64, arm64

  tmp="$(mktemp -d)"
  (
    cd "$tmp"
    # Official stable download; --content-disposition keeps the real filename.
    wget -q --content-disposition https://www.noip.com/download/linux/latest
    tar xf noip-duc_*.tar.gz
    deb="$(find . -name "noip-duc_*_${arch}.deb" | head -n1)"
    if [ -z "$deb" ]; then
      echo "ERROR: no noip-duc .deb for arch '$arch' in the No-IP tarball." >&2
      echo "Available packages:" >&2
      find . -name "noip-duc_*.deb" >&2
      exit 1
    fi
    sudo apt install -y "$deb"
  )
  rm -rf "$tmp"
}
install_noip_duc

echo "Writing No-IP DUC config to /etc/default/noip-duc..."
# DUC v3 reads these env vars. Stored in a root-only file, not in the unit.
sudo tee /etc/default/noip-duc >/dev/null <<EOF
NOIP_USERNAME=$NOIP_USERNAME
NOIP_PASSWORD=$NOIP_PASSWORD
NOIP_HOSTNAMES=$DOMAIN
EOF
sudo chmod 600 /etc/default/noip-duc

echo "Creating noip-duc systemd service..."
NOIP_BIN="$(command -v noip-duc)"
sudo tee /etc/systemd/system/noip-duc.service >/dev/null <<EOF
[Unit]
Description=No-IP Dynamic Update Client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/default/noip-duc
ExecStart=$NOIP_BIN
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF

sudo chmod 600 "$ENV_FILE" || true
sudo systemctl daemon-reload
sudo systemctl enable --now noip-duc

# --- Wait for DNS to point at this instance before requesting a cert ----------
PUBLIC_IP="$(curl -fsSL https://api.ipify.org || true)"
echo "Instance public IP: ${PUBLIC_IP:-unknown}"
echo "Waiting for $DOMAIN to resolve to this instance (certbot needs this)..."
for i in $(seq 1 30); do
  resolved="$(dig +short "$DOMAIN" | tail -n1 || true)"
  if [ -n "$resolved" ] && { [ -z "$PUBLIC_IP" ] || [ "$resolved" = "$PUBLIC_IP" ]; }; then
    echo "$DOMAIN -> $resolved (ok)"
    break
  fi
  echo "  attempt $i/30: $DOMAIN -> '${resolved:-<none>}' (want '${PUBLIC_IP:-any}'); retrying in 10s"
  sleep 10
  if [ "$i" -eq 30 ]; then
    echo "WARNING: $DOMAIN did not resolve to $PUBLIC_IP yet."
    echo "Check the No-IP DUC (sudo journalctl -u noip-duc -e) and that the"
    echo "hostname is confirmed in your No-IP account, then re-run this script."
    exit 1
  fi
done

# --- Bootstrap nginx (port 80) for the ACME http-01 challenge ----------------
echo "Configuring initial Nginx block for certificate validation..."
cat <<EOF | sudo tee /etc/nginx/sites-available/"$DOMAIN" >/dev/null
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$GAME_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/"$DOMAIN" /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# --- Obtain the certificate --------------------------------------------------
echo "Obtaining SSL certificate via Certbot..."
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

# --- Final nginx config tuned for WebSockets / rollback netcode --------------
echo "Writing final Nginx config (HTTPS + WebSocket passthrough)..."
cat <<EOF | sudo tee /etc/nginx/sites-available/"$DOMAIN" >/dev/null
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:$GAME_PORT;

        # Vital metadata headers
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # WebSocket support (handles the wss:// upgrade for /ws signaling)
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";

        # Disable buffering to avoid latency spikes in fast-paced rollback games
        proxy_buffering off;
    }
}
EOF

echo "Testing Nginx config and reloading..."
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "HTTPS initialization successfully completed!"
echo "Play at: https://$DOMAIN"
echo "WebSocket signaling will auto-upgrade to wss://$DOMAIN/ws"
