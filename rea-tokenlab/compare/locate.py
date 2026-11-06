#!/usr/bin/env python3
"""
三方定位图：TokenLab  vs  woyao-low  vs  woyao-medium（全部同一模型 gpt-image-2.5-sunburst）

三张图统一降采样到 1024² 后 100% 像素裁切对照，回答：
"TokenLab 的精细度 ≈ woyao 的哪一档？"
"""
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parents[2]
if not (REPO_ROOT / 'image-editor').is_dir():
    REPO_ROOT = Path(__file__).resolve().parents[3]
from PIL import Image, ImageDraw, ImageFont

R = (REPO_ROOT / "rea-tokenlab/compare")
OUT = R / "ladder-locate.png"

ITEMS = [
    ("TokenLab", R / "ladder/gpt-image-2.5-sunburst__medium.png", (20, 100, 220)),
    ("woyao low", R / "ladder/gpt-image-2.5-sunburst__low.png", (210, 130, 20)),
    ("woyao medium", R / "woyao/gpt-image-2.5-sunburst.png", (120, 120, 130)),
]
REGION = (0.30, 0.30, 0.62, 0.62)


def font(sz, bold=False):
    for p in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else
              "/System/Library/Fonts/PingFang.ttc",
              "/System/Library/Fonts/Supplemental/Arial.ttf"]:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def main():
    items = [(n, p, c) for n, p, c in ITEMS if p.exists()]
    if not items:
        print("缺图")
        return

    box, pad = 430, 14
    head, strip_h = 92, 300
    W = pad * 2 + len(items) * (box + pad)
    H = head + box + 44 + strip_h + 54
    sheet = Image.new("RGB", (W, H), (250, 250, 252))
    d = ImageDraw.Draw(sheet)

    d.text((pad, 12), "同模型 gpt-image-2.5-sunburst · 同提示词 · TokenLab 落在 woyao 哪一档？",
           fill=(10, 10, 15), font=font(25, True))
    d.text((pad, 44), "三张图全部归一到 1024² 再 100% 原像素裁切（下方第二行是无缩放放大条）——差异只剩真实细节密度",
           fill=(100, 100, 110), font=font(14))
    d.text((pad, 64), "usage: TokenLab 2058 tok · woyao low 272 tok · woyao medium 1650 tok",
           fill=(130, 130, 140), font=font(13))

    for i, (name, p, color) in enumerate(items):
        x = pad + i * (box + pad)
        im = Image.open(p).convert("RGB").resize((1024, 1024), Image.LANCZOS)
        # 全图缩览
        s = box / 1024
        sheet.paste(im.resize((box, box), Image.LANCZOS), (x, head))
        d.rectangle([x, head, x + box, head + box], outline=(215, 215, 222))
        # 标签条
        d.rectangle([x, head + box + 4, x + box, head + box + 28], fill=color)
        d.text((x + 8, head + box + 8), name, fill=(255, 255, 255), font=font(15, True))
        # 100% 裁切条
        y2 = head + box + 40
        w0, h0 = im.size
        c = im.crop((int(w0 * REGION[0]), int(h0 * REGION[1]),
                     int(w0 * REGION[2]), int(h0 * REGION[3])))
        z = c.resize((int(c.width * 2.4), int(c.height * 2.4)), Image.NEAREST)
        sc = min(box / z.width, strip_h / z.height)
        z = z.resize((int(z.width * sc), int(z.height * sc)), Image.NEAREST)
        sheet.paste(z, (x, y2))
        d.rectangle([x, y2, x + box, y2 + strip_h], outline=(215, 215, 222))
        d.text((x, y2 + strip_h + 6), "▼ 100% 原像素 ×2.4（最近邻）", fill=(125, 125, 135), font=font(12))

    sheet.save(OUT, "PNG")
    print(f"{OUT}  {sheet.size}")


if __name__ == "__main__":
    main()
