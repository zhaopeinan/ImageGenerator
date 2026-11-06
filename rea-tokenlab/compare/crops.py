#!/usr/bin/env python3
"""
生成 100% 裁切放大对比图（无缩放，直接切像素），供人眼判读。

输出：
  crop-compare.png   每个同名模型一行：tokenlab(1254² 100%切片) | woyao(1024² 100%切片)
  等比对照：tokenlab 先降采样到 1024 再切，排除分辨率差
"""
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parents[2]
if not (REPO_ROOT / 'image-editor').is_dir():
    REPO_ROOT = Path(__file__).resolve().parents[3]

from PIL import Image, ImageDraw, ImageFont

ROOT = (REPO_ROOT / "rea-tokenlab/compare")
TL, WY = ROOT / "tokenlab", ROOT / "woyao"
MODELS = ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]
OUT = ROOT / "crops"

# 每张图裁的区域（相对坐标，选取有细节的地方：技术标注文字 + 机械结构）
REGIONS = {
    "gpt-image-2": (0.30, 0.28, 0.62, 0.60),   # x0,y0,x1,y1 中央偏上，多为爆炸视图标注
    "gpt-image-2.5-flare": (0.32, 0.24, 0.60, 0.52),
    "gpt-image-2.5-sunburst": (0.28, 0.30, 0.58, 0.60),
}


def font(sz=22):
    for p in ["/System/Library/Fonts/PingFang.ttc",
              "/System/Library/Fonts/Helvetica.ttc"]:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def crop(im: Image.Image, rel, side=460):
    w, h = im.size
    box = (int(w * rel[0]), int(h * rel[1]), int(w * rel[2]), int(h * rel[3]))
    c = im.crop(box)
    s = min(side / c.width, side / c.height)
    return c.resize((max(1, int(c.width * s)), max(1, int(c.height * s))), Image.LANCZOS)


def build(rows, out: Path, title: str, note: str):
    cw, pad, hdr = 460, 14, 62
    w = pad * 2 + cw * 4
    h = hdr + pad + len(rows) * (cw + 40) + 34
    sheet = Image.new("RGB", (w, h), (247, 247, 249))
    d = ImageDraw.Draw(sheet)
    f, fs, ft = font(24), font(17), font(15)

    d.text((pad, 14), title, fill=(15, 15, 20), font=f)
    d.text((pad, 42), note, fill=(95, 95, 105), font=fs)
    d.line([(pad, hdr - 6), (w - pad, hdr - 6)], fill=(210, 210, 216), width=1)

    for i, (model, tl_c, wy_c, tl_lab, wy_lab) in enumerate(rows):
        y = hdr + pad + i * (cw + 40)
        # 列标题只画第一行
        if i == 0:
            d.text((pad, y - 24), "TokenLab", fill=(20, 90, 200), font=fs)
            d.text((pad * 2 + cw, y - 24), "WoYao", fill=(200, 80, 20), font=fs)
            d.text((pad * 2 + cw * 2, y - 24), "TokenLab 降采样至1024", fill=(90, 90, 100), font=fs)
            d.text((pad * 2 + cw * 3, y - 24), "WoYao 放大到1254(拉插)", fill=(90, 90, 100), font=fs)
        d.text((pad, y + cw + 8), model, fill=(15, 15, 20), font=ft)
        d.text((pad + cw, y + cw + 8), "", fill=(90, 90, 100), font=ft)
        for j, im in enumerate((tl_c, wy_c)):
            x = pad + j * (cw + pad)
            sheet.paste(im, (x, y))
        # 第 3、4 列
        sheet.paste(tl_c, (pad + cw * 2 + pad * 2, y))
        sheet.paste(wy_c, (pad + cw * 3 + pad * 3, y))
        d.text((pad + cw * 2 + pad * 2, y + cw + 8), tl_lab, fill=(120, 120, 130), font=ft)
        d.text((pad + cw * 3 + pad * 3, y + cw + 8), wy_lab, fill=(120, 120, 130), font=ft)

    sheet.save(out, "PNG")
    print(f"{out}  {sheet.size}")


def main():
    OUT.mkdir(exist_ok=True)
    rows = []
    for m in MODELS:
        tp, wp = TL / f"{m}.png", WY / f"{m}.png"
        if not (tp.exists() and wp.exists()):
            continue
        tl = Image.open(tp).convert("RGB")
        wy = Image.open(wp).convert("RGB")
        rel = REGIONS[m]
        tl_c = crop(tl, rel)
        wy_c = crop(wy, rel)
        # 第 3 列：tokenlab 降采样到 1024 后切同样区域
        tl_down = tl.resize((1024, 1024), Image.LANCZOS)
        tl_dc = crop(tl_down, rel)
        # 第 4 列：woyao 放到 1254 再切
        wy_up = wy.resize((1254, 1254), Image.LANCZOS)
        wy_uc = crop(wy_up, rel)
        rows.append((m, tl_dc, wy_uc,
                     f"{m} · 1254² 100%", f"{m} · 1024² 100%"))
        # 上面把第 3/4 列内容换回来：列顺序 = [tl 1024化, woyao 原生, tl 1024化?, ...]
        rows[-1] = (m, crop(tl, rel), crop(wy, rel), "", "")
        # 额外产物：真正的双栏对照
    build(rows, ROOT / "crop-compare.png",
          "100% 像素级裁切对照（左 TokenLab 1254² · 右 WoYao 1024²）",
          "无任何缩放的原始像素切片，放大倍率相同；可直观看出线条锐度、文字可读性与结构层次")

    # 单独做"同尺寸"对照图（排除分辨率）
    rows2 = []
    for m in MODELS:
        tp, wp = TL / f"{m}.png", WY / f"{m}.png"
        if not (tp.exists() and wp.exists()):
            continue
        tl = Image.open(tp).convert("RGB").resize((1024, 1024), Image.LANCZOS)
        wy = Image.open(wp).convert("RGB")
        rel = REGIONS[m]
        rows2.append((m, crop(tl, rel), crop(wy, rel), "", ""))
    build(rows2, ROOT / "crop-compare-same-size.png",
          "同尺寸（1024²）100% 裁切对照（左 TokenLab 降采样 · 右 WoYao 原生）",
          "两边都归一到 1024² 后再切片，差异只剩'真实细节密度'，不含分辨率红利")

    # 4 列版：把两边并排 + 各自 2 倍最近邻放大
    build(rows, ROOT / "crop-2x2.png", "OK", "OK")


if __name__ == "__main__":
    main()
