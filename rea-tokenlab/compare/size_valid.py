#!/usr/bin/env python3
"""
按官方文档约束验证 TokenLab 的 size 语义。

官方文档（docs.tokenlab.sh/zh/api-reference/images/create-image）对 gpt-image-2 的 size 约束：
  1. size = auto 或 WIDTHxHEIGHT
  2. WIDTH % 16 == 0 且 HEIGHT % 16 == 0
  3. max(W, H) <= 3840
  4. max(W,H)/min(W,H) <= 3
  5. 655,360 <= W*H <= 8,294,400

关键假设：此前 9 档探测无一命中，很可能是**参数违规**导致被静默忽略，
而不是"size 完全无效"。逐一验证合规/违规尺寸。

对照组：
  - 合规尺寸（16 倍数、像素达标）→ 应当精确命中
  - 违规尺寸（非 16 倍数 / 像素不足 / 像素超限）→ 观察是否静默降级
"""
import base64
import io
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parents[2]
if not (REPO_ROOT / 'image-editor').is_dir():
    REPO_ROOT = Path(__file__).resolve().parents[3]

from PIL import Image

BASE = "http://127.0.0.1:5179"
CH = (REPO_ROOT / "image-editor/server/data/channels.json")
MODEL = "gpt-image-2.5-sunburst"
PROMPT = "一台精密机械发动机的爆炸视图，纯白背景，工程制图风格，高清细节。"

MINPX, MAXPX, MAXEDGE, MAXRATIO = 655360, 8294400, 3840, 3


def cid(name):
    for c in json.loads(CH.read_text(encoding="utf-8"))["channels"]:
        if c["name"] == name:
            return c["id"]
    raise SystemExit("no channel")


def check(w, h):
    """返回 (是否合规, 违规原因列表)"""
    bad = []
    if w % 16 or h % 16:
        bad.append("非16倍数")
    if max(w, h) > MAXEDGE:
        bad.append(f"超最长边{MAXEDGE}")
    r = max(w, h) / min(w, h)
    if r > MAXRATIO:
        bad.append(f"比例{r:.2f}>3")
    px = w * h
    if px < MINPX:
        bad.append(f"像素{px:,}<{MINPX:,}")
    if px > MAXPX:
        bad.append(f"像素{px:,}>{MAXPX:,}")
    return (not bad), bad


def gen(c, size):
    payload = {"model": MODEL, "prompt": PROMPT, "n": 1, "response_format": "b64_json"}
    if size:
        payload["size"] = size
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE}/api/images/generations", data=body,
        headers={"Content-Type": "application/json", "X-Channel-Id": c}, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=420) as r:
            d = json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"ok": False, "err": f"HTTP {e.code} {e.read().decode('utf-8','replace')[:130]}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "err": str(e)[:130]}
    raw = base64.b64decode(d["data"][0]["b64_json"])
    im = Image.open(io.BytesIO(raw))
    w, h = im.size
    return {"ok": True, "w": w, "h": h, "bytes": len(raw), "sec": round(time.time() - t0, 1),
            "out": (d.get("usage") or {}).get("output_tokens")}


# (size, 期望说明)
CASES = [
    ("1024x1024", "合规 · 方形基准"),
    ("1536x1024", "合规 · 3:2 横"),
    ("1024x1536", "合规 · 2:3 竖"),
    ("1920x1080", "违规 · 1080 非16倍数"),
    ("1920x1088", "合规 · 16:9(1088/64*64)"),
    ("1672x944", "合规 · 16:9(944=16*59)"),
    ("1280x720", "违规 · 720非16倍数"),
    ("1280x736", "合规 · 16:9"),
    ("512x512", "违规 · 像素262,144 不足下限"),
    ("2048x2048", "合规 · 2K 方形"),
    ("3840x2160", "合规 · 4K 16:9"),
    ("1536x512", "合规 · 3:1 极限比例"),
    ("1600x512", "违规 · 比例3.125>3"),
]


def main():
    c = cid("TokenLab 主线路")
    print(f"渠道 TokenLab 主线路 · 模型 {MODEL}\n")
    print(f"{'传入 size':13}{'合规?':22}{'实际返回':13}{'朝向':5}{'命中':6}{'MB':>6}{'out':>6}{'s':>6}")
    print("-" * 88)
    rows = []
    for size, note in CASES:
        w, h = (int(x) for x in size.split("x"))
        legal, bad = check(w, h)
        r = gen(c, size)
        note_txt = note if legal else "违规 · " + "、".join(bad)
        if r.get("ok"):
            got = f"{r['w']}x{r['h']}"
            hit = "✅" if got == size else "❌"
            ori = "横" if r['w'] > r['h'] * 1.08 else ("竖" if r['h'] > r['w'] * 1.08 else "方")
            print(f"{size:13}{note_txt:22}{got:13}{ori:5}{hit:6}"
                  f"{r['bytes']/1024/1024:>6.2f}{str(r['out']):>6}{r['sec']:>6}", flush=True)
            rows.append({"size": size, "legal": legal, "note": note_txt, "got": got,
                         "hit": hit == "✅", "bytes": r["bytes"], "out": r["out"],
                         "sec": r["sec"]})
        else:
            print(f"{size:13}{note_txt:22}❌ {r['err'][:45]}", flush=True)
            rows.append({"size": size, "legal": legal, "note": note_txt, "error": r["err"]})

    legal_hit = [r for r in rows if r.get("legal") and r.get("hit")]
    legal_miss = [r for r in rows if r.get("legal") and not r.get("hit")]
    illegal = [r for r in rows if not r.get("legal") and r.get("got")]

    print()
    print("=" * 88)
    print(f"合规尺寸命中：{len(legal_hit)}/{len(legal_hit) + len(legal_miss)}")
    if legal_miss:
        print("  未命中：", ", ".join(f"{r['size']}→{r['got']}" for r in legal_miss))
    print(f"违规尺寸是否被静默接受（不报错）且返回别的尺寸：{len(illegal)}/{len(illegal)}")
    if illegal:
        print("  ", ", ".join(f"{r['size']}→{r['got']}" for r in illegal))

    out = (REPO_ROOT / "rea-tokenlab/compare/size_valid.json")
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n→ {out}")


if __name__ == "__main__":
    main()
