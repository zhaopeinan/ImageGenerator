#!/usr/bin/env python3
"""
频谱/锐度分析：判定某图是真原生高分辨率，还是低分辨率放大来的。

核心判据（比谱斜率更稳）：
  1) 高频端能量占比 hf_edge = 功率谱 f>0.7*Nyquist 的能量 / 总能量
     真实原生细节图在接近 Nyquist 处仍有可观能量；
     由插值放大的图，这一段被人为衰减掉，hf_edge 显著更低。
  2) 边缘锐度比 ESR：Sobel 梯度幅值分布的 p99 / 中位数。
     放大图的边缘过渡被核平滑，梯度谱整体低频化。
  3) 局部方差高频能量的各向同性。

之前版本 bug：freq 与 prof 索引错位（prof 长度 nb，freq 用了 r.ravel()[:nb]），
导致 hf 计算恒为 100%。这里改为按半径索引直接查表。
"""
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parents[2]
if not (REPO_ROOT / 'image-editor').is_dir():
    REPO_ROOT = Path(__file__).resolve().parents[3]
import sys

import numpy as np
from PIL import Image


def load_gray(p: Path) -> np.ndarray:
    return np.array(Image.open(p).convert("L"), dtype=np.float64)


def radial_profile(gray: np.ndarray, n: int = 512):
    g = np.array(Image.fromarray(gray.astype(np.uint8)).resize((n, n), Image.LANCZOS),
                 dtype=np.float64)
    g = g - g.mean()
    win = np.outer(np.hanning(n), np.hanning(n))
    F = np.fft.fftshift(np.fft.fft2(g * win))
    P = np.abs(F) ** 2
    cy = cx = n // 2
    yy, xx = np.mgrid[0:n, 0:n]
    r = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
    rbin = r.astype(np.int32)
    nb = rbin.max() + 1
    radial = np.bincount(rbin.ravel(), P.ravel()) / np.maximum(np.bincount(rbin.ravel()), 1)
    # 半径索引 -> 归一化频率（1.0 = Nyquist）
    idx = np.arange(nb)
    freq = idx / (n / 2.0)
    return freq, radial


def hf_metrics(gray: np.ndarray) -> dict:
    freq, radial = radial_profile(gray)
    tot = radial.sum()
    band = lambda lo, hi: float(radial[(freq >= lo) & (freq < hi)].sum() / tot * 100)
    lo_mask = (freq > 0.02) & (freq < 0.5)
    if lo_mask.sum() > 10:
        b = float(np.polyfit(np.log(freq[lo_mask]), np.log(np.maximum(radial[lo_mask], 1e-12)), 1)[0])
    else:
        b = float("nan")

    gx = np.zeros_like(gray)
    gy = np.zeros_like(gray)
    gx[:, 1:-1] = gray[:, 2:] - gray[:, :-2]
    gy[1:-1, :] = gray[2:, :] - gray[:-2, :]
    mag = np.sqrt(gx ** 2 + gy ** 2)
    esr = float(np.percentile(mag, 99) / (np.median(mag) + 1e-9))

    lap = np.zeros_like(gray)
    lap[1:-1, 1:-1] = -4 * gray[1:-1, 1:-1] + gray[:-2, 1:-1] + gray[2:, 1:-1] + \
        gray[1:-1, :-2] + gray[1:-1, 2:]
    return {
        "hf_0.5_0.7": band(0.5, 0.7),
        "hf_0.7_0.85": band(0.7, 0.85),
        "hf_0.85_1.0": band(0.85, 1.01),
        "slope_b": b,
        "esr": esr,
        "lap_p999": float(np.percentile(np.abs(lap), 99.9)),
    }


def main(paths):
    print(f"{'文件':34}{'尺寸':11}{'hf.5-.7%':>10}{'hf.7-.85%':>10}{'hf.85-1%':>10}"
          f"{'斜率b':>8}{'ESR':>8}{'lap_p999':>10}")
    print("-" * 101)
    for p in paths:
        p = Path(p)
        if not p.exists():
            print(f"{p.name:34}(缺失)")
            continue
        im = Image.open(p)
        gray = load_gray(p)
        m = hf_metrics(gray)
        print(f"{p.name[:33]:34}{f'{im.size[0]}x{im.size[1]}':11}"
              f"{m['hf_0.5_0.7']:>10.4f}{m['hf_0.7_0.85']:>10.4f}{m['hf_0.85_1.0']:>10.4f}"
              f"{m['slope_b']:>8.2f}{m['esr']:>8.1f}{m['lap_p999']:>10.1f}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        base = (REPO_ROOT / "rea-tokenlab/compare")
        args = [str(base / "tokenlab/gpt-image-2.png"),
                str(base / "tokenlab/gpt-image-1.5.png"),
                str(base / "woyao/gpt-image-2.png"),
                str(base / "woyao/gpt-image-2.5-flare.png")]
    main(args)
