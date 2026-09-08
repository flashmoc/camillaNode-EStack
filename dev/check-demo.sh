#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=demo-environment.sh
source "$ROOT_DIR/dev/demo-environment.sh"
estack_demo_require_context

check_port() {
    local port="$1" label="$2"
    if ! python3 - "$port" <<'PY' >/dev/null 2>&1
import socket
import sys
s = socket.socket()
s.settimeout(1)
try:
    s.connect(("127.0.0.1", int(sys.argv[1])))
except OSError:
    raise SystemExit(1)
finally:
    s.close()
PY
    then
        echo "FAIL: $label is not reachable on 127.0.0.1:$port" >&2
        return 1
    fi
    echo "OK:   $label reachable on $port"
}

check_port 1234 'CamillaDSP main'
check_port 6413 'CamillaDSP spectrum'
check_port 5005 'CamillaGUI'
check_port 8080 'CamillaNode'

product="$(curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/estack-dsp/)"
if [[ "$product" != *'pageFrame'* || "$product" != *'E-Stack UI Prototype Shell'* ]]; then
    echo 'FAIL: E-Stack DSP product route did not return the product shell.' >&2
    exit 1
fi
echo 'OK:   E-Stack DSP product route responds'

curl --fail --silent --show-error --max-time 5 http://127.0.0.1:5005/gui/index.html >/dev/null
echo 'OK:   CamillaGUI route responds'

runtime="$(curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/api/runtime)"
python3 - "$runtime" <<'PY'
import json
import sys
runtime = json.loads(sys.argv[1])
expected = {"mode": "demo", "httpPort": 8080, "dspPort": 1234, "spectrumPort": 6413}
for key, value in expected.items():
    if runtime.get(key) != value:
        raise SystemExit(f"FAIL: /api/runtime {key}={runtime.get(key)!r}, expected {value!r}")
print("OK:   CamillaNode reports the canonical demo runtime")
PY

echo "Demo logs: $(estack_demo_cache_dir)/log"
