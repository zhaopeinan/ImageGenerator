#!/usr/bin/env python3
"""
探测 TokenLab 到底认不认 size 参数 / 有哪些分辨率档位。

背景：compare 与 ladder 两轮都传了 size=1024x1024，
      TokenLab 两次都返回 1254x1254 —— 疑似忽略 size 或有自己的固定栅格。
      1254 这个数字很怪，需要摸清。

用 text->image（成本低），逐个 size 试，记录实际返回尺寸。
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

SIZES = [
    None,                 # 不传
    "1024x1024",
    "512x512",
    "1536x1024",
    "1024x1536",
    "2048x2048",
    "4096x4096",
    "1792x1024",
    "auto",
]

PROMPT = "一只机械腕表的精密爆炸视图，纯白背景，工程制图风格，高清细节。"


def ch_id(name):
    for c in json.loads(CH.read_text(encoding="utf-8"))["channels"]:
        if c["name"] == name:
            return c["id"]
    raise SystemExit("no channel")


def probe(cid, model, size):
    payload = {"model": model, "prompt": PROMPT, "n": 1, "response_format": "b64_json"}
    if size:
        payload["size"] = size
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE}/api/images/generations", data=body,
        headers={"Content-Type": "application/json", "X-Channel-Id": cid}, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=420) as r:
            d = json.loads(r.read())
    except urllib.error.HTTPError as e:
        return f"❌ HTTP {e.code} {e.read().decode('utf-8','replace')[:110]}"
    except Exception as e:  # noqa: BLE001
        return f"❌ {e}"
    raw = base64.b64decode(d["data"][0]["b64_json"])
    im = Image.open(io.BytesIO(raw))
    u = d.get("usage", {})
    return (f"✅ 实返 {im.size[0]}x{im.size[1]}  "
            f"{len(raw)/1024/1024:.2f}MB  {round(time.time()-t0,1)}s  "
            f"out={u.get('output_tokens')}")


def main():
    cid = ch_id("TokenLab 主线路")
    print(f"探测渠道 TokenLab 主线路，模型 gpt-image-2.5-sunburst\n")
    print(f"{'传入 size':16}{'结果':64}")
    print("-" * 88)
    for s in SIZES:
        label = s or "(不传)"
        print(f"{label:16}{probe(cid, 'gpt-image-2.5-sunburst', s)}", flush=True)


if __name__ == "__main__":
    main()
