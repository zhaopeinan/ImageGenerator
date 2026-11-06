#!/usr/bin/env python3
"""
干净的并排对比图：
  第1列 TokenLab 原生 1254²
  第2列 TokenLab 降采样到 1024²   ← 与 woyao 同尺寸，排除分辨率红利
  第3列 WoYao 原生 1024²
每张图再附一条 100% 原像素放大条（2 倍最近邻，能看清像素级锐度）。

用法：python crops2.py
"""
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parents[2]
if not (REPO_ROOT / 'image-editor').is_dir():
    REPO_ROOT = Path(__file__).resolve().parents[3]

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = (REPO_ROOT / "rea-tokenlab/compare")
TL, WY, LAD = ROOT / "tokenlab", ROOT / "woyao", ROOT / "ladder"

PAIRS = [
    ("gpt-image-2", (0.30, 0.30, 0.62, 0.62)),
    ("gpt-image-2.5-flare", (0.32, 0.26, 0.60, 0.54)),
    ("gpt-image-2.5-sunburst", (0.28, 0.32, 0.60, 0.66)),
]


def font(sz, bold=False):
    cands = ["/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else
             "/System/Library/Fonts/PingFang.ttc",
             "/System/Library/Fonts/Supplemental/Arial.ttf",
             "/System/Library/Fonts/Helvetica.ttc"]
    for p in cands:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            continue
    return ImageFont.load_default()


def crop_rel(im: Image.Image, rel) -> Image.Image:
    w, h = im.size
    return im.crop((int(w * rel[0]), int(h * rel[1]), int(w * rel[2]), int(h * rel[3])))


def fit(im, box):
    bw, bh = box
    w, h = im.size
    s = min(bw / w, bh / h)
    return im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)


def stack_labeled(images, labels, box, colors, title=None):
    """把若干张图竖排 + 左侧彩色标签条"""
    tiles = [fit(im, box) for im in images]
    th = max(t.height for t in tiles)
    gap = 6
    h = len(tiles) * (th + gap) - gap
    lab_w = 96
    canvas = Image.new("RGB", (box + lab_w, h), (252, 252, 253))
    d = ImageDraw.Draw(canvas)
    f = font(15, True)
    for i, (t, lb, c) in enumerate(zip(tiles, labels, colors)):
        y = i * (th + gap)
        d.rectangle([0, y, lab_w - 2, y + th], fill=c)
        # 竖排标签用短词，换行绘制
        d.text((10, y + th / 2 - 8), lb, fill=(255, 255, 255), font=f)
        canvas.paste(t, (lab_w, y + (th - t.height) // 2))
    return canvas


def main():
    rows = []
    for model, rel in PAIRS:
        tp, wp = TL / f"{model}.png", WY / f"{model}.png"
        if not (tp.exists() and wp.exists()):
            continue
        tl = Image.open(tp).convert("RGB")
        wy = Image.open(wp).convert("RGB")
        tl1024 = tl.resize((1024, 1024), Image.LANCZOS)
        rows.append((model, rel, tl, tl1024, wy))

    if not rows:
        print("没有可对比的图")
        return

    box = 430
    pad = 12
    head = 78
    row_h = box + 30 + box // 2 + 60   # 主图 + 放大条
    W = pad + 3 * (box + pad)
    H = head + len(rows) * row_h

    sheet = Image.new("RGB", (W, H), (248, 248, 250))
    d = ImageDraw.Draw(sheet)
    d.text((pad, 12), "TokenLab vs WoYao 精细度对照（同一提示词 · 同一模型名）", fill=(10, 10, 15), font=font(26, True))
    d.text((pad, 46), "中列为 TokenLab 降采样至 1024²（与右列同尺寸，差异只剩真实细节密度）；底部为 100% 原像素放大",
           fill=(100, 100, 110), font=font(15))
    d.text((pad + box + pad, 66), "TokenLab 1254²", fill=(20, 90, 200), font=font(17, True))
    d.text((pad + 2 * (box + pad), 66), "TokenLab →1024²", fill=(90, 90, 200), font=font(17, True))
    d.text((pad + 2 * (box + pad), 46), "", fill=(0, 0, 0), font=font(15))
    d.text((pad + 2 * (box + pad), 66), "", fill=(0, 0, 0), font=font(15))
    d.text((pad + 2 * (box + pad) + box // 2 + 40, 66), "WoYao 1024²", fill=(200, 80, 20), font=font(17, True))

    for ri, (model, rel, tl, tl1024, wy) in enumerate(rows):
        y = head + ri * row_h
        d.text((pad, y - 22), model, fill=(10, 10, 15), font=font(18, True))
        imgs = [tl, tl1024, wy]
        for ci, im in enumerate(imgs):
            x = pad + ci * (box + pad)
            t = fit(im, (box, box))
            sheet.paste(t, (x, y))
        # 100% 放大条：裁同一区域，最近邻 2x
        zy = y + box + 26
        d.text((pad, zy - 18), "▼ 100% 原像素 ×2（最近邻）", fill=(120, 120, 130), font=font(13))
        for ci, im in enumerate(imgs):
            x = pad + ci * (box + pad)
            c = crop_rel(im, rel)
            c2 = c.resize((c.width * 2, c.height * 2), Image.NEAREST)
            z = fit(c2, (box, box // 2))
            sheet.paste(z, (x, zy))
        d.line([(pad, y + row_h - 30), (W - pad, y + row_h - 30)], fill=(222, 222, 228), width=1)

    out = ROOT / "detail-compare.png"
    sheet.save(out, "PNG")
    print(f"{out}  {sheet.size}")


if __name__ == "__main__":
    main()
