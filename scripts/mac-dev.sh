#!/bin/sh
# Run on the Mac: copy the VPS working tree (uncommitted changes included), build it and relaunch the app.
#   ssh debian@vps-lanacool cat Projets/claude-bar/scripts/mac-dev.sh | sh
set -eu

VPS=${VPS_HOST:-debian@vps-lanacool}
SRC=${VPS_DIR:-Projets/claude-bar}
DIR=${MAC_DIR:-$HOME/claude-bar-dev}
LOG=/tmp/claude-bar-dev.log

mkdir -p "$DIR"
rsync -az --delete --exclude node_modules --exclude dist --exclude release --exclude .git \
  --exclude research_notes --exclude reports "$VPS:$SRC/" "$DIR/"
cd "$DIR"

# Reinstall only when the lockfile changed since the last install
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund
fi
# npm allowScripts can skip Electron's postinstall (binary download)
[ -d node_modules/electron/dist ] || node node_modules/electron/install.js
npm run build

pkill -f "$DIR/node_modules/electron/dist" 2>/dev/null && sleep 1 || true
nohup ./node_modules/.bin/electron . >"$LOG" 2>&1 &
echo "Claude Bar launched from $DIR. Logs below (Ctrl+C stops the logs, not the app)."
exec tail -f "$LOG"
