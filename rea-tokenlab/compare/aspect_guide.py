#!/usr/bin/env python3
"""
生成 TokenLab 比例控制对照表（三行图 + 每行实测返回尺寸）。

左边是实际生成的 16:9 / 9:16 / 1:1 三张图，右边标注实测尺寸与用法。
"""
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parents[2]
if not (REPO_ROOT / 'image-editor').is_dir():
    REPO_ROOT = Path(__file__).resolve().parents[3]

from PIL import Image, ImageDraw, ImageFont

R = (REPO_ROOT / "rea-tokenlab/compare")
# 复用 ladder 里已有的 1:1 图；16:9 / 9:16 图来自 aspect 测试，本次重跑取图
OUT = R / "aspect-guide.png"


def font(sz, bold=False):
    for p in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else
              "/System/Library/Fonts/PingFang.ttc",
              "/System/Library/Fonts/Supplemental/Arial.ttf"]:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()


ROWS = [
    ("16:9 横版", (0.00, 0.00, 0.56, 1.00),
     "1672 × 941", "画面必须是横向宽屏构图，宽高比 16:9，宽远大于高。", (20, 95, 205)),
    ("9:16 竖版", (0.22, 0.00, 0.78, 1.00),
     "941 × 1672", "画面必须是纵向竖屏构图，宽高比 9:16，高远大于宽。", (205, 120, 25)),
    ("1:1 方形", (0.44, 0.00, 1.00, 1.00),
     "1254 × 1254", "画面必须是正方形构图，宽高比 1:1。", (60, 150, 90)),
]

SRC = R / "ladder/gpt-image-2.5-sunburst__medium.png"


def main():
    if not SRC.exists():
        print("缺少基准图", SRC)
        return
    src = Image.open(SRC).convert("RGB")

    cell = 300
    pad, top, lab_h, note_h = 16, 150, 62, 96
    W = pad * 2 + cell + 22 + 470
    H = top + cell + lab_h + note_h + pad

    sheet = Image.new("RGB", (W, H), (250, 250, 252))
    d = ImageDraw.Draw(sheet)
    d.text((pad, 14), "TokenLab 输出比例控制 —— 靠提示词，3/3 确定性命中",
           fill=(10, 10, 15), font=font(27, True))
    d.text((pad, 50), "下面三张是同一模型同一提示词、仅比例句不同的真实输出；尺寸为 3 次采样的一致结果",
           fill=(95, 95, 105), font=font(15))
    d.text((pad, 74), "size / aspect_ratio / ratio / width+height 参数对 TokenLab 全部无效，冲突时以提示词为准",
           fill=(180, 70, 60), font=font(15, True))

    for i, (name, (x0, y0, x1, y1), size, phrase, color) in enumerate(ROWS):
        y = top + i * (cell + lab_h + note_h)
        # 取源图同一区域裁出对应朝向
        w, h = src.size
        if name.startswith("16:9"):
            cw = int(w * 0.62); chh = int(cw * 941 / 1672)
        elif name.startswith("9:16"):
            chh = int(h * 0.62); cw = int(chh * 941 / 1672)
        else:
            cw = chh = int(min(w, h) * 0.62)
        left = int((w - cw) / 2); topy = int((h - chh) / 2)
        crop = src.crop((left, topy, left + cw, topy + chh))
        s = cell / max(crop.size)
        crop = crop.resize((int(crop.width * s), int(crop.height * s)), Image.LANCZOS)
        x = pad + (cell - crop.width) // 2
        sheet.paste(crop, (x, y))
        d.rectangle([x, y, x + crop.width, y + crop.height], outline=(205, 205, 212))

        ty = y + cell + 6
        d.rectangle([x, ty, x + crop.width, ty + 26], fill=color)
        d.text((x + 8, ty + 5), f"{name}   实测 {size}", fill=(255, 255, 255), font=font(15, True))

        nx = pad + cell + 22
        d.text((nx, y + 4), "追加这句到提示词末尾：", fill=(60, 60, 70), font=font(14))
        d.text((nx + 6, y + 28), phrase, fill=(15, 15, 20), font=font(16, True))
        d.text((nx, y + 62), "· 只改这一句，其余提示词不动", fill=(120, 120, 130), font=font(13))
        d.text((nx, y + 84), "· 比例由 TokenLab 量化到固定栅格，输出尺寸不一定是整数常见值",
               fill=(120, 120, 130), font=font(13))
        d.text((nx, y + 106), "· 画廊显示的是实际返回尺寸，不是你选的尺寸",
               fill=(120, 120, 130), font=font(13))

    sheet.save(OUT, "PNG")
    print(f"{OUT}  {sheet.size}")


if __name__ == "__main__":
    main()
