"""Get pixels/notes from PhotoCraft and Send results back as layers."""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from typing import Any

import numpy as np
from PIL import Image

from .photocraft_client import Photocraft


@dataclass
class Target:
    doc_name: str
    index: int
    layers: list[int]
    x: int
    y: int
    w: int
    h: int
    pw: int
    ph: int
    # Selection coverage in crop space, float32 HxW in 0..1 (1 = selected / editable)
    mask: np.ndarray | None


@dataclass
class GetResult:
    image: Image.Image  # RGB crop (or full canvas)
    mask: Image.Image | None  # L mode, white = selected
    prompt: str
    target: Target
    canvas_w: int
    canvas_h: int


def _notes_text(notes: list[dict[str, Any]] | None) -> str:
    if not notes:
        return ""
    return "\n".join(n.get("text", "") for n in notes if (n.get("text") or "").strip())


def _load_rgb(path: str) -> np.ndarray:
    with Image.open(path) as im:
        if im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info:
            im = Image.alpha_composite(
                Image.new("RGBA", im.size, (255, 255, 255, 255)), im.convert("RGBA")
            )
        im = im.convert("RGB")
        a = np.asarray(im).astype(np.float32) / 255.0
    return a


def _load_gray(path: str) -> np.ndarray:
    with Image.open(path) as im:
        im = im.convert("L")
        a = np.asarray(im).astype(np.float32) / 255.0
    return a


