#!/usr/bin/env python3
"""
400% 微距：判定 1254² 是原生渲染还是插值放大。

判据：
  · 原生  → 边缘过渡 1~2 像素，斜面连续，斜线无阶梯
  · 放大  → 边缘过渡被拉宽到 3~6 像素，出现可见的过渡带/阶梯

同时做"边缘过渡宽度"定量测量（不靠肉眼）。
"""
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parents[2]
if not (REPO_ROOT / 'image-editor').is_dir():
    REPO_ROOT = Path(__file__).resolve().parents[3]
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = (REPO_ROOT / "rea-tokenlab/compare")


def font(sz, bold=False):
    for p in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else
              "/System/Library/Fonts/PingFang.ttc",
              "/System/Library/Fonts/Supplemental/Arial.ttf"]:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def edge_transition_width(p: Path) -> float:
    """10%→90% 灰度跨度所跨的像素数，取全图最强 300 条边缘的中位数"""
    g = np.array(Image.open(p).convert("L"), dtype=np.float64)
    # 水平方向：对每一行做差分，收集 >=6 像素单调上升的强边缘
    d = np.diff(g, axis=1)
    widths = []
    thr = np.percentile(np.abs(d), 99.5)
    for row in range(0, g.shape[0], 3):
        dr = d[row]
        i = 0
        n = len(dr)
        while i < n - 6:
            if dr[i] > thr:
                j = i
                while j < n - 1 and dr[j] > 0:
                    j += 1
                run = j - i
                if 1 <= run <= 40:
                    total = g[row, j] - g[row, i]
                    if total > 90:            # 只看足够大的黑白对比
                        widths.append(total / (np.abs(dr[i:j]).max() + 1e-9))
                i = j + 8
            else:
                i += 1
            if len(widths) > 4000:
                break
    if not widths:
        return float("nan")
    return float(np.median(widths))


def micro(p: Path, rel, side=380, scale=4):
    im = Image.open(p).convert("RGB")
    w, h = im.size
    box = (int(w * rel[0]), int(h * rel[1]), int(w * rel[2]), int(h * rel[3]))
    c = im.crop(box)
    s = side / max(c.size)
    c = c.resize((int(c.width * scale), int(c.height * scale)), Image.NEAREST)
    s2 = min(side / c.width, side / c.height)
    return c.resize((int(c.width * s2), int(c.height * s2)), Image.NEAREST)


def main():
    files = [
        ("TokenLab gpt-image-2 (1254²)", ROOT / "tokenlab/gpt-image-2.png", (0.34, 0.40, 0.44, 0.50)),
        ("TokenLab 2.5-flare (1254²)", ROOT / "tokenlab/gpt-image-2.5-flare.png", (0.36, 0.34, 0.46, 0.44)),
        ("WoYao gpt-image-2 (1024²)", ROOT / "woyao/gpt-image-2.png", (0.34, 0.40, 0.46, 0.52)),
        ("WoYao 2.5-flare (1024²)", ROOT / "woyao/gpt-image-2.5-flare.png", (0.36, 0.30, 0.48, 0.42)),
    ]
    files = [(n, p, r) for n, p, r in files if p.exists()]

    print(f"{'文件':34}{'原生尺寸':12}{'边缘过渡宽度(px)':>18}{'判定':>12}")
    print("-" * 76)
    for name, p, rel in files:
        w = edge_transition_width(p)
        im = Image.open(p)
        verdict = "原生" if w < 2.6 else ("略糊" if w < 4.0 else "疑似放大")
        print(f"{name:34}{f'{im.size[0]}x{im.size[1]}':12}{w:>18.2f}{verdict:>12}")

    side, pad, lab = 380, 14, 8
    head = 66
    W = pad + len(files) * (side + lab + pad)
    H = head + side + 46
    sheet = Image.new("RGB", (W, H), (250, 250, 252))
    d = ImageDraw.Draw(sheet)
    d.text((pad, 12), "400% 像素微距（最近邻放大，可直接数像素阶梯）", fill=(10, 10, 15), font=font(24, True))
    d.text((pad, 42), "原生图：黑白边界 1~2 px 过渡，斜边连续无阶梯；放大图：过渡带被拉宽成灰阶",
           fill=(100, 100, 110), font=font(14))
    for i, (name, p, rel) in enumerate(files):
        x = pad + i * (side + lab + pad)
        m = micro(p, rel, side=side, scale=4)
        sheet.paste(m, (x, head))
        d.rectangle([x, head, x + side, head + side], outline=(210, 210, 216))
        d.text((x, head + side + 8), name[:26], fill=(30, 30, 40), font=font(14, True))
        d.text((x, head + side + 26), f"边缘过渡 {edge_transition_width(p):.2f} px",
               fill=(110, 110, 120), font=font(13))
    out = ROOT / "micro-400.png"
    sheet.save(out, "PNG")
    print(f"\n→ {out}  {sheet.size}")


if __name__ == "__main__":
    main()
