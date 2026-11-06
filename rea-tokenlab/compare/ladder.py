#!/usr/bin/env python3
"""
严格同条件阶梯实验：把 TokenLab 定位到 woyao 的 quality 档位上。

设计：
  - 同一个模型名（两侧都有的 gpt-image-2.5-sunburst / gpt-image-2）
  - 同一提示词（与 compare/run.py 完全一致）
  - size=1024x1024（注意：TokenLab 会无视它，输出 1254²，这本身就是发现）
  - woyao: quality = low / medium / high
  - tokenlab: quality 不生效（不透传），跑 medium 只为对齐调用形态

输出目录：compare/ladder/
"""
import base64
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
CHANNELS = (REPO_ROOT / "image-editor/server/data/channels.json")
OUT = (REPO_ROOT / "rea-tokenlab/compare/ladder")

PROMPT = (
    "一张超精细技术信息图海报，以简洁的工程制图风格呈现，背景为干净纯白。"
    "该物体以精准的爆炸视图置于画面中央，每个主要部件都被分离展示，"
    "并用极细的引线标注，指向加粗的全大写技术标签。"
    "一侧加入剖面切割视图，展示内部机械结构。"
    "配以小型嵌入式细节特写图。"
    "字体采用锐利的等宽字体（用于规格参数）与几何风格无衬线字体（用于标题）的混合搭配。"
    "无标题栏、无标语、无页眉条、无页脚文字—只保留信息图本身。"
    "侧边设有规格参数面板，列出尺寸、材料及关键数据。"
    "整张图覆盖淡淡的网格/坐标纸纹理。"
    "仅在关键部件处使用电光琥珀色或青色作为点缀高光。"
    "整体保持纯白背景。画幅比例 1:1。"
    "高度精细，印刷级品质，技术插图美学。文字以中文输出。"
)

JOBS = [
    ("woyao", "woyao", "gpt-image-2.5-sunburst", "low"),
    ("woyao", "woyao", "gpt-image-2.5-sunburst", "medium"),
    ("woyao", "woyao", "gpt-image-2.5-sunburst", "high"),
    ("tokenlab", "TokenLab 主线路", "gpt-image-2.5-sunburst", "medium"),
    ("tokenlab", "TokenLab 主线路", "gpt-image-2", "medium"),
    ("woyao", "woyao", "gpt-image-2", "high"),
]


def resolve(name):
    d = json.loads(CHANNELS.read_text(encoding="utf-8"))
    for c in d["channels"]:
        if c["name"] == name:
            return c["id"]
    raise SystemExit(f"找不到渠道 {name}")


def gen(ch_id, model, quality, out):
    body = json.dumps({
        "model": model, "prompt": PROMPT, "n": 1,
        "response_format": "b64_json", "size": "1024x1024",
        "quality": quality,
    }).encode()
    req = urllib.request.Request(
        f"{BASE}/api/images/generations", data=body,
        headers={"Content-Type": "application/json", "X-Channel-Id": ch_id},
        method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=420) as r:
            payload = json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"ok": False, "sec": round(time.time() - t0, 1),
                "error": f"HTTP {e.code}: {e.read().decode('utf-8','replace')[:180]}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "sec": round(time.time() - t0, 1), "error": str(e)}

    raw = base64.b64decode(payload["data"][0]["b64_json"])
    tag = f"{model}__{quality}"
    p = out / f"{tag}.png"
    p.write_bytes(raw)
    im = Image.open(p)
    u = payload.get("usage", {})
    return {"ok": True, "sec": round(time.time() - t0, 1), "bytes": len(raw),
            "size": f"{im.size[0]}x{im.size[1]}",
            "out_tokens": u.get("output_tokens"),
            "img_tokens": (u.get("output_tokens_details") or {}).get("image_tokens"),
            "path": str(p)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "quality.json").write_text(json.dumps(
        [{"channel": c, "model": m, "quality": q} for c, _, m, q in JOBS],
        ensure_ascii=False, indent=1), encoding="utf-8")

    results = []
    for side, chname, model, q in JOBS:
        tag = f"{side}/{model}/{q}"
        r = gen(resolve(chname), model, q, OUT)
        r.update(side=side, channel=chname, model=model, quality=q)
        results.append(r)
        if r["ok"]:
            print(f"✅ {tag:46}{r['sec']:>6}s  {r['size']:>10}  "
                  f"{r['bytes']/1024/1024:.2f}MB  out={r['out_tokens']}", flush=True)
        else:
            print(f"❌ {tag:46}{r['sec']:>6}s  {r['error'][:120]}", flush=True)

    (OUT / "results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n→ {OUT}")


if __name__ == "__main__":
    main()
