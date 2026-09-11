#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/pi-common.sh"
node "$TOOL_DIR/pi-inspect.js" smoke
