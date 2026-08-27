#!/usr/bin/env bash
set -euo pipefail

BRANCH="camilladsp-4.1-estack"
REPO="https://github.com/flashmoc/camillaNode-EStack.git"

if [ ! -d .git ]; then
    echo "Run this script from the CamillaNode repository directory."
    exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
    echo "Local changes detected. Update aborted so nothing is overwritten."
    echo "Run 'git status' and commit/stash your changes first."
    exit 1
fi

git remote set-url origin "$REPO"
git fetch origin "$BRANCH"
git switch "$BRANCH"
git pull --ff-only origin "$BRANCH"

npm install --omit=dev

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files camillanode.service >/dev/null 2>&1; then
    sudo systemctl restart camillanode.service
    sudo systemctl --no-pager --full status camillanode.service || true
else
    echo "camillanode.service not found; repository updated but service was not restarted."
fi

echo "E-Stack CamillaNode update complete. CamillaDSP configuration was not modified."
