#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/estack-camillanode-demo"
BIN_DIR="$CACHE_DIR/bin"
RUN_DIR="$CACHE_DIR/run"
LOG_DIR="$CACHE_DIR/log"
CAMILLA_VERSION="${CAMILLA_VERSION:-4.1.3}"
MAIN_CONFIG="$ROOT_DIR/dev/estack-demo.yml"
SPECTRUM_CONFIG="$RUN_DIR/spectrum-demo.yml"

mkdir -p "$BIN_DIR" "$RUN_DIR" "$LOG_DIR"

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

ensure_system_dependencies() {
    if ldconfig -p 2>/dev/null | grep -q 'libasound\.so\.2'; then
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
    temp_dir="$(mktemp -d)"
    archive="$temp_dir/camilladsp.tar.gz"
    trap 'rm -rf "$temp_dir"' RETURN

    curl -fL --retry 3 \
        "https://github.com/HEnquist/camilladsp/releases/download/v${CAMILLA_VERSION}/camilladsp-linux-${CAMILLA_ARCH}.tar.gz" \
        -o "$archive"
    tar -xzf "$archive" -C "$temp_dir"
    install -m 0755 "$temp_dir/camilladsp" "$CAMILLA_BIN"
    rm -rf "$temp_dir"
    trap - RETURN
}

stop_previous_codespace_demo() {
    # This deliberately only takes over ports/processes inside Codespaces. It
    # must never kill the real Raspberry services when someone runs the script
    # by mistake on the hardware.
    if [[ "${CODESPACES:-false}" != "true" ]]; then
        return
    fi

    pkill -f '[n]odemon index.js' >/dev/null 2>&1 || true
    pkill -f '[n]ode index.js' >/dev/null 2>&1 || true

    if command -v fuser >/dev/null 2>&1; then
        fuser -k 1234/tcp >/dev/null 2>&1 || true
        fuser -k 6413/tcp >/dev/null 2>&1 || true
        fuser -k 8080/tcp >/dev/null 2>&1 || true
    fi
    sleep 0.3
}

ensure_system_dependencies
download_camilladsp

# Build a cloud-safe copy of the real 30-band analyzer config. The production
# setupFiles/spectrum.yml remains untouched for the Raspberry Pi.
python3 "$ROOT_DIR/dev/make-spectrum-demo.py" "$SPECTRUM_CONFIG" >/dev/null

# Validate before taking over any ports.
"$CAMILLA_BIN" -c "$MAIN_CONFIG" >/dev/null
"$CAMILLA_BIN" -c "$SPECTRUM_CONFIG" >/dev/null

cd "$ROOT_DIR"
if [[ ! -d node_modules ]]; then
    echo "Installing CamillaNode dependencies..."
    npm install --no-audit --no-fund
fi

stop_previous_codespace_demo

MAIN_PID=""
SPECTRUM_PID=""
cleanup() {
    local status=$?
    trap - EXIT INT TERM
    [[ -n "$MAIN_PID" ]] && kill "$MAIN_PID" >/dev/null 2>&1 || true
    [[ -n "$SPECTRUM_PID" ]] && kill "$SPECTRUM_PID" >/dev/null 2>&1 || true
    rm -f "$RUN_DIR/main.pid" "$RUN_DIR/spectrum.pid"
    exit "$status"
}
trap cleanup EXIT INT TERM

"$CAMILLA_BIN" -p 1234 "$MAIN_CONFIG" >"$LOG_DIR/camilladsp-main.log" 2>&1 &
MAIN_PID=$!
echo "$MAIN_PID" > "$RUN_DIR/main.pid"

"$CAMILLA_BIN" -p 6413 "$SPECTRUM_CONFIG" >"$LOG_DIR/camilladsp-spectrum.log" 2>&1 &
SPECTRUM_PID=$!
echo "$SPECTRUM_PID" > "$RUN_DIR/spectrum.pid"

sleep 0.8

if ! kill -0 "$MAIN_PID" >/dev/null 2>&1; then
    echo "Main CamillaDSP failed to start:" >&2
    cat "$LOG_DIR/camilladsp-main.log" >&2
    exit 1
fi
if ! kill -0 "$SPECTRUM_PID" >/dev/null 2>&1; then
    echo "Spectrum CamillaDSP failed to start:" >&2
    cat "$LOG_DIR/camilladsp-spectrum.log" >&2
    exit 1
fi

export ESTACK_DEMO=1
export CAMILLANODE_PORT=8080
export CAMILLADSP_PROXY_HOST=127.0.0.1
export CAMILLADSP_PORT=1234
export CAMILLA_SPECTRUM_PORT=6413

printf '\nE-Stack cloud demo is ready:\n'
printf '  Main DSP:     ws://127.0.0.1:1234\n'
printf '  Spectrum DSP: ws://127.0.0.1:6413\n'
printf '  CamillaNode:  http://localhost:8080\n'
if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
    printf '  Browser:      https://%s-8080.%s\n' "$CODESPACE_NAME" "$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN"
fi
printf '\nKeep this command running while you work. Ctrl+C stops the demo.\n\n'

npm start
