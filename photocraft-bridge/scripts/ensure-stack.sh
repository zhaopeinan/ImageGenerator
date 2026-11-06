#!/usr/bin/env bash
# One-click stack: image-editor API + PhotoCraft (control channel).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/scripts/ensure-image-editor.sh"
bash "$ROOT/scripts/ensure-photocraft.sh"
echo "stack ready"
