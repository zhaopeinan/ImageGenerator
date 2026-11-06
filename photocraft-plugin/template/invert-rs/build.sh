#!/bin/bash
# Build a PhotoCraft plug-in from Rust to .wasm and sanity-check it.
#   ./build.sh [crate-dir] [out.wasm]
set -euo pipefail

CRATE_DIR="${1:-$(cd "$(dirname "$0")" && pwd)}"
OUT="${2:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"

command -v cargo >/dev/null || { echo "cargo not found: install Rust first (https://rustup.rs)" >&2; exit 2; }

rustup target add wasm32-unknown-unknown

( cd "$CRATE_DIR" && cargo build --release --target wasm32-unknown-unknown )

NAME="$(sed -n 's/^name *= *"\(.*\)"/\1/p' "$CRATE_DIR/Cargo.toml" | head -1 | tr '-' '_')"
WASM="$CRATE_DIR/target/wasm32-unknown-unknown/release/$NAME.wasm"
[[ -f "$WASM" ]] || { echo "expected artifact not found: $WASM" >&2; exit 1; }

if [[ -n "$OUT" ]]; then
  mkdir -p "$(dirname "$OUT")"
  cp "$WASM" "$OUT"
  WASM="$OUT"
fi

ls -l "$WASM"
node "$HERE/../scripts/inspect_wasm.mjs" "$WASM"
