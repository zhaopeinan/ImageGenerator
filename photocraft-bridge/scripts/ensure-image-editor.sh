#!/usr/bin/env bash
# Ensure local image-editor / 神笔 HTTP API is up.
# Discovers Electron dynamic port via ~/.shenbi/runtime.json when present.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/config.json"
EXAMPLE="$ROOT/config.example.json"
SRC="$CFG"
[[ -f "$CFG" ]] || SRC="$EXAMPLE"

read_editor_dir() {
  python3 - <<PY
import json
from pathlib import Path
root = Path(r"$ROOT")
cfg = json.load(open(r"$SRC"))
raw = cfg.get("image_editor_dir") or str(root.parent / "image-editor")
p = Path(raw).expanduser()
print(p if p.is_absolute() else (root / p).resolve())
PY
}

configured_base() {
  python3 - <<PY
import json
from pathlib import Path
p = Path(r"$SRC")
if p.is_file():
    print(json.load(p.open()).get("image_editor_base", "http://127.0.0.1:5179"))
else:
    print("http://127.0.0.1:5179")
PY
}

runtime_base() {
  python3 - <<'PY'
import json
from pathlib import Path
p = Path.home() / ".shenbi" / "runtime.json"
if not p.is_file():
    raise SystemExit(0)
try:
    base = json.loads(p.read_text()).get("base") or ""
except Exception:
    raise SystemExit(0)
print(base)
PY
}

health_ok() {
  curl -fsS -m 2 "${1%/}/api/health" >/dev/null 2>&1
}

EDITOR_DIR="$(read_editor_dir)"
CONFIGURED="$(configured_base)"
RUNTIME="$(runtime_base || true)"

# Prefer live Electron / server runtime, then configured default
for CAND in $RUNTIME "$CONFIGURED"; do
  [[ -z "${CAND}" ]] && continue
  if health_ok "$CAND"; then
    echo "image-editor already up at ${CAND}"
    exit 0
  fi
done

if [[ ! -d "${EDITOR_DIR}" ]]; then
  echo "image-editor dir not found: ${EDITOR_DIR}" >&2
  exit 1
fi

LOG="/tmp/photocraft-bridge-image-editor.log"
START_BASE="$CONFIGURED"
PORT="$(python3 -c "from urllib.parse import urlparse;print(urlparse(r'''$START_BASE''').port or 5179)")"

echo "starting image-editor in ${EDITOR_DIR} on :${PORT} ..."

(
  cd "${EDITOR_DIR}"
  export HOST=127.0.0.1
  export PORT="${PORT}"
  if [[ -f dist/index.html && -f server/index.js ]]; then
    nohup node server/index.js >>"${LOG}" 2>&1 &
  else
    nohup npm start >>"${LOG}" 2>&1 &
  fi
  echo $! >/tmp/photocraft-bridge-image-editor.pid
)

for i in $(seq 1 60); do
  LIVE="$(runtime_base || true)"
  for CAND in $LIVE "$START_BASE"; do
    [[ -z "${CAND}" ]] && continue
    if health_ok "$CAND"; then
      echo "image-editor ready (${i}s) at ${CAND}"
      exit 0
    fi
  done
  sleep 0.5
done

echo "image-editor start timeout. log: ${LOG}" >&2
exit 1
