"""CLI: generate / edit against PhotoCraft + image-editor."""

from __future__ import annotations

import argparse
import sys
from typing import Any

from .config import launch_hint, load_config
from . import image_api
from .ensure import ensure_photocraft
from .photocraft_client import Photocraft
from .workflow import get_from_photocraft, selection_to_openai_mask, send_to_photocraft


def _channel_and_flags(
    cfg: dict[str, Any], channel_id: str | None = None
) -> tuple[dict[str, Any], bool]:
    base = cfg["image_editor_base"]
    try:
        image_api.health(base)
    except image_api.ImageEditorError as e:
        raise SystemExit(str(e)) from e
    channel = image_api.pick_channel(base, channel_id or cfg.get("channelId"))
    size_via_prompt = channel.get("sizeViaPrompt") is True
    print(f"[bridge] 渠道：{channel.get('name')} ({channel['id']})", flush=True)
    if size_via_prompt:
        print("[bridge] 该渠道 size 无效，比例靠提示词（不传 size）", flush=True)
    return channel, size_via_prompt


def cmd_generate(cfg: dict[str, Any], args: argparse.Namespace) -> int:
    channel, size_via = _channel_and_flags(cfg, args.channel)
    ensure_photocraft(cfg)
    # Get / API / Send 各用独立连接：上游生图可达数分钟，长连接会被宿主掐掉。
    with Photocraft(cfg) as pc:
        got = get_from_photocraft(
            pc,
            source=args.source or cfg["source"],
            crop_to_selection=False,
            padding=int(cfg["crop_padding"]),
            require_prompt=True,
        )
    prompt = args.prompt or got.prompt
    print(f"[bridge] generate：{prompt[:80]}{'…' if len(prompt) > 80 else ''}", flush=True)
    size = None if size_via else (args.size or cfg["size"])
    if size_via and "比例" not in prompt and "aspect" not in prompt.lower():
        prompt = f"{prompt}\n（画面比例 1:1）"
    print("[bridge] 正在请求 image-editor…", flush=True)
    result = image_api.generate(
        cfg["image_editor_base"],
        channel["id"],
        prompt=prompt,
        model=args.model or cfg["model"],
        size=size,
        quality=args.quality or cfg["quality"],
        size_via_prompt=size_via,
    )
    print(f"[bridge] 上游返回 {result.size[0]}×{result.size[1]}，写回 PhotoCraft…", flush=True)
    with Photocraft(cfg) as pc:
        send_to_photocraft(
            pc,
            result,
            layer_name=args.layer_name or "ImageGen",
            target=got.target,
            apply_selection_alpha=False,
        )
    name = args.layer_name or "ImageGen"
    print(f"[bridge] 完成：已写入图层 {name}", flush=True)
    return 0


def cmd_edit(cfg: dict[str, Any], args: argparse.Namespace) -> int:
    channel, size_via = _channel_and_flags(cfg, args.channel)
    ensure_photocraft(cfg)
    with Photocraft(cfg) as pc:
        got = get_from_photocraft(
            pc,
            source=args.source or cfg["source"],
            crop_to_selection=True,
            padding=int(args.padding if args.padding is not None else cfg["crop_padding"]),
            invert_mask=bool(args.invert_mask),
            require_prompt=True,
        )
    if got.mask is None:
        raise SystemExit("需要选区或 Quick Mask 才能局部编辑")
    prompt = args.prompt or got.prompt
    print(f"[bridge] edit：{prompt[:80]}{'…' if len(prompt) > 80 else ''}", flush=True)
    print(
        f"[bridge] 裁切区域 {got.target.w}×{got.target.h} @ ({got.target.x},{got.target.y})",
        flush=True,
    )

    openai_mask = selection_to_openai_mask(got.mask)
    size = None if size_via else (args.size or _nearest_size(got.target.w, got.target.h, cfg["size"]))
    print("[bridge] 正在请求 image-editor…", flush=True)
    result = image_api.edit(
        cfg["image_editor_base"],
        channel["id"],
        prompt=prompt,
        model=args.model or cfg["model"],
        image=got.image,
        mask=openai_mask,
        size=size,
        quality=args.quality or cfg["quality"],
        size_via_prompt=size_via,
    )
    print(f"[bridge] 上游返回 {result.size[0]}×{result.size[1]}，写回 PhotoCraft…", flush=True)
    with Photocraft(cfg) as pc:
        send_to_photocraft(
            pc,
            result,
            layer_name=args.layer_name or "ImageEdit",
            target=got.target,
            apply_selection_alpha=not args.no_selection_alpha,
            layer_mask=bool(args.layer_mask),
        )
    print("[bridge] 完成：已写入图层", args.layer_name or "ImageEdit", flush=True)
    return 0


