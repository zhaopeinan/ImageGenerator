#!/usr/bin/env bash
# PhotoCraft 文生图：读 Notes 提示词 → 新图层 ImageGen
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
notify "PhotoCraft 桥" "正在文生图…"
set +e
out="$("$PY" -m photocraft_bridge generate 2>&1)"
code=$?
set -e
echo "$out"
if [[ $code -eq 0 ]]; then
  notify "PhotoCraft 桥" "文生图完成：图层 ImageGen"
else
  notify "PhotoCraft 桥 · 失败" "$(echo "$out" | tail -n 1 | cut -c1-120)"
fi
exit "$code"
