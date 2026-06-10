#!/bin/bash
set -euo pipefail

# =============================================================================
# cleanup.sh
# -----------------------------------------------------------------------------
# All-round teardown for the AWS EC2 deployment created by:
#   - setupScripts/run_game.sh    (cs130-game systemd service, port 3000)
#   - setupScripts/setup_https.sh (noip-duc DNS link + nginx 80/443 + cert)
#
# This script:
#   - stops & disables the cs130-game game/signaling service
#   - stops & disables the noip-duc service (unlinks the dynamic DNS update)
#   - removes our nginx reverse-proxy site and stops nginx (frees 80/443)
#   - kills any leftover process holding the game/dev ports
#
# Intentionally KEPT so a re-setup is fast and avoids Let's Encrypt rate limits:
#   - system packages (nginx, certbot, noip-duc)
#   - the Let's Encrypt certificate under /etc/letsencrypt
#   - the No-IP credentials at /etc/default/noip-duc and setupScripts/.env
#
# Re-running setupScripts/run_game.sh then setup_https.sh brings it all back.
#
# Usage:
#   bash setupScripts/cleanup.sh          # prints a summary and asks to confirm
#   bash setupScripts/cleanup.sh --yes    # non-interactive (no prompt)
# =============================================================================

# --- Args --------------------------------------------------------------------
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help)
      # Print the contiguous comment banner at the top of this file (stop at the
      # first non-comment line, i.e. 'set -euo pipefail').
      awk '/^# ===/{started=1} started && /^#/{sub(/^# ?/,""); print; next} started{exit}' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg (use --yes to skip the prompt, --help for usage)" >&2
      exit 1
      ;;
  esac
done

# --- Resolve config ----------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

DOMAIN=""
GAME_PORT=3000
if [ -f "$ENV_FILE" ]; then
  # Pull only the two non-secret values we need; never source/print secrets.
  DOMAIN="$(grep -E '^DOMAIN=' "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
  _port="$(grep -E '^GAME_PORT=' "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
  GAME_PORT="${_port:-3000}"
fi

GAME_SERVICE="cs130-game"
NOIP_SERVICE="noip-duc"
# Ports: game/signaling, nginx http/https, Vite dev, Vite preview.
PORTS=("$GAME_PORT" 80 443 5173 4173)

# --- Confirmation gate -------------------------------------------------------
cat <<EOF
=== Cleanup / teardown for the CS-130 deployment ===

This will:
  - stop & disable systemd service: $GAME_SERVICE  (and remove its unit file)
  - stop & disable systemd service: $NOIP_SERVICE   (unlinks dynamic DNS updates)
  - remove the nginx reverse-proxy site${DOMAIN:+ for $DOMAIN} and stop nginx
  - kill any process listening on ports: ${PORTS[*]}

This will KEEP (not remove):
  - apt packages (nginx, certbot, noip-duc)
  - the TLS certificate under /etc/letsencrypt
  - No-IP credentials (/etc/default/noip-duc, setupScripts/.env)

EOF

if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Continue? [y/N] " reply
  case "$reply" in
    y|Y) ;;
    *) echo "Aborted. Nothing was changed."; exit 0 ;;
  esac
fi

echo ""

# --- 1) Stop & disable the game server --------------------------------------
echo "Stopping game server service '$GAME_SERVICE'..."
sudo systemctl disable --now "$GAME_SERVICE" 2>/dev/null || true
sudo rm -f "/etc/systemd/system/$GAME_SERVICE.service"

# --- 2) Unlink DNS: stop the No-IP DUC --------------------------------------
echo "Stopping No-IP dynamic DNS service '$NOIP_SERVICE' (unlinking DNS updates)..."
sudo systemctl disable --now "$NOIP_SERVICE" 2>/dev/null || true
sudo rm -f "/etc/systemd/system/$NOIP_SERVICE.service"

# --- 3) Tear down the nginx reverse proxy -----------------------------------
echo "Removing nginx reverse-proxy configuration..."
if [ -n "$DOMAIN" ]; then
  sudo rm -f "/etc/nginx/sites-enabled/$DOMAIN" "/etc/nginx/sites-available/$DOMAIN"
fi
# Fallback: drop any enabled site that isn't the stock 'default'.
if [ -d /etc/nginx/sites-enabled ]; then
  for link in /etc/nginx/sites-enabled/*; do
    [ -e "$link" ] || continue
    [ "$(basename "$link")" = "default" ] && continue
    sudo rm -f "$link"
  done
fi
# Restore the stock default site if it exists.
if [ -f /etc/nginx/sites-available/default ]; then
  sudo ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
fi
# Stop nginx so it releases 80/443. Validate config first, but never abort here.
if command -v nginx >/dev/null 2>&1; then
  sudo nginx -t >/dev/null 2>&1 || echo "  (nginx config test reported issues; stopping anyway)"
  sudo systemctl stop nginx 2>/dev/null || true
fi

# --- 4) Reload systemd after removing unit files ----------------------------
sudo systemctl daemon-reload

# --- 5) Free the ports -------------------------------------------------------
echo "Freeing ports: ${PORTS[*]}..."
free_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    sudo fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  elif command -v lsof >/dev/null 2>&1; then
    sudo lsof -ti ":${port}" 2>/dev/null | xargs -r sudo kill 2>/dev/null || true
  fi
}
for port in "${PORTS[@]}"; do
  free_port "$port"
done

# --- Summary -----------------------------------------------------------------
cat <<EOF

=== Cleanup complete ===
Removed/stopped:
  - $GAME_SERVICE service + unit file
  - $NOIP_SERVICE service + unit file
  - nginx reverse-proxy site${DOMAIN:+ for $DOMAIN}; nginx stopped
  - listeners on ports: ${PORTS[*]}

Kept on disk:
  - apt packages (nginx, certbot, noip-duc)
  - TLS certificate under /etc/letsencrypt
  - No-IP credentials (/etc/default/noip-duc, setupScripts/.env)

Notes:
  - The No-IP *hostname* still exists in your No-IP account. To fully release the
    DNS name, delete it from the No-IP dashboard as well.
  - To redeploy: run 'bash setupScripts/run_game.sh' then
    'bash setupScripts/setup_https.sh'.
EOF
