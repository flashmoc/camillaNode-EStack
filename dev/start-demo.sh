#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Keep all demo-owned files on /workspaces in Codespaces. /tmp can be tiny.
if [[ "${CODESPACES:-false}" == "true" && -d /workspaces ]]; then
    CACHE_DIR="/workspaces/.estack-camillanode-demo"
else
    CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/estack-camillanode-demo"
fi

BIN_DIR="$CACHE_DIR/bin"
RUN_DIR="$CACHE_DIR/run"
LOG_DIR="$CACHE_DIR/log"
TMP_DIR="$CACHE_DIR/tmp"
GUI_CONFIG_DIR="$CACHE_DIR/configs"
GUI_COEFF_DIR="$CACHE_DIR/coeffs"

CAMILLA_VERSION="${CAMILLA_VERSION:-4.1.3}"
CAMILLAGUI_VERSION="${CAMILLAGUI_VERSION:-4.1.0}"
SOURCE_MAIN_CONFIG="$ROOT_DIR/dev/estack-demo.yml"
MAIN_CONFIG="$GUI_CONFIG_DIR/EStack_Codespaces.yml"
SPECTRUM_CONFIG="$RUN_DIR/spectrum-demo.yml"
STATE_FILE="$RUN_DIR/camilladsp-state.yml"
GUI_CONFIG="$RUN_DIR/camillagui.yml"

mkdir -p "$BIN_DIR" "$RUN_DIR" "$LOG_DIR" "$TMP_DIR" "$GUI_CONFIG_DIR" "$GUI_COEFF_DIR"

# Used by .devcontainer/postStartCommand. The normal `npm run demo` path stays
# attached to the terminal so Ctrl+C stops the complete demo cleanly.
if [[ "${1:-}" == "--background" ]]; then
    nohup bash "$0" --foreground >"$LOG_DIR/launcher.log" 2>&1 </dev/null &
    echo $! > "$RUN_DIR/launcher.pid"
    echo "E-Stack demo launcher started in background (PID $!)."
    exit 0
fi

case "$(uname -m)" in
    x86_64|amd64) CAMILLA_ARCH="amd64" ;;
    aarch64|arm64) CAMILLA_ARCH="aarch64" ;;
    *)
        echo "Unsupported architecture: $(uname -m)" >&2
        exit 1
        ;;
esac

CAMILLA_BIN="$BIN_DIR/camilladsp-$CAMILLA_VERSION-$CAMILLA_ARCH"
CAMILLAGUI_HOME="$CACHE_DIR/camillagui-$CAMILLAGUI_VERSION-$CAMILLA_ARCH"
CAMILLAGUI_BIN="$CAMILLAGUI_HOME/camillagui_backend/camillagui_backend"

stop_previous_codespace_demo() {
    # Never interfere with real Raspberry services if this helper is run there.
    if [[ "${CODESPACES:-false}" != "true" ]]; then
        return
    fi

    pkill -f '[n]odemon index.js' >/dev/null 2>&1 || true
    pkill -f '[n]ode index.js' >/dev/null 2>&1 || true
    pkill -f '[g]enerate-input-demo.py' >/dev/null 2>&1 || true
    pkill -f '[c]amillagui_backend' >/dev/null 2>&1 || true

    if command -v fuser >/dev/null 2>&1; then
        fuser -k 1234/tcp >/dev/null 2>&1 || true
        fuser -k 6413/tcp >/dev/null 2>&1 || true
        fuser -k 8080/tcp >/dev/null 2>&1 || true
        fuser -k 5005/tcp >/dev/null 2>&1 || true
    fi

    rm -f /tmp/estack-demo.raw /tmp/camilladsp-demo.raw 2>/dev/null || true
    sleep 0.3
}

ensure_system_dependencies() {
    # Avoid grep -q with pipefail: an early grep exit can SIGPIPE ldconfig.
    if ldconfig -p 2>/dev/null | grep 'libasound\.so\.2' >/dev/null; then
        return
    fi

    echo "Installing CamillaDSP ALSA runtime library (one-time Codespace setup)..."
    sudo apt-get update -qq
    if ! sudo apt-get install -y libasound2; then
        sudo apt-get install -y libasound2t64
    fi
}

