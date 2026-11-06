#!/bin/bash
# Verify a PhotoCraft plug-in end to end against the installed app.
#
#   ./verify.sh <plugin.wasm> <plugin-id> [workdir]
#
# Steps: install -> list -> run on a generated fixture -> save PNG.
# Generic assertions only (the run must succeed, the image must actually change,
# and the result must not be degenerate). Add your own pixel assertions on top.
set -uo pipefail

CLI="${PHOTOCRAFT_CLI:-/Applications/PhotoCraft.app/Contents/MacOS/photocraft-cli}"
HERE="$(cd "$(dirname "$0")" && pwd)"

WASM="${1:-}"
ID="${2:-}"
WORK="${3:-$HERE/../.verify}"

if [[ -z "$WASM" || -z "$ID" ]]; then
  echo "usage: $0 <plugin.wasm> <plugin-id> [workdir]" >&2
  exit 2
fi
WASM="$(cd "$(dirname "$WASM")" && pwd)/$(basename "$WASM")"
[[ -f "$WASM" ]] || { echo "no such file: $WASM" >&2; exit 2; }
[[ -x "$CLI" ]] || { echo "no PhotoCraft CLI at $CLI (set PHOTOCRAFT_CLI)" >&2; exit 2; }

mkdir -p "$WORK"
cd "$WORK" || exit 2

echo "== 0. fixture"
[[ -f fixture.png ]] || python3 "$HERE/make_fixture.py" fixture.png || exit 2
rm -f out.png

echo "== 1. install + list + run"
"$CLI" run fixture.png \
  --cmd plugin.install --params "{\"path\":\"$WASM\",\"replace\":true}" \
  --cmd plugin.list \
  --cmd plugin.run     --params "{\"id\":\"$ID\"}" \
  --out out.png
rc=$?
if [[ $rc -ne 0 ]]; then echo "FAIL: CLI exited $rc" >&2; exit 1; fi
[[ -f out.png ]] || { echo "FAIL: no out.png produced" >&2; exit 1; }

echo "== 2. assertions"
python3 - "$WORK/fixture.png" "$WORK/out.png" <<'PY'
import sys
from PIL import Image
a = Image.open(sys.argv[1]).convert("RGBA")
b = Image.open(sys.argv[2]).convert("RGBA")
if a.size != b.size:
    print(f"FAIL: size changed {a.size} -> {b.size}"); sys.exit(1)
pa, pb = a.load(), b.load()
w, h = a.size
changed = sum(1 for y in range(h) for x in range(w) if pa[x, y] != pb[x, y])
nonzero_alpha = sum(1 for y in range(h) for x in range(w) if pb[x, y][3] > 0)
total = w * h
print(f"changed pixels : {changed}/{total} ({100*changed/total:.1f}%)")
print(f"opaque output  : {nonzero_alpha}/{total}")
if changed == 0:
    print("FAIL: identical output, the filter did nothing"); sys.exit(1)
if nonzero_alpha == 0:
    print("FAIL: output fully transparent (alpha destroyed)"); sys.exit(1)
print("PASS (generic checks)")
PY

echo "== done: $WORK/out.png"
