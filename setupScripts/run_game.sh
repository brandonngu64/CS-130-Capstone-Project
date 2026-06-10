#!/bin/bash
set -euo pipefail

# =============================================================================
# run_game.sh
# -----------------------------------------------------------------------------
# Builds the production bundle and installs the game/signaling server as a
# systemd service (cs130-game) so it:
#   - keeps running after you close the SSH session
#   - auto-restarts on crash
#   - starts automatically on reboot
#
# Pair with setupScripts/setup_https.sh for HTTPS/WSS via nginx + No-IP.
# Re-run this script any time you pull new code to rebuild and restart.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$SCRIPT_DIR/cs130-game.service"
SERVICE_NAME="cs130-game"
RUN_USER="$(id -un)"

# Port the server listens on; read from .env if present, else default 3000.
GAME_PORT=3000
if [ -f "$SCRIPT_DIR/.env" ]; then
  # shellcheck disable=SC1091
  GAME_PORT="$(grep -E '^GAME_PORT=' "$SCRIPT_DIR/.env" | tail -n1 | cut -d= -f2)"
  GAME_PORT="${GAME_PORT:-3000}"
fi

cd "$PROJECT_DIR"

# --- Make sure Node (via nvm) is available -----------------------------------
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found. Run setupScripts/aws_startup.sh first (installs Node 20)."
  exit 1
fi

NODE_BIN="$(command -v node)"
echo "Using Node: $NODE_BIN ($(node --version))"

# --- Build -------------------------------------------------------------------
echo "Installing dependencies..."
npm install

echo "Building production bundle (frontend -> dist/, server -> dist-server/)..."
npm run build

# --- Render and install the systemd unit -------------------------------------
echo "Installing systemd service '$SERVICE_NAME'..."
RENDERED="$(mktemp)"
sed \
  -e "s|__USER__|$RUN_USER|g" \
  -e "s|__WORKDIR__|$PROJECT_DIR|g" \
  -e "s|__NODE_BIN__|$NODE_BIN|g" \
  -e "s|__GAME_PORT__|$GAME_PORT|g" \
  "$TEMPLATE" >"$RENDERED"

sudo cp "$RENDERED" "/etc/systemd/system/$SERVICE_NAME.service"
rm -f "$RENDERED"

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo ""
echo "=== Game server is running as systemd service '$SERVICE_NAME' on port $GAME_PORT ==="
sudo systemctl --no-pager status "$SERVICE_NAME" || true
echo ""
echo "Useful commands:"
echo "  sudo systemctl status $SERVICE_NAME      # check status"
echo "  sudo journalctl -u $SERVICE_NAME -f      # follow logs"
echo "  sudo systemctl restart $SERVICE_NAME     # restart after code changes"
echo "  sudo systemctl stop $SERVICE_NAME        # stop"
echo ""
echo "Next: run 'bash setupScripts/setup_https.sh' to enable HTTPS/WSS via No-IP."
