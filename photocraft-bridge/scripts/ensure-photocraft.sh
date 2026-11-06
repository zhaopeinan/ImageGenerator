#!/usr/bin/env bash
# 保证 PhotoCraft 以 control channel 运行；已就绪则只前置窗口。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CFG="$ROOT/config.json"
EXAMPLE="$ROOT/config.example.json"
SRC="$CFG"
[[ -f "$CFG" ]] || SRC="$EXAMPLE"

PORT="$(python3 -c "import json;print(json.load(open(r'$SRC')).get('port',7878))")"
BRIDGE_DIR="$(python3 - <<PY
import json, os
from pathlib import Path
root = Path(r"$ROOT"); cfg = json.load(open(r"$SRC"))
p = Path(os.path.expanduser(cfg.get("bridge_dir", "./.exchange")))
print(p if p.is_absolute() else (root / p).resolve())
PY
)"
TOKEN_FILE="$(python3 - <<PY
import json, os
from pathlib import Path
root = Path(r"$ROOT"); cfg = json.load(open(r"$SRC"))
p = Path(os.path.expanduser(cfg.get("token_file", "./.exchange/control.token")))
print(p if p.is_absolute() else (root / p).resolve())
PY
)"
APP="$(python3 -c "import json;print(json.load(open(r'$SRC')).get('photocraft_app','/Applications/PhotoCraft.app/Contents/MacOS/PhotoCraft'))")"

mkdir -p "$BRIDGE_DIR"

control_up() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | grep -q LISTEN
}

activate_app() {
  osascript -e 'tell application "PhotoCraft" to activate' 2>/dev/null || true
}

if control_up; then
  echo "PhotoCraft control already on :${PORT}, activating"
  activate_app
  exit 0
fi

if [[ ! -x "${APP}" ]]; then
  echo "PhotoCraft not found: ${APP}" >&2
  exit 1
fi

# Running without control -> restart so args apply
if pgrep -x PhotoCraft >/dev/null 2>&1; then
  echo "PhotoCraft is running without control; restarting..."
  osascript -e 'tell application "PhotoCraft" to quit' 2>/dev/null || true
  for _ in $(seq 1 40); do
    pgrep -x PhotoCraft >/dev/null 2>&1 || break
    sleep 0.25
  done
  if pgrep -x PhotoCraft >/dev/null 2>&1; then
    killall PhotoCraft 2>/dev/null || true
    sleep 0.5
  fi
fi

echo "starting PhotoCraft with control :${PORT} ..."
nohup "$APP" \
  --control "${PORT}" \
  --control-token-file "${TOKEN_FILE}" \
  --automation-read-root "${BRIDGE_DIR}" \
  --automation-write-root "${BRIDGE_DIR}" \
  >/tmp/photocraft-bridge-launch.log 2>&1 &

for i in $(seq 1 60); do
  if control_up && [[ -f "${TOKEN_FILE}" ]]; then
    echo "ready (${i}s)"
    activate_app
    exit 0
  fi
  sleep 0.5
done

echo "PhotoCraft start timeout. log: /tmp/photocraft-bridge-launch.log" >&2
exit 1
