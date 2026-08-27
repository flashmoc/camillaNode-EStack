#!/usr/bin/env bash
set -euo pipefail

BRANCH="camilladsp-4.1-estack"
REPO="https://github.com/flashmoc/camillaNode-EStack.git"
RUNTIME_PATTERN='^(camillaNodeConfig\.json|currentConfig\.json|savedConfigs\.dat|config/.*|setupFiles/spectrum_.*\.yml)$'

printf '\nE-Stack Raspberry update\n'
printf 'Repository : %s\n' "$REPO"
printf 'Branch     : %s\n\n' "$BRANCH"

if [ ! -d .git ]; then
    echo "ERROR: run this script from your CamillaNode repository directory."
    exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

mapfile -t DIRTY_FILES < <(git status --porcelain=v1 | sed -E 's/^.. //' | sed -E 's/.* -> //')

for file in "${DIRTY_FILES[@]:-}"; do
    [ -z "$file" ] && continue
    if [[ ! "$file" =~ $RUNTIME_PATTERN ]]; then
        echo "ERROR: local code/content changes detected. Update aborted so nothing is overwritten:"
        git status --short
        exit 1
    fi
done

if [ "${#DIRTY_FILES[@]}" -gt 0 ]; then
    echo "Preserving local CamillaNode runtime files..."
    for file in "${DIRTY_FILES[@]}"; do
        [ -z "$file" ] && continue
        if [ -e "$file" ]; then
            mkdir -p "$TMP_DIR/$(dirname "$file")"
            cp -a "$file" "$TMP_DIR/$file"
        fi
        if git ls-files --error-unmatch "$file" >/dev/null 2>&1; then
            git restore --staged --worktree -- "$file" || true
        else
            rm -rf -- "$file"
        fi
    done
fi

git remote set-url origin "$REPO"
git fetch origin "$BRANCH"

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git switch "$BRANCH"
else
    git switch --track -c "$BRANCH" "origin/$BRANCH"
fi

git pull --ff-only origin "$BRANCH"

# Restore machine-local CamillaNode state after updating tracked application files.
if [ "${#DIRTY_FILES[@]}" -gt 0 ]; then
    echo "Restoring local runtime files..."
    for file in "${DIRTY_FILES[@]}"; do
        [ -z "$file" ] && continue
        if [ -e "$TMP_DIR/$file" ]; then
            mkdir -p "$(dirname "$file")"
            cp -a "$TMP_DIR/$file" "$file"
        fi
    done
fi

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
echo "CamillaDSP YAML, CamillaDSP binaries/services, ALSA configuration and audio routing were not modified."
echo "Your local CamillaNode runtime files were preserved."
echo "Hard-refresh the browser if old CSS remains cached."
