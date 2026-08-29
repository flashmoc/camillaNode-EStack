#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
DSP_DROPIN_DIR="/etc/systemd/system/camilladsp.service.d"
DSP_DROPIN_FILE="$DSP_DROPIN_DIR/estack-startup-recall.conf"
NODE_DROPIN_DIR="/etc/systemd/system/camillanode.service.d"
NODE_DROPIN_FILE="$NODE_DROPIN_DIR/estack-after-dsp.conf"

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

DSP_TMP="$(mktemp)"
NODE_TMP="$(mktemp)"
trap 'rm -f "$DSP_TMP" "$NODE_TMP"' EXIT

cat > "$DSP_TMP" <<UNIT
[Service]
# Restore the CamillaNode-selected Startup system preset after every CamillaDSP
# process start/restart. The helper attenuates Main before swapping processing and
# preserves live hardware devices and mixer routing.
ExecStartPost=$NODE_BIN $ROOT/scripts/reapply-startup.js
UNIT

sudo install -d -m 0755 "$DSP_DROPIN_DIR"
sudo install -m 0644 "$DSP_TMP" "$DSP_DROPIN_FILE"

# On Raspberry boot, let CamillaDSP finish its ExecStartPost recall before
# CamillaNode starts. This prevents CamillaNode's legacy boot fallback from racing
# the canonical systemd recall path. A later CamillaDSP restart does not restart
# CamillaNode; only the preset hook runs.
if systemctl cat camillanode.service >/dev/null 2>&1; then
  cat > "$NODE_TMP" <<UNIT
[Unit]
After=camilladsp.service
UNIT
  sudo install -d -m 0755 "$NODE_DROPIN_DIR"
  sudo install -m 0644 "$NODE_TMP" "$NODE_DROPIN_FILE"
fi

sudo systemctl daemon-reload

echo
echo "Installed CamillaDSP startup recall drop-in:"
echo "  $DSP_DROPIN_FILE"
if [[ -f "$NODE_DROPIN_FILE" ]]; then
  echo "Installed CamillaNode boot ordering drop-in:"
  echo "  $NODE_DROPIN_FILE"
fi
echo
echo "No CamillaDSP restart was performed automatically."
echo "The hook will run on the next CamillaDSP restart or Raspberry reboot."
echo
echo "Current ExecStartPost configuration:"
systemctl show camilladsp.service -p ExecStartPost --no-pager
