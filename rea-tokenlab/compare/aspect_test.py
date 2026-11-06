#!/usr/bin/env python3
"""
回答核心问题：TokenLab 渠道能否控制输出比例？

背景事实（已实测）：
  · TokenLab 的 size 参数不可靠：9 档探测无一命中，且横竖会随机翻转
  · 同参数重复请求会返回不同尺寸（1536x1024 / 1222x1287 / 1024x1536 / 1254x1254）
  · 结论必须基于「多次采样的分布」，单次结果不作数

实验组：
  A. 不传 size，仅靠提示词指定比例（3 次/组，看分布是否向目标比例收敛）
  B. 试非标准参数：aspect_ratio / ratio / width+height（看是否被上游识别）
  C. size 与提示词冲突时，听谁的

判据：
  若提示词组内尺寸分布明显偏向目标朝向 ⇒ 提示词有效
  若各组分布几乎一致 ⇒ 提示词完全无效，只能靠事后裁切
"""
import base64
import io
import json
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parents[2]
if not (REPO_ROOT / 'image-editor').is_dir():
    REPO_ROOT = Path(__file__).resolve().parents[3]

from PIL import Image

BASE = "http://127.0.0.1:5179"
CH = (REPO_ROOT / "image-editor/server/data/channels.json")
OUT = (REPO_ROOT / "rea-tokenlab/compare/aspect")
MODEL = "gpt-image-2.5-sunburst"

# 基础提示词，比例句单独变量控制
BASE_PROMPT = "一台精密机械发动机的爆炸视图，纯白背景，工程制图风格，高清细节。"

PROMPT_TEMPLATES = {
    "16:9": BASE_PROMPT + " 画面必须是横向宽屏构图，宽高比 16:9，宽远大于高。",
    "9:16": BASE_PROMPT + " 画面必须是纵向竖屏构图，宽高比 9:16，高远大于宽。",
    "1:1": BASE_PROMPT + " 画面必须是正方形构图，宽高比 1:1。",
}


def cid(name):
    for c in json.loads(CH.read_text(encoding="utf-8"))["channels"]:
        if c["name"] == name:
            return c["id"]
    raise SystemExit(f"找不到渠道 {name}")


def gen(channel_id, prompt, extra=None, timeout=420):
    payload = {"model": MODEL, "prompt": prompt, "n": 1, "response_format": "b64_json"}
    if extra:
        payload.update(extra)
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE}/api/images/generations", data=body,
        headers={"Content-Type": "application/json", "X-Channel-Id": channel_id},
        method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"ok": False, "err": f"HTTP {e.code} {e.read().decode('utf-8','replace')[:150]}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "err": str(e)[:150]}
    raw = base64.b64decode(d["data"][0]["b64_json"])
    im = Image.open(io.BytesIO(raw))
    w, h = im.size
    return {"ok": True, "w": w, "h": h, "bytes": len(raw),
            "sec": round(time.time() - t0, 1),
            "out": (d.get("usage") or {}).get("output_tokens")}


def orientation(w, h):
    if w > h * 1.08:
        return "横"
    if h > w * 1.08:
        return "竖"
    return "方"


def report(label, results):
    ok = [r for r in results if r.get("ok")]
    if not ok:
        print(f"{label:26}全部失败：{results[0].get('err') if results else 'no run'}")
        return
    dist = Counter(f"{r['w']}x{r['h']}" for r in ok)
    ori = Counter(orientation(r["w"], r["h"]) for r in ok)
    avg_mb = sum(r["bytes"] for r in ok) / len(ok) / 1024 / 1024
    avg_s = sum(r["sec"] for r in ok) / len(ok)
    top = "， ".join(f"{k}×{v}" for k, v in dist.most_common())
    print(f"{label:26}朝向 {dict(ori)}  均{avg_mb:.2f}MB {avg_s:.0f}s  {top}")


def save(label, results):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{label}.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    c = cid("TokenLab 主线路")
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3

    print(f"渠道 TokenLab 主线路 · 模型 {MODEL} · 每组 {n} 次 · 不传 size\n")

    # ── A 组：仅靠提示词控制比例 ──────────────────────────────
    print("=== A. 只用提示词指定比例（size 完全不传）===")
    a_all = {}
    for ratio, prompt in PROMPT_TEMPLATES.items():
        rs = []
        for i in range(n):
            r = gen(c, prompt)
            rs.append(r)
            tag = f"提示词{ratio} 第{i+1}次"
            if r.get("ok"):
                print(f"  {tag:20}{r['w']}x{r['h']}  {orientation(r['w'],r['h'])}  "
                      f"{r['bytes']/1024/1024:.2f}MB  out={r['out']}", flush=True)
            else:
                print(f"  {tag:20}❌ {r['err'][:110]}", flush=True)
        a_all[ratio] = rs
        report(f"  小计 提示词{ratio}", rs)
        print()
    save("A_prompt_only", a_all)

    # ── B 组：非标准参数是否被上游识别 ────────────────────────
    print("=== B. 试非标准参数（配 16:9 意图的提示词）===")
    p16 = PROMPT_TEMPLATES["16:9"]
    b_cases = [
        ("baseline 不传任何参数", None),
        ("aspect_ratio=16:9", {"aspect_ratio": "16:9"}),
        ("ratio=16:9", {"ratio": "16:9"}),
        ("width/height 1536x864", {"width": 1536, "height": 864}),
        ("size=1536x1024", {"size": "1536x1024"}),
        ("size=1536x1024 + 提示词16:9", {"size": "1536x1024"}),
    ]
    b_all = {}
    for label, extra in b_cases:
        prompt = p16 if "提示词" in label else BASE_PROMPT
        rs = []
        for i in range(max(2, n - 1)):
            r = gen(c, prompt, extra)
            rs.append(r)
            if r.get("ok"):
                print(f"  {label:28}第{i+1}次 {r['w']}x{r['h']}  "
                      f"{orientation(r['w'],r['h'])}  {r['bytes']/1024/1024:.2f}MB  out={r['out']}", flush=True)
            else:
                print(f"  {label:28}第{i+1}次 ❌ {r['err'][:110]}", flush=True)
        b_all[label] = rs
        report(f"  小计 {label}", rs)
        print()
    save("B_params", b_all)

    print(f"\n产物目录：{OUT}")


if __name__ == "__main__":
    main()
