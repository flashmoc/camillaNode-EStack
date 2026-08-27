#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Codespaces can have a very small /tmp/root filesystem. Keep every demo-owned
# file on the persistent /workspaces volume instead. On normal Linux installs,
# retain the conventional user cache location.
if [[ "${CODESPACES:-false}" == "true" && -d /workspaces ]]; then
    CACHE_DIR="/workspaces/.estack-camillanode-demo"
else
    CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/estack-camillanode-demo"
fi

BIN_DIR="$CACHE_DIR/bin"
RUN_DIR="$CACHE_DIR/run"
LOG_DIR="$CACHE_DIR/log"
TMP_DIR="$CACHE_DIR/tmp"
CAMILLA_VERSION="${CAMILLA_VERSION:-4.1.3}"
MAIN_CONFIG="$ROOT_DIR/dev/estack-demo.yml"
SPECTRUM_CONFIG="$RUN_DIR/spectrum-demo.yml"

mkdir -p "$BIN_DIR" "$RUN_DIR" "$LOG_DIR" "$TMP_DIR"

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

stop_previous_codespace_demo() {
    # Only take over processes/ports automatically inside Codespaces. Never
    # interfere with the Raspberry services if this helper is run there.
    if [[ "${CODESPACES:-false}" != "true" ]]; then
        return
    fi

    pkill -f '[n]odemon index.js' >/dev/null 2>&1 || true
    pkill -f '[n]ode index.js' >/dev/null 2>&1 || true
    pkill -f '[g]enerate-input-demo.py' >/dev/null 2>&1 || true

    if command -v fuser >/dev/null 2>&1; then
        fuser -k 1234/tcp >/dev/null 2>&1 || true
        fuser -k 6413/tcp >/dev/null 2>&1 || true
        fuser -k 8080/tcp >/dev/null 2>&1 || true
    fi

    # Clean the unbounded raw files created by the first manual bootstrap tests.
    rm -f /tmp/estack-demo.raw /tmp/camilladsp-demo.raw 2>/dev/null || true
    sleep 0.3
}

ensure_system_dependencies() {
    # Do not use grep -q here: with `set -o pipefail`, an early grep exit can
    # make ldconfig receive SIGPIPE and abort the launcher even when the library
    # is actually installed.
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

    cleanup_download_tmp() {
        rm -rf "$temp_dir"
    }
    trap cleanup_download_tmp RETURN

    curl -fL --retry 3 \
        "https://github.com/HEnquist/camilladsp/releases/download/v${CAMILLA_VERSION}/camilladsp-linux-${CAMILLA_ARCH}.tar.gz" \
        -o "$archive"
    tar -xzf "$archive" -C "$temp_dir"
    install -m 0755 "$temp_dir/camilladsp" "$CAMILLA_BIN"
    cleanup_download_tmp
    trap - RETURN
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
    local attempts=50

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

# Recover from previous manual tests first, then prepare the runtime.
stop_previous_codespace_demo
ensure_system_dependencies
download_camilladsp

# Build a standalone cloud analyzer. Production setupFiles/spectrum.yml is not
# read or changed by the cloud demo.
python3 "$ROOT_DIR/dev/make-spectrum-demo.py" "$SPECTRUM_CONFIG" >/dev/null

validate_config "main E-Stack DSP" "$MAIN_CONFIG"
validate_config "30-band spectrum" "$SPECTRUM_CONFIG"

cd "$ROOT_DIR"
if [[ ! -d node_modules ]]; then
    echo "Installing CamillaNode dependencies..."
    npm install --no-audit --no-fund
fi

MAIN_PID=""
SPECTRUM_PID=""
cleanup() {
    local status=$?
    trap - EXIT INT TERM
    [[ -n "$MAIN_PID" ]] && kill "$MAIN_PID" >/dev/null 2>&1 || true
    [[ -n "$SPECTRUM_PID" ]] && kill "$SPECTRUM_PID" >/dev/null 2>&1 || true
    pkill -f '[g]enerate-input-demo.py' >/dev/null 2>&1 || true
    rm -f "$RUN_DIR/main.pid" "$RUN_DIR/spectrum.pid"
    exit "$status"
}
trap cleanup EXIT INT TERM

# CamillaDSP's built-in SignalGenerator clones one waveform to every capture
# channel. For an 8-input E-Stack preview that would make all eight raw-input
# meters move. Feed stdin instead: CH1/CH2 carry -30 dBFS noise and CH3-CH8
# remain exact digital silence.
"$CAMILLA_BIN" --port 1234 --loglevel warn "$MAIN_CONFIG" \
    < <(python3 "$ROOT_DIR/dev/generate-input-demo.py") \
    >"$LOG_DIR/camilladsp-main.log" 2>&1 &
MAIN_PID=$!
echo "$MAIN_PID" > "$RUN_DIR/main.pid"

"$CAMILLA_BIN" --port 6413 --loglevel warn "$SPECTRUM_CONFIG" >"$LOG_DIR/camilladsp-spectrum.log" 2>&1 &
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

export ESTACK_DEMO=1
export CAMILLANODE_PORT=8080
export CAMILLADSP_PROXY_HOST=127.0.0.1
export CAMILLADSP_PORT=1234
export CAMILLA_SPECTRUM_PORT=6413

printf '\nE-Stack cloud demo is ready:\n'
printf '  Demo input:   CH1/CH2 noise @ -30 dBFS; CH3-CH8 digital silence\n'
printf '  Main DSP:     ws://127.0.0.1:1234\n'
printf '  Spectrum DSP: ws://127.0.0.1:6413\n'
printf '  CamillaNode:  http://localhost:8080\n'
if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
    printf '  Browser:      https://%s-8080.%s\n' "$CODESPACE_NAME" "$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN"
fi
printf '\nRuntime/cache: %s\n' "$CACHE_DIR"
printf 'Keep this command running while you work. Ctrl+C stops the demo.\n\n'

npm start
