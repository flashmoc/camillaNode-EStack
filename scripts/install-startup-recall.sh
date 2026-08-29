#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
DROPIN_DIR="/etc/systemd/system/camilladsp.service.d"
DROPIN_FILE="$DROPIN_DIR/estack-startup-recall.conf"

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js is required but was not found." >&2
  exit 1
fi

if ! systemctl cat camilladsp.service >/dev/null 2>&1; then
  echo "camilladsp.service was not found." >&2
  exit 1
fi

if [[ ! -f "$ROOT/scripts/reapply-startup.js" ]]; then
  echo "Missing $ROOT/scripts/reapply-startup.js" >&2
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

cat > "$TMP" <<UNIT
[Service]
# Restore the CamillaNode-selected Startup system preset after every CamillaDSP
# process start/restart. The helper attenuates Main before swapping processing and
# preserves live hardware devices and mixer routing.
ExecStartPost=$NODE_BIN $ROOT/scripts/reapply-startup.js
UNIT

sudo install -d -m 0755 "$DROPIN_DIR"
sudo install -m 0644 "$TMP" "$DROPIN_FILE"
sudo systemctl daemon-reload

echo
echo "Installed CamillaDSP startup recall drop-in:"
echo "  $DROPIN_FILE"
echo
echo "No CamillaDSP restart was performed automatically."
echo "The hook will run on the next CamillaDSP restart or Raspberry reboot."
echo
echo "Current ExecStartPost configuration:"
systemctl show camilladsp.service -p ExecStartPost --no-pager
