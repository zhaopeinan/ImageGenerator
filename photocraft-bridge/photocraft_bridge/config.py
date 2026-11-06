"""Load bridge config from config.json next to the package root."""

from __future__ import annotations

import json
import os
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


def _resolve_path(path: str) -> str:
    """Expand ~ and resolve relative paths against the package root."""
    p = Path(os.path.expanduser(path))
    if not p.is_absolute():
        p = (PACKAGE_ROOT / p).resolve()
    return str(p)


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
    return cfg


def launch_hint(cfg: dict[str, Any] | None = None) -> str:
    c = cfg or load_config()
    script = PACKAGE_ROOT / "scripts" / "ensure-stack.sh"
    dock = Path.home() / "Applications/PhotoCraft Bridge/PhotoCraft AI.app"
    return (
        "需要 image-editor + 带 control 的 PhotoCraft。任选其一：\n"
        f"  • 点 Dock / Spotlight：{dock}\n"
        f"  • 终端：{script}\n"
        f"（PhotoCraft :{c['port']}，API {c['image_editor_base']}）"
    )
