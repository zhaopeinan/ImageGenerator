#!/usr/bin/env bash
# 兼容旧入口：转调 ensure（前台不阻塞终端时用 ensure 的后台启动）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/scripts/ensure-stack.sh"