download_camilladsp() {
    if [[ -x "$CAMILLA_BIN" ]]; then
        return
    fi

    echo "Downloading CamillaDSP $CAMILLA_VERSION for linux-$CAMILLA_ARCH..."
    local temp_dir archive
    temp_dir="$(mktemp -d "$TMP_DIR/camilladsp.XXXXXXXXXX")"
    archive="$temp_dir/camilladsp.tar.gz"

    curl -fL --retry 3 \
        "https://github.com/HEnquist/camilladsp/releases/download/v${CAMILLA_VERSION}/camilladsp-linux-${CAMILLA_ARCH}.tar.gz" \
        -o "$archive"
    tar -xzf "$archive" -C "$temp_dir"
    install -m 0755 "$temp_dir/camilladsp" "$CAMILLA_BIN"
    rm -rf "$temp_dir"
}

download_camillagui() {
    if [[ -x "$CAMILLAGUI_BIN" ]]; then
        return
    fi

    echo "Downloading CamillaGUI $CAMILLAGUI_VERSION official bundle for linux-$CAMILLA_ARCH..."
    local temp_dir archive candidate
    temp_dir="$(mktemp -d "$TMP_DIR/camillagui.XXXXXXXXXX")"
    archive="$temp_dir/camillagui.tar.gz"

    curl -fL --retry 3 \
        "https://github.com/HEnquist/camillagui-backend/releases/download/v${CAMILLAGUI_VERSION}/bundle_linux_${CAMILLA_ARCH}.tar.gz" \
        -o "$archive"

    rm -rf "$CAMILLAGUI_HOME"
    mkdir -p "$CAMILLAGUI_HOME"
    tar -xzf "$archive" -C "$CAMILLAGUI_HOME"
    rm -rf "$temp_dir"

    # Official bundles currently contain camillagui_backend/camillagui_backend.
    # Keep a fallback so a harmless archive-layout change does not break demo setup.
    if [[ ! -x "$CAMILLAGUI_BIN" ]]; then
        candidate="$(find "$CAMILLAGUI_HOME" -type f -name camillagui_backend -perm -u+x -print -quit)"
        if [[ -z "$candidate" ]]; then
            echo "CamillaGUI bundle extracted, but the backend executable was not found." >&2
            exit 1
        fi
        CAMILLAGUI_BIN="$candidate"
    fi
}

validate_config() {
    local label="$1"
    local config="$2"
    local output

    printf 'Validating %-18s ... ' "$label"
    if ! output="$("$CAMILLA_BIN" --check "$config" 2>&1)"; then
        echo "FAILED"
        echo
        echo "$output" >&2
        echo >&2
        echo "The $label configuration is invalid; startup stopped before opening any ports." >&2
        return 1
    fi
    echo "OK"
}

wait_for_port() {
    local port="$1"
    local label="$2"
    local attempts="${3:-150}"

    for ((i=1; i<=attempts; i++)); do
        if python3 - "$port" <<'PY' >/dev/null 2>&1
import socket
import sys
port = int(sys.argv[1])
s = socket.socket()
s.settimeout(0.1)
try:
    s.connect(("127.0.0.1", port))
except OSError:
    raise SystemExit(1)
finally:
    s.close()
PY
        then
            return 0
        fi
        sleep 0.1
    done

    echo "$label did not open port $port in time." >&2
    return 1
}

# Recover from previous tests first, then prepare binaries and runtime configs.
stop_previous_codespace_demo
ensure_system_dependencies
download_camilladsp
download_camillagui

# CamillaGUI gets a writable runtime copy. Every demo restart resets it to the
# version tracked in Git, while edits applied during a session still reach DSP.
cp "$SOURCE_MAIN_CONFIG" "$MAIN_CONFIG"
python3 "$ROOT_DIR/dev/make-spectrum-demo.py" "$SPECTRUM_CONFIG" >/dev/null

cat >"$GUI_CONFIG" <<EOF
---
camilla_host: "127.0.0.1"
camilla_port: 1234
bind_address: "0.0.0.0"
port: 5005
ssl_certificate: null
ssl_private_key: null
gui_config_file: null
config_dir: "$GUI_CONFIG_DIR"
coeff_dir: "$GUI_COEFF_DIR"
default_config: "$MAIN_CONFIG"
statefile_path: "$STATE_FILE"
log_file: "$LOG_DIR/camilladsp-main.log"
EOF

validate_config "main E-Stack DSP" "$MAIN_CONFIG"
validate_config "30-band spectrum" "$SPECTRUM_CONFIG"

cd "$ROOT_DIR"
if [[ ! -d node_modules ]]; then
    echo "Installing CamillaNode dependencies..."
    npm install --no-audit --no-fund
fi

