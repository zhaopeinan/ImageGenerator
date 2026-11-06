#!/usr/bin/env python3
"""Generate a deterministic test fixture for plug-in verification.

64x64 RGBA PNG with four colour quadrants, a horizontal gradient band and an
alpha ramp, so colour, spatial and alpha behaviour are all observable.
"""
import os
import sys

from PIL import Image

SIZE = 64
OUT = sys.argv[1] if len(sys.argv) > 1 else "fixture.png"

im = Image.new("RGBA", (SIZE, SIZE))
px = im.load()
for y in range(SIZE):
    for x in range(SIZE):
        q = (x >= SIZE // 2) + 2 * (y >= SIZE // 2)          # 0..3 quadrant
        base = [(220, 40, 40), (40, 200, 60), (50, 80, 220), (240, 240, 240)][q]
        g = int(255 * x / (SIZE - 1))                         # gradient on green
        a = 255 if y < SIZE // 4 else int(255 * (1 - y / (SIZE - 1)))
        px[x, y] = (base[0], (base[1] + g) // 2, base[2], a)
im.save(OUT)
print(f"fixture: {OUT} {im.size} {im.mode}")