def _snap(a: int, b: int, size: int, m: int) -> tuple[int, int]:
    """Grow [a, b) to a multiple of m within [0, size)."""
    n = min(-(-(b - a) // m) * m, size)
    b = min(a + n, size)
    return b - n, b


def get_from_photocraft(
    pc: Photocraft,
    *,
    source: str = "composite",
    crop_to_selection: bool = False,
    padding: int = 32,
    multiple_of: int = 8,
    invert_mask: bool = False,
    require_prompt: bool = True,
) -> GetResult:
    ui = pc.call("ui.inspect")
    idx = ui["session"]["active"]
    if idx is None:
        raise RuntimeError("PhotoCraft 没有打开的文档")
    doc = ui["document"]
    name = ui["session"]["documents"][idx]["name"]
    tag = uuid.uuid4().hex[:12]
    img_name, mask_name = f"pcb_{tag}_image.png", f"pcb_{tag}_mask.png"
    files = [pc.path(img_name), pc.path(mask_name)]

    try:
        if source == "active_layer":
            if doc["activeLayer"] is None:
                raise RuntimeError("当前文档没有活动图层")
            dup = pc.run(
                "file.new",
                {
                    "width": doc["width"],
                    "height": doc["height"],
                    "background": "transparent",
                },
            )["document"]
            pc.run(
                "layer.copyToDocument",
                {"document": dup, "source": idx, "layers": [doc["activeLayer"]]},
            )
        else:
            dup = pc.run(
                "image.duplicate", {"mergedOnly": True, "name": "imagegen bridge"}
            )["document"]
        pc.save_temp_doc(dup, img_name, idx)

        channel = (
            "quickMask"
            if doc.get("quickMask")
            else "selection"
            if doc.get("hasSelection")
            else None
        )
        if channel:
            sel = pc.run("channel.duplicate", {"channel": channel, "document": "new"})[
                "document"
            ]
            pc.save_temp_doc(sel, mask_name, idx)

        image = _load_rgb(files[0])
        h, w = image.shape[:2]
        mask = _load_gray(files[1]) if channel else np.ones((h, w), np.float32)
        if invert_mask:
            mask = 1.0 - mask
    finally:
        for f in files:
            if os.path.exists(f):
                os.remove(f)

    x = y = 0
    if crop_to_selection:
        ys, xs = np.nonzero(mask > 0.5 / 255)
        if len(xs) == 0:
            raise RuntimeError("选区为空（或不在画布内），无法裁切")
        x = max(0, int(xs.min()) - padding)
        y = max(0, int(ys.min()) - padding)
        x1 = min(w, int(xs.max()) + 1 + padding)
        y1 = min(h, int(ys.max()) + 1 + padding)
        x, x1 = _snap(x, x1, w, multiple_of)
        y, y1 = _snap(y, y1, h, multiple_of)
        image, mask = image[y:y1, x:x1], mask[y:y1, x:x1]

    h, w = image.shape[:2]
    ph = -(-h // multiple_of) * multiple_of
    pw = -(-w // multiple_of) * multiple_of
    if ph != h or pw != w:
        pad_img = np.pad(image, ((0, ph - h), (0, pw - w), (0, 0)), mode="edge")
        pad_mask = np.pad(mask, ((0, ph - h), (0, pw - w)), mode="edge")
    else:
        pad_img, pad_mask = image, mask

    layers = [layer["id"] for layer in doc["layers"]]
    prompt = _notes_text(doc.get("notes"))
    if not prompt:
        # Fallback: notes.list in case ui.inspect omits them
        try:
            prompt = _notes_text(pc.run("notes.list").get("notes"))
        except RuntimeError:
            prompt = ""
    if require_prompt and not prompt.strip():
        raise RuntimeError(
            "没有提示词。请用 Note 工具在画布上写一段文字（Notes 面板）。"
        )

    target = Target(
        doc_name=name,
        index=idx,
        layers=layers,
        x=x,
        y=y,
        w=w,
        h=h,
        pw=pw,
        ph=ph,
        mask=pad_mask.copy(),
    )
    rgb = Image.fromarray((np.clip(pad_img, 0, 1) * 255).round().astype(np.uint8), "RGB")
    mask_im = Image.fromarray(
        (np.clip(pad_mask, 0, 1) * 255).round().astype(np.uint8), "L"
    )
    return GetResult(
        image=rgb,
        mask=mask_im if channel or crop_to_selection else None,
        prompt=prompt.strip(),
        target=target,
        canvas_w=int(doc["width"]),
        canvas_h=int(doc["height"]),
    )


def selection_to_openai_mask(mask_l: Image.Image) -> Image.Image:
    """
    PhotoCraft selection: white = selected (edit).
    OpenAI / image-editor mask: transparent = redraw, opaque = keep.
    """
    arr = np.asarray(mask_l.convert("L")).astype(np.float32) / 255.0
    # selected → alpha 0; unselected → alpha 255
    alpha = ((1.0 - arr) * 255).round().astype(np.uint8)
    rgba = np.zeros((arr.shape[0], arr.shape[1], 4), dtype=np.uint8)
    rgba[..., 0:3] = 255
    rgba[..., 3] = alpha
    return Image.fromarray(rgba, "RGBA")


def _resize_rgba(im: Image.Image, w: int, h: int) -> Image.Image:
    if im.size == (w, h):
        return im
    return im.resize((w, h), Image.Resampling.LANCZOS)


def _destination(
    pc: Photocraft, session: dict[str, Any], target: Target | None, fallback: bool
) -> tuple[int | None, int, int]:
    if target is None:
        return session["active"], 0, 0
    wanted = set(target.layers)
    n = len(session["documents"])
    for i in sorted(range(n), key=lambda i: i != target.index):
        layers = {
            layer["id"]
            for layer in pc.run("document.inspect", {"document": i})["layers"]
        }
        if wanted & layers:
            return i, target.x, target.y
    if fallback:
        print(
            f'[photocraft-bridge] 文档 "{target.doc_name}" 已关闭，改发到当前活动文档'
        )
        return session["active"], 0, 0
    raise RuntimeError(f'PhotoCraft 文档 "{target.doc_name}" 已关闭')


def send_to_photocraft(
    pc: Photocraft,
    result: Image.Image,
    *,
    layer_name: str,
    target: Target | None,
    apply_selection_alpha: bool = True,
    layer_mask: bool = False,
) -> None:
    """Place `result` as a new layer. One undo step in the destination document."""
    result = result.convert("RGBA")
    mask_arr: np.ndarray | None = None
    x = y = 0
    if target is not None:
        # Scale back to Get's padded size, then drop padding to content size
        result = _resize_rgba(result, target.pw, target.ph).crop(
            (0, 0, target.w, target.h)
        )
        x, y = target.x, target.y
        if apply_selection_alpha and target.mask is not None:
            mask_arr = target.mask[: target.h, : target.w]

    arr = np.asarray(result).astype(np.float32) / 255.0
    if arr.shape[-1] == 3:
        alpha = np.ones(arr.shape[:2], np.float32)
        arr = np.dstack([arr, alpha])
    if mask_arr is not None:
        if mask_arr.shape != arr.shape[:2]:
            raise ValueError(
                f"mask {mask_arr.shape} 与结果 {arr.shape[:2]} 尺寸不一致"
            )
        arr[..., 3] *= mask_arr

    out = Image.fromarray((np.clip(arr, 0, 1) * 255).round().astype(np.uint8), "RGBA")
    name = f"pcb_{uuid.uuid4().hex[:12]}_out.png"
    out_path = pc.path(name)
    out.save(out_path)

    try:
        session = pc.call("ui.inspect")["session"]
        dest, ox, oy = _destination(pc, session, target, fallback=True)
        x, y = (ox, oy) if target is not None else (0, 0)
        try:
            if dest is None:
                dest = pc.run(
                    "file.new",
                    {
                        "width": out.width,
                        "height": out.height,
                        "background": "transparent",
                    },
                )["document"]
            pc.call("app.open", {"path": name})
            src = pc.call("ui.inspect")["session"]["active"]
            try:
                layer = pc.run("document.inspect", {"document": src})["layers"][0]["id"]
                if layer_name.strip():
                    pc.run("layer.setProps", {"layer": layer, "name": layer_name})
                if layer_mask and mask_arr is not None:
                    pc.run("layer.layerMask.fromTransparency", {"layer": layer})
                pc.run(
                    "layer.copyToDocument",
                    {
                        "document": dest,
                        "source": src,
                        "layers": [layer],
                        "offset": [x, y],
                    },
                )
            finally:
                pc.run("file.close", {"document": src})
            pc.run("document.activate", {"document": dest})
        finally:
            pc.forget_temp_files()
    finally:
        if os.path.exists(out_path):
            os.remove(out_path)
