"""Ensure image-editor + PhotoCraft control are up (auto-launch if needed)."""

from __future__ import annotations

import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .config import PACKAGE_ROOT, load_config


def control_listening(port: int, host: str = "127.0.0.1", timeout: float = 0.4) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def image_editor_ok(base: str, timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(f"{base.rstrip('/')}/api/health", timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def ensure_stack(cfg: dict[str, Any] | None = None, *, wait: float = 60.0) -> None:
    """Start image-editor and PhotoCraft(control) if either is down."""
    c = cfg or load_config()
    port = int(c["port"])
    base = str(c["image_editor_base"])
    api_ok = image_editor_ok(base)
    pc_ok = control_listening(port)
    if api_ok and pc_ok:
        return

    script = PACKAGE_ROOT / "scripts" / "ensure-stack.sh"
    if not script.is_file():
        raise RuntimeError(f"缺少启动脚本：{script}")

    print("[bridge] 正在自动拉起 image-editor / PhotoCraft…", flush=True)
    subprocess.run(["bash", str(script)], check=True)

    deadline = time.monotonic() + wait
    token = Path(c["token_file"])
    while time.monotonic() < deadline:
        if image_editor_ok(base) and control_listening(port) and token.is_file():
            print("[bridge] 后端与 PhotoCraft 已就绪", flush=True)
            return
        time.sleep(0.4)
    raise RuntimeError(f"等待服务就绪超时。请手动运行：\n  {script}")


# Back-compat alias used by cli
def ensure_photocraft(cfg: dict[str, Any] | None = None, *, wait: float = 60.0) -> None:
    ensure_stack(cfg, wait=wait)