def _nearest_size(w: int, h: int, fallback: str) -> str:
    """Pick a common OpenAI-ish size matching aspect roughly."""
    aspect = w / max(h, 1)
    candidates = [
        (1.0, "1024x1024"),
        (1024 / 1536, "1024x1536"),
        (1536 / 1024, "1536x1024"),
    ]
    best = min(candidates, key=lambda c: abs(c[0] - aspect))
    return best[1] if abs(best[0] - aspect) < 0.35 else fallback


def cmd_status(cfg: dict[str, Any], _args: argparse.Namespace) -> int:
    print("config port     :", cfg["port"])
    print("bridge_dir      :", cfg["bridge_dir"])
    print("image_editor    :", cfg["image_editor_base"])
    try:
        h = image_api.health(cfg["image_editor_base"])
        print("image-editor    : ok", h)
        ch = image_api.pick_channel(cfg["image_editor_base"], cfg.get("channelId"))
        print("default channel :", ch.get("name"), ch["id"])
    except image_api.ImageEditorError as e:
        print("image-editor    :", e)
    try:
        ensure_photocraft(cfg)
        with Photocraft(cfg) as pc:
            ui = pc.call("ui.inspect")
            active = ui["session"]["active"]
            print("photocraft      : connected")
            print("active document :", active)
    except RuntimeError as e:
        print("photocraft      :", e)
        print(launch_hint(cfg))
        return 1
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m photocraft_bridge",
        description="PhotoCraft control-channel ↔ image-editor 生图/局部编辑桥",
    )
    sub = p.add_subparsers(dest="command", required=True)

    st = sub.add_parser("status", help="检查 PhotoCraft / image-editor 连通性")
    st.set_defaults(func=cmd_status)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--prompt", help="覆盖 Notes 里的提示词")
    common.add_argument("--model", help="模型名，默认配置里的 model")
    common.add_argument("--size", help="如 1024x1024（sizeViaPrompt 渠道会忽略）")
    common.add_argument("--quality", choices=["low", "medium", "high"])
    common.add_argument("--channel", help="覆盖默认渠道 id")
    common.add_argument(
        "--source",
        choices=["composite", "active_layer"],
        help="导出复合图或仅活动图层",
    )
    common.add_argument("--layer-name", help="写回图层名")

    g = sub.add_parser("generate", parents=[common], help="文生图，结果写入新图层")
    g.set_defaults(func=cmd_generate)

    e = sub.add_parser("edit", parents=[common], help="按选区局部编辑，结果贴回")
    e.add_argument("--padding", type=int, help="选区外扩像素")
    e.add_argument("--invert-mask", action="store_true", help="反转选区/Quick Mask")
    e.add_argument(
        "--layer-mask",
        action="store_true",
        help="把选区做成图层蒙版而不是像素透明",
    )
    e.add_argument(
        "--no-selection-alpha",
        action="store_true",
        help="写回时不按选区裁切 alpha（整块矩形）",
    )
    e.set_defaults(func=cmd_edit)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cfg = load_config()
    try:
        return int(args.func(cfg, args))
    except KeyboardInterrupt:
        print("\n已取消", file=sys.stderr)
        return 130
    except (RuntimeError, image_api.ImageEditorError) as e:
        print(f"错误：{e}", file=sys.stderr)
        return 1
