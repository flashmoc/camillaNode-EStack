#!/usr/bin/env bash
set -euo pipefail

BRANCH="camilladsp-4.1-estack"
REPO="https://github.com/flashmoc/camillaNode-EStack.git"

sudo apt update
sudo apt install -y git nodejs npm

if [ -d camillanode ]; then
    echo "camillanode directory already exists; setup aborted to avoid overwriting it."
    exit 1
fi

git clone --branch "$BRANCH" --single-branch "$REPO" camillanode
cd camillanode
npm install --omit=dev

echo "E-Stack CamillaNode files installed in $(pwd)."
echo "This setup helper does not install or modify CamillaDSP."
