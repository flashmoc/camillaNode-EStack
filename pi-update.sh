#!/usr/bin/env bash
set -euo pipefail

BRANCH="camilladsp-4.1-estack"
REPO="https://github.com/flashmoc/camillaNode-EStack.git"

printf '\nE-Stack Raspberry update\n'
printf 'Repository : %s\n' "$REPO"
printf 'Branch     : %s\n\n' "$BRANCH"

if [ ! -d .git ]; then
    echo "ERROR: run ./pi-update.sh from your CamillaNode repository directory."
    exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
    echo "ERROR: local repository changes detected. Nothing has been changed."
    git status --short
    echo "Commit/stash those changes, then rerun ./pi-update.sh."
    exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
    echo "Switching from '$CURRENT_BRANCH' to '$BRANCH'..."
fi

git remote set-url origin "$REPO"
git fetch origin "$BRANCH"
git switch "$BRANCH"
git pull --ff-only origin "$BRANCH"

# Only Node runtime dependencies are required on the Raspberry.
# This does not touch CamillaDSP binaries, YAML, ALSA, output routing or system audio files.
npm install --omit=dev

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files --type=service | grep -q '^camillanode.service'; then
    echo "Restarting camillanode.service..."
    sudo systemctl restart camillanode.service
    sleep 1
    if sudo systemctl is-active --quiet camillanode.service; then
        echo "camillanode.service: active"
    else
        echo "ERROR: camillanode.service did not become active."
        sudo systemctl --no-pager --full status camillanode.service || true
        exit 1
    fi
else
    echo "NOTE: camillanode.service was not found; files are updated but no service was restarted."
fi

printf '\nUpdate complete.\n'
echo "CamillaDSP configuration, CamillaDSP service files and ALSA configuration were not modified."
echo "Open the E-Stack UI and hard-refresh the browser if CSS is cached."
