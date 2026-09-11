#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/pi-common.sh"
umask 077
repo_check
BASE="${ESTACK_BACKUP_BASE:-$HOME/estack-backups}"
mkdir -p "$BASE"
BACKUP="$(mktemp -d "$BASE/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
BACKUP="$(realpath "$BACKUP")"
[[ "$BACKUP/" != "$ROOT_DIR/"* ]] || die 'Backup must be outside repository'
echo "Persistent backup: $BACKUP" >&2
runtime_copy "$BACKUP/runtime"
mkdir "$BACKUP/toolkit"
cp "$TOOL_DIR"/pi-{common.sh,inspect.js,preflight.sh,backup.sh,deploy-rc.sh,postdeploy-check.sh,rollback.sh,update.sh} "$BACKUP/toolkit/"
mkdir "$BACKUP/toolkit/node_modules"
cp -a "$(node "$TOOL_DIR/pi-inspect.js" ws-path)" "$BACKUP/toolkit/node_modules/ws"
git -C "$ROOT_DIR" status --porcelain=v1 > "$BACKUP/git-status.txt"
git -C "$ROOT_DIR" diff --binary HEAD > "$BACKUP/tracked-differences.patch"
# A bundle keeps the previous application revision available even offline/after GC.
git -C "$ROOT_DIR" bundle create "$BACKUP/repository.bundle" HEAD >&2
service_info > "$BACKUP/systemd.txt"
ss -ltnp > "$BACKUP/ports.txt" 2>&1 || true
node "$TOOL_DIR/pi-inspect.js" backup "$BACKUP"
printf '%s\n' "$BACKUP"
