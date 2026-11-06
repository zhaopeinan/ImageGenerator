#!/usr/bin/env python3
"""
像素级指标对比：TokenLab vs WoYao

指标说明：
  sharp_lap   拉普拉斯方差 —— 整体锐度/高频能量（越高越"锐"，但噪点也会拉高，需结合人看）
  sharp_grad  Sobel 平均梯度模长
  edge_density  Canny 近似：梯度 > 阈值的像素占比 —— 细节结构密度
  hf_ratio    高频能量占比（FFT 半径 > 1/4 Nyquist 的能量占比）
  p99_lap     拉普拉斯绝对值 99 分位 —— 局部最强边缘强度
  entropy     灰度直方图熵 —— 信息量
  colors      去重 RGB 颜色数（降采样后）
  png_kb      文件体积（PNG，同提示词同题材，越大通常细节越密）

注意：分辨率不同（tokenlab 1254²，woyao 1024²），
所有"绝对值"指标都不公平，所以额外做"对齐到同一尺寸"的重采样对照。
"""
import json
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parents[2]
if not (REPO_ROOT / 'image-editor').is_dir():
    REPO_ROOT = Path(__file__).resolve().parents[3]

import numpy as np
from PIL import Image, ImageFilter

ROOT = (REPO_ROOT / "rea-tokenlab/compare")
SIDES = {"tokenlab": ROOT / "tokenlab", "woyao": ROOT / "woyao"}


def laplacian_var(gray: np.ndarray) -> float:
    k = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float64)
    h, w = gray.shape
    out = np.zeros((h - 2, w - 2), dtype=np.float64)
    for i in range(3):
        for j in range(3):
            out += k[i, j] * gray[i:h - 2 + i, j:w - 2 + j]
    return float(out.var())


def sobel_mean(gray: np.ndarray) -> float:
    gx = np.zeros_like(gray)
    gy = np.zeros_like(gray)
    gx[:, 1:-1] = gray[:, 2:] - gray[:, :-2]
    gy[1:-1, :] = gray[2:, :] - gray[:-2, :]
    return float(np.sqrt(gx ** 2 + gy ** 2).mean())


def edge_density(gray: np.ndarray) -> float:
    gx = np.zeros_like(gray)
    gy = np.zeros_like(gray)
    gx[:, 1:-1] = gray[:, 2:] - gray[:, :-2]
    gy[1:-1, :] = gray[2:, :] - gray[:-2, :]
    mag = np.sqrt(gx ** 2 + gy ** 2)
    return float((mag > max(18.0, mag.mean() * 1.6)).mean() * 100)


def hf_ratio(gray: np.ndarray) -> float:
    n = 256
    small = np.array(Image.fromarray(gray.astype(np.uint8)).resize((n, n), Image.LANCZOS), dtype=np.float64)
    win = np.outer(np.hanning(n), np.hanning(n))
    f = np.fft.fftshift(np.fft.fft2(small * win))
    p = np.abs(f) ** 2
    cy, cx = n // 2, n // 2
    y, x = np.ogrid[:n, :n]
    r = np.sqrt((y - cy) ** 2 + (x - cx) ** 2) / (n / 2)
    return float(p[r > 0.35].sum() / p.sum() * 100)


def entropy_bits(gray: np.ndarray) -> float:
    hist, _ = np.histogram(gray, bins=256, range=(0, 256))
    p = hist[hist > 0] / hist.sum()
    return float(-(p * np.log2(p)).sum())


