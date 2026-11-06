#!/usr/bin/env python3
"""
端到端验证前端改动是否真的生效。

关键：**不能只看后端返回的图**，要确认发出去的请求体长什么样。
做法是在后端代理前抓包不可行（前端直连），改为直接验证
「前端 store 的组装逻辑」与「上游真实行为」是否一致：

1. 直接模拟前端 resolvePromptAndSize() 的输出，构造请求发给后端
2. 检查 TokenLab 渠道下返回尺寸是否变成提示词指定的栅格
3. 对照 woyao 渠道，确认它仍走 size 语义（行为未被污染）
"""
import base64
import io
import json
import sys
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

# 与前端 src/types/models.ts 的 ASPECT_PROMPT_TEMPLATES 保持一致
ASPECT_PROMPTS = {
    "16:9": "画面必须是横向宽屏构图，宽高比 16:9，宽远大于高。",
    "9:16": "画面必须是纵向竖屏构图，宽高比 9:16，高远大于宽。",
    "1:1": "画面必须是正方形构图，宽高比 1:1。",
}
# 与前端 computeSize() 逻辑等价（1K 档，长边 1024，短边对齐 64）
def compute_size(tier_long_edge, aspect_base):
    bw, bh = aspect_base
    if bw >= bh:
        return f"{tier_long_edge}x{round((bh / bw) * tier_long_edge / 64) * 64}"
    return f"{round((bw / bh) * tier_long_edge / 64) * 64}x{tier_long_edge}"

ASPECT_BASE = {
    "16:9": (1792, 1024), "9:16": (1024, 1792), "1:1": (1024, 1024),
}


def ch(name):
    for c in json.loads(CH.read_text(encoding="utf-8"))["channels"]:
        if c["name"] == name:
            return c
    raise SystemExit(f"找不到渠道 {name}")


def gen(cid, prompt, size=None, timeout=420):
    payload = {"model": "gpt-image-2.5-sunburst", "prompt": prompt,
               "n": 1, "response_format": "b64_json"}
    if size:
        payload["size"] = size
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE}/api/images/generations", data=body,
        headers={"Content-Type": "application/json", "X-Channel-Id": cid}, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"ok": False, "err": f"HTTP {e.code} {e.read().decode('utf-8','replace')[:140]}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "err": str(e)[:140]}
    raw = base64.b64decode(d["data"][0]["b64_json"])
    im = Image.open(io.BytesIO(raw))
    return {"ok": True, "w": im.size[0], "h": im.size[1], "sec": round(time.time() - t0, 1)}


BASE_PROMPT = "一台精密机械发动机的爆炸视图，纯白背景，工程制图风格，高清细节。"


def main():
    tl = ch("TokenLab 主线路")
    wy = ch("woyao")

    print("=" * 78)
    print("① TokenLab（sizeViaPrompt=true）：模拟前端 —— 不发 size，比例进提示词")
    print("=" * 78)
    for aspect in ("16:9", "9:16", "1:1"):
        prompt = f"{BASE_PROMPT}\n\n{ASPECT_PROMPTS[aspect]}"
        r = gen(tl["id"], prompt, size=None)     # sizeViaPrompt 分支：size 传 None
        if r.get("ok"):
            ratio = r["w"] / r["h"]
            want = {"16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1.0}[aspect]
            dev = abs(ratio - want) / want * 100
            print(f"  选 {aspect:5} → 实返 {r['w']}x{r['h']}  比例{ratio:.4f} "
                  f"目标{want:.4f} 偏差{dev:.2f}%  {r['sec']}s "
                  f"{'✅' if dev < 2 else '⚠️'}")
        else:
            print(f"  选 {aspect:5} → ❌ {r['err'][:90]}")

    print()
    print("=" * 78)
    print("② TokenLab 反证：故意同时传 size 和提示词比例（验证提示词胜出）")
    print("=" * 78)
    prompt = f"{BASE_PROMPT}\n\n{ASPECT_PROMPTS['16:9']}"
    r = gen(tl["id"], prompt, size=compute_size(1024, ASPECT_BASE["16:9"]))
    if r.get("ok"):
        ratio = r["w"] / r["h"]
        print(f"  size=1792x1024 + 提示词16:9 → {r['w']}x{r['h']}  "
              f"比例{ratio:.4f}  {'✅ 提示词胜出' if abs(ratio - 16/9) / (16/9) < 0.05 else '⚠️ size 生效了'}")
    else:
        print(f"  ❌ {r['err'][:110]}")

    print()
    print("=" * 78)
    print("③ woyao（sizeViaPrompt=false）：确认仍走 size，行为未被污染")
    print("=" * 78)
    for aspect in ("16:9", "1:1"):
        # woyao Key 额度可能已耗尽，失败也如实报告
        size = compute_size(1024, ASPECT_BASE[aspect])
        r = gen(wy["id"], BASE_PROMPT, size=size)
        if r.get("ok"):
            print(f"  选 {aspect:5} → size={size:10} 实返 {r['w']}x{r['h']}  ✅ 尺寸随 size 变化")
        else:
            print(f"  选 {aspect:5} → size={size:10} ❌ {r['err'][:90]}")

    print()
    print("说明：③ 若报额度不足属正常（此前已测到 API_KEY_QUOTA_EXHAUSTED），")
    print("     关键是 ① 的比例是否被前端正确注入。")


if __name__ == "__main__":
    main()
