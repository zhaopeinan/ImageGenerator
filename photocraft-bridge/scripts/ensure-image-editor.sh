#!/usr/bin/env bash
# Ensure local image-editor HTTP API is up (default http://127.0.0.1:5179).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/config.json"
EXAMPLE="$ROOT/config.example.json"
SRC="$CFG"
[[ -f "$CFG" ]] || SRC="$EXAMPLE"

BASE="$(python3 -c "import json;print(json.load(open(r'$SRC')).get('image_editor_base','http://127.0.0.1:5179'))")"
EDITOR_DIR="$(python3 - <<PY
import json
from pathlib import Path
root = Path(r"$ROOT")
cfg = json.load(open(r"$SRC"))
raw = cfg.get("image_editor_dir") or str(root.parent / "image-editor")
p = Path(raw).expanduser()
print(p if p.is_absolute() else (root / p).resolve())
PY
)"

health_ok() {
  curl -fsS -m 2 "${BASE%/}/api/health" >/dev/null 2>&1
}

if health_ok; then
  echo "image-editor already up at ${BASE}"
  exit 0
fi

if [[ ! -d "${EDITOR_DIR}" ]]; then
  echo "image-editor dir not found: ${EDITOR_DIR}" >&2
  exit 1
fi

LOG="/tmp/photocraft-bridge-image-editor.log"
echo "starting image-editor in ${EDITOR_DIR} ..."

# Prefer already-built server (fast). Fall back to npm start (build + serve).
(
  cd "${EDITOR_DIR}"
  if [[ -f dist/index.html && -f server/index.js ]]; then
    nohup node server/index.js >>"${LOG}" 2>&1 &
  else
    nohup npm start >>"${LOG}" 2>&1 &
  fi
  echo $! >/tmp/photocraft-bridge-image-editor.pid
)

for i in $(seq 1 60); do
  if health_ok; then
    echo "image-editor ready (${i}s) at ${BASE}"
    exit 0
  fi
  sleep 0.5
done

echo "image-editor start timeout. log: ${LOG}" >&2
exit 1