def analyze(path: Path, resize_to: int | None = None) -> dict:
    raw = path.stat().st_size
    im = Image.open(path).convert("RGB")
    orig = im.size
    if resize_to:
        im = im.resize((resize_to, resize_to), Image.LANCZOS)
    gray = np.array(im.convert("L"), dtype=np.float64)
    small = im.resize((512, 512), Image.LANCZOS)
    colors = len(small.getcolors(1 << 20) or [])
    lap = laplacian_var(gray)
    return {
        "size": f"{orig[0]}x{orig[1]}",
        "mp": round(orig[0] * orig[1] / 1e6, 2),
        "png_mb": round(raw / 1024 / 1024, 2),
        "sharp_lap": round(lap, 1),
        "lap_p99": round(float(np.percentile(np.abs(
            np.array(im.convert("L"), dtype=np.float64)), 99)), 1),
        "sobel": round(sobel_mean(gray), 3),
        "edge_pct": round(edge_density(gray), 2),
        "hf_pct": round(hf_ratio(gray), 3),
        "entropy": round(entropy_bits(gray), 3),
        "colors512": colors,
    }


def main() -> None:
    usage = {}
    for side, d in SIDES.items():
        res = json.loads((d / "results.json").read_text(encoding="utf-8"))
        usage[side] = {r["model"]: r for r in res}

    models = ["gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]

    print("=" * 108)
    print("① 原始输出（各渠道自己的原生分辨率）")
    print("=" * 108)
    hdr = f"{'渠道':9}{'模型':22}{'尺寸':11}{'MB':>6}{'lap方差':>10}{'边缘%':>7}{'高频%':>8}{'熵':>7}{'色数':>8}"
    print(hdr)
    print("-" * 108)
    for side, d in SIDES.items():
        for m in models:
            if not (d / f"{m}.png").exists():
                continue
            a = analyze(d / f"{m}.png")
            print(f"{side:9}{m:22}{a['size']:11}{a['png_mb']:>6}{a['sharp_lap']:>10}"
                  f"{a['edge_pct']:>7}{a['hf_pct']:>8}{a['entropy']:>7}{a['colors512']:>8}")

    print()
    print("=" * 108)
    print("② 统一到 1024×1024 后重测（消除分辨率差异，公平对比细节密度）")
    print("=" * 108)
    print(hdr)
    print("-" * 108)
    for side, d in SIDES.items():
        for m in models:
            if not (d / f"{m}.png").exists():
                continue
            a = analyze(d / f"{m}.png", resize_to=1024)
            print(f"{side:9}{m:22}{'1024x1024':11}{a['png_mb']:>6}{a['sharp_lap']:>10}"
                  f"{a['edge_pct']:>7}{a['hf_pct']:>8}{a['entropy']:>7}{a['colors512']:>8}")

    print()
    print("=" * 108)
    print("③ 同名模型：TokenLab / WoYao 比值")
    print("=" * 108)
    print(f"{'模型':22}{'lap比':>9}{'边缘比':>9}{'高频比':>9}{'像素比':>9}{'体积比':>9}{'耗时比':>9}")
    print("-" * 108)
    for m in models:
        tp, wp = SIDES["tokenlab"] / f"{m}.png", SIDES["woyao"] / f"{m}.png"
        if not (tp.exists() and wp.exists()):
            continue
        a, b = analyze(tp, 1024), analyze(wp, 1024)
        rt, rw = usage["tokenlab"][m], usage["woyao"][m]
        px = rt["size"] != rw["size"]
        print(f"{m:22}{a['sharp_lap']/b['sharp_lap']:>9.2f}{a['edge_pct']/b['edge_pct']:>9.2f}"
              f"{a['hf_pct']/b['hf_pct']:>9.2f}{'(原尺寸)' if px else '1.00':>9}"
              f"{rt['bytes']/rw['bytes']:>9.2f}{rt['sec']/rw['sec']:>9.2f}")

    print()
    print("usage / 耗时明细")
    print("-" * 108)
    for m in models:
        for side in SIDES:
            r = usage[side].get(m)
            if not r or not r.get("ok"):
                continue
            u = r.get("usage", {})
            out = u.get("output_tokens", "?")
            img_tok = (u.get("output_tokens_details") or {}).get("image_tokens", "?")
            print(f"{side:9}{m:22}{r['size']:11}{r['sec']:>6}s  output={out:<6} image={img_tok:<6} "
                  f"{r['bytes']/1024/1024:.2f}MB")


if __name__ == "__main__":
    main()
