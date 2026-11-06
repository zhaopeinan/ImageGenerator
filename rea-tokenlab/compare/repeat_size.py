#!/usr/bin/env python3
"""同一请求重复 N 次，验证 TokenLab 的 size 是否确定性生效"""
import base64, io, json, time, urllib.request, urllib.error
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parents[2]
if not (REPO_ROOT / 'image-editor').is_dir():
    REPO_ROOT = Path(__file__).resolve().parents[3]
from PIL import Image
BASE="http://127.0.0.1:5179"
CH=(REPO_ROOT / "image-editor/server/data/channels.json")
def cid(n):
    for c in json.loads(CH.read_text(encoding="utf-8"))["channels"]:
        if c["name"]==n: return c["id"]
def go(c,model,size,label):
    body=json.dumps({"model":model,"prompt":"一只机械腕表的精密爆炸视图，纯白背景，工程制图风格。",
                     "n":1,"response_format":"b64_json","size":size}).encode()
    req=urllib.request.Request(f"{BASE}/api/images/generations",data=body,
        headers={"Content-Type":"application/json","X-Channel-Id":c},method="POST")
    t0=time.time()
    try:
        with urllib.request.urlopen(req,timeout=420) as r: d=json.loads(r.read())
    except Exception as e: print(f"❌ {e}"); return
    raw=base64.b64decode(d["data"][0]["b64_json"]); im=Image.open(io.BytesIO(raw))
    u=d.get("usage",{})
    print(f"{label:34}实返 {im.size[0]}x{im.size[1]}  {len(raw)/1024/1024:.2f}MB  "
          f"{round(time.time()-t0,1)}s  out={u.get('output_tokens')}",flush=True)
c=cid("TokenLab 主线路")
print("TokenLab 主线路 · gpt-image-2.5-sunburst · 固定 size=1024x1024 重复 4 次\n")
for i in range(4): go(c,"gpt-image-2.5-sunburst","1024x1024",f"第{i+1}次")
print("\n对照：固定 size=1536x1024（横版）重复 2 次")
for i in range(2): go(c,"gpt-image-2.5-sunburst","1536x1024",f"第{i+1}次")