MAIN_PID=""
SPECTRUM_PID=""
GUI_PID=""
cleanup() {
    local status=$?
    trap - EXIT INT TERM
    [[ -n "$GUI_PID" ]] && kill "$GUI_PID" >/dev/null 2>&1 || true
    [[ -n "$MAIN_PID" ]] && kill "$MAIN_PID" >/dev/null 2>&1 || true
    [[ -n "$SPECTRUM_PID" ]] && kill "$SPECTRUM_PID" >/dev/null 2>&1 || true
    pkill -f '[g]enerate-input-demo.py' >/dev/null 2>&1 || true
    rm -f "$RUN_DIR/main.pid" "$RUN_DIR/spectrum.pid" "$RUN_DIR/camillagui.pid"
    exit "$status"
}
trap cleanup EXIT INT TERM

# CH1/CH2 carry -30 dBFS noise. CH3-CH8 remain exact digital silence.
# The statefile lets CamillaGUI resolve this exact runtime config as active.
"$CAMILLA_BIN" --port 1234 --loglevel warn -s "$STATE_FILE" "$MAIN_CONFIG" \
    < <(python3 "$ROOT_DIR/dev/generate-input-demo.py") \
    >"$LOG_DIR/camilladsp-main.log" 2>&1 &
MAIN_PID=$!
echo "$MAIN_PID" > "$RUN_DIR/main.pid"

"$CAMILLA_BIN" --port 6413 --loglevel warn "$SPECTRUM_CONFIG" \
    >"$LOG_DIR/camilladsp-spectrum.log" 2>&1 &
SPECTRUM_PID=$!
echo "$SPECTRUM_PID" > "$RUN_DIR/spectrum.pid"

if ! wait_for_port 1234 "Main CamillaDSP"; then
    cat "$LOG_DIR/camilladsp-main.log" >&2 || true
    exit 1
fi
if ! wait_for_port 6413 "Spectrum CamillaDSP"; then
    cat "$LOG_DIR/camilladsp-spectrum.log" >&2 || true
    exit 1
fi

if ! kill -0 "$MAIN_PID" >/dev/null 2>&1; then
    echo "Main CamillaDSP exited unexpectedly:" >&2
    cat "$LOG_DIR/camilladsp-main.log" >&2 || true
    exit 1
fi
if ! kill -0 "$SPECTRUM_PID" >/dev/null 2>&1; then
    echo "Spectrum CamillaDSP exited unexpectedly:" >&2
    cat "$LOG_DIR/camilladsp-spectrum.log" >&2 || true
    exit 1
fi

# Start the official CamillaGUI backend after the main DSP is reachable.
"$CAMILLAGUI_BIN" -c "$GUI_CONFIG" -l WARNING -a WARNING \
    >"$LOG_DIR/camillagui.log" 2>&1 &
GUI_PID=$!
echo "$GUI_PID" > "$RUN_DIR/camillagui.pid"

# Fail fast if the backend exits, otherwise wait for its HTTP listener.
for ((i=1; i<=200; i++)); do
    if ! kill -0 "$GUI_PID" >/dev/null 2>&1; then
        echo "CamillaGUI exited before opening port 5005:" >&2
        cat "$LOG_DIR/camillagui.log" >&2 || true
        exit 1
    fi
    if python3 - <<'PY' >/dev/null 2>&1
import socket
s = socket.socket()
s.settimeout(0.1)
try:
    s.connect(("127.0.0.1", 5005))
except OSError:
    raise SystemExit(1)
finally:
    s.close()
PY
    then
        break
    fi
    if [[ "$i" -eq 200 ]]; then
        echo "CamillaGUI did not open port 5005 in time." >&2
        cat "$LOG_DIR/camillagui.log" >&2 || true
        exit 1
    fi
    sleep 0.1
done

export ESTACK_DEMO=1
export CAMILLANODE_PORT=8080
export CAMILLADSP_PROXY_HOST=127.0.0.1
export CAMILLADSP_PORT=1234
export CAMILLA_SPECTRUM_PORT=6413

printf '\nE-Stack cloud demo is ready:\n'
printf '  Demo input:    CH1/CH2 noise @ -30 dBFS; CH3-CH8 digital silence\n'
printf '  Main DSP:      ws://127.0.0.1:1234\n'
printf '  Spectrum DSP:  ws://127.0.0.1:6413\n'
printf '  CamillaNode:   http://localhost:8080\n'
printf '  CamillaGUI:    http://localhost:5005/gui/index.html\n'
if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
    printf '  Node browser:  https://%s-8080.%s\n' "$CODESPACE_NAME" "$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN"
    printf '  GUI browser:   https://%s-5005.%s/gui/index.html\n' "$CODESPACE_NAME" "$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN"
fi
printf '\nRuntime/cache: %s\n' "$CACHE_DIR"
printf 'Keep this command running while you work. Ctrl+C stops the complete demo.\n\n'

npm start
