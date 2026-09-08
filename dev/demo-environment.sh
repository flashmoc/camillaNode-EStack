#!/usr/bin/env bash
# Shared guard and paths for the Linux-only E-Stack development simulation.
# This file is sourced by launcher/check scripts; it must never target hardware.

estack_demo_require_context() {
    if [[ "${ESTACK_DEMO_CONTEXT:-}" != "1" ]]; then
        echo "Refusing to run the E-Stack demo outside its Dev Container context." >&2
        echo "Open this repository in VS Code Dev Containers (or Codespaces) and retry." >&2
        return 1
    fi
}

estack_demo_cache_dir() {
    # Codespaces keeps this state under /workspaces; local Dev Containers use
    # the Linux user's cache. Both locations are container-local development state.
    if [[ "${CODESPACES:-false}" == "true" && -d /workspaces ]]; then
        printf '%s\n' '/workspaces/.estack-camillanode-demo'
    else
        printf '%s\n' "${XDG_CACHE_HOME:-$HOME/.cache}/estack-camillanode-demo"
    fi
}
