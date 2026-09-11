#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/pi-common.sh"
echo 'E-Stack RC preflight — READ ONLY; no services or DSP state changed'
printf '\nSYSTEM\n'
hostname
cat /etc/os-release
uname -m -r
id
date -u --iso-8601=seconds
df -h "$ROOT_DIR"
free -h
printf '\nTOOLS\n'
for tool in git node npm systemctl ss flock realpath find cp; do
    command -v "$tool" >/dev/null || die "Required local tool missing: $tool"
done
git --version
node --version
npm --version
[[ "$(node -p 'parseInt(process.versions.node, 10)')" -ge 22 ]] || die 'Node 22+ maintained runtime required; no automatic Node upgrade'
[[ "$(npm --version | cut -d. -f1)" -ge 7 ]] || die 'npm 7+ required for lockfile v2 / --omit=dev'
printf '\nREPOSITORY %s\n' "$ROOT_DIR"
git -C "$ROOT_DIR" remote -v
git -C "$ROOT_DIR" branch --show-current
git -C "$ROOT_DIR" rev-parse HEAD
git -C "$ROOT_DIR" status --short
git -C "$ROOT_DIR" rev-parse --abbrev-ref '@{upstream}' || true
printf '\nSERVICES\n'
service_info
printf '\nLISTENING PORTS\n'
ss -ltnp
repo_check
node "$TOOL_DIR/pi-inspect.js" preflight
