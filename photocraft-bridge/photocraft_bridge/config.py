"""Load bridge config from config.json next to the package root."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
DEFAULTS: dict[str, Any] = {
    "port": 7878,
    "token_file": "./.exchange/control.token",
    "bridge_dir": "./.exchange",
    "image_editor_base": "http://127.0.0.1:5179",
    "image_editor_dir": "../image-editor",
    "channelId": None,
    "model": "gpt-image-2",
    "size": "1024x1024",
    "quality": "high",
    "source": "composite",
    "crop_padding": 32,
    "photocraft_app": "/Applications/PhotoCraft.app/Contents/MacOS/PhotoCraft",
}

# 神笔 / image-editor 启动时写入，含 Electron 动态端口
RUNTIME_FILE = Path.home() / ".shenbi" / "runtime.json"


def _resolve_path(path: str) -> str:
    """Expand ~ and resolve relative paths against the package root."""
    p = Path(os.path.expanduser(path))
    if not p.is_absolute():
        p = (PACKAGE_ROOT / p).resolve()
    return str(p)


def read_runtime_base() -> str | None:
    """Read live image-editor base URL written by 神笔 / node server."""
    if not RUNTIME_FILE.is_file():
        return None
    try:
        data = json.loads(RUNTIME_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    base = data.get("base")
    return str(base).rstrip("/") if base else None


def _health_ok(base: str, timeout: float = 1.5) -> bool:
    url = f"{base.rstrip('/')}/api/health"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return 200 <= getattr(resp, "status", 200) < 300
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def resolve_image_editor_base(cfg: dict[str, Any]) -> str:
    """
    Prefer a live runtime endpoint (Electron dynamic port), then config default.
    Health-check before returning a candidate that claims to be up.
    """
    configured = str(cfg.get("image_editor_base") or DEFAULTS["image_editor_base"]).rstrip("/")
    candidates: list[str] = []
    runtime = read_runtime_base()
    if runtime:
        candidates.append(runtime)
    if configured not in candidates:
        candidates.append(configured)

    for base in candidates:
        if _health_ok(base):
            return base
    # Nothing healthy — return configured so ensure scripts can start :5179
    return configured


def load_config(path: Path | None = None) -> dict[str, Any]:
    cfg = dict(DEFAULTS)
    cfg_path = path or (PACKAGE_ROOT / "config.json")
    example = PACKAGE_ROOT / "config.example.json"
    if cfg_path.is_file():
        with cfg_path.open(encoding="utf-8") as f:
            cfg.update(json.load(f))
    elif example.is_file():
        with example.open(encoding="utf-8") as f:
            cfg.update({k: v for k, v in json.load(f).items() if k in DEFAULTS})

    cfg["token_file"] = _resolve_path(str(cfg["token_file"]))
    cfg["bridge_dir"] = _resolve_path(str(cfg["bridge_dir"]))
    if cfg.get("image_editor_dir"):
        cfg["image_editor_dir"] = _resolve_path(str(cfg["image_editor_dir"]))
    cfg["port"] = int(cfg["port"])
    cfg["crop_padding"] = int(cfg["crop_padding"])
    # 运行时解析：Electron 动态端口优先于写死的 5179
    cfg["image_editor_base"] = resolve_image_editor_base(cfg)
    return cfg


def launch_hint(cfg: dict[str, Any] | None = None) -> str:
    c = cfg or load_config()
    script = PACKAGE_ROOT / "scripts" / "ensure-stack.sh"
    dock = Path.home() / "Applications/PhotoCraft Bridge/PhotoCraft AI.app"
    return (
        "需要 神笔/image-editor + 带 control 的 PhotoCraft。任选其一：\n"
        f"  • 打开桌面应用「神笔」\n"
        f"  • 点 Dock / Spotlight：{dock}\n"
        f"  • 终端：{script}\n"
        f"（PhotoCraft :{c['port']}，API {c['image_editor_base']}）"
    )
