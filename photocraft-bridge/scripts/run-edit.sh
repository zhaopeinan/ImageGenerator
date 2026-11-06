#!/usr/bin/env bash
# PhotoCraft 局部编辑：选区 + Notes → 新图层 ImageEdit
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/.venv/bin/python"
[[ -x "$PY" ]] || PY="$(command -v python3)"

notify() {
  local title="$1" msg="$2"
  osascript -e "display notification \"${msg//\"/\\\"}\" with title \"${title//\"/\\\"}\"" 2>/dev/null || true
}

cd "$ROOT"
bash "$ROOT/scripts/ensure-stack.sh" >/tmp/photocraft-bridge-ensure.log 2>&1 || true
notify "PhotoCraft 桥" "正在局部编辑…"
set +e
out="$("$PY" -m photocraft_bridge edit 2>&1)"
code=$?
set -e
echo "$out"
if [[ $code -eq 0 ]]; then
  notify "PhotoCraft 桥" "局部编辑完成：图层 ImageEdit"
else
  notify "PhotoCraft 桥 · 失败" "$(echo "$out" | tail -n 1 | cut -c1-120)"
fi
exit "$code"
