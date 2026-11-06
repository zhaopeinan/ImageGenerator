#!/usr/bin/env python3
"""
同一提示词在指定渠道的多个子渠道上做对比生成。

用法：
  python run.py --channel woyao
  python run.py --channel "TokenLab 主线路"

对比要公平，所以除 model 外所有参数完全一致：
  size=1024x1024（提示词要求 1:1）、quality=medium、n=1、response_format=b64_json
经本机后端代理转发（Key 不落到脚本里）。

输出目录：compare/<渠道slug>/，同时生成 2×2 或 2×3 对比图。
"""
import argparse
import base64
import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parents[2]
if not (REPO_ROOT / 'image-editor').is_dir():
    REPO_ROOT = Path(__file__).resolve().parents[3]

from PIL import Image, ImageDraw

BASE = "http://127.0.0.1:5179"
CHANNELS_JSON = (REPO_ROOT / "image-editor/server/data/channels.json")
COMPARE_ROOT = (REPO_ROOT / "rea-tokenlab/compare")

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


def slug(name: str) -> str:
    """把渠道名转成安全的目录名（中文保留，仅替换特殊字符）"""
    return re.sub(r"[^\w一-鿿-]+", "-", name).strip("-")


def resolve_channel(name: str) -> tuple[str, str]:
    data = json.loads(CHANNELS_JSON.read_text(encoding="utf-8"))
    for c in data["channels"]:
        if c["name"] == name:
            return c["id"], name
    raise SystemExit(f"找不到渠道：{name}")


def fetch_models(channel_id: str) -> list[str]:
    url = f"{BASE}/api/channels/{channel_id}/models"
    with urllib.request.urlopen(url, timeout=60) as resp:
        payload = json.loads(resp.read())
    return [m["model"] for m in payload.get("models", []) if m.get("available") is True]


def run(channel_id: str, model: str, out: Path) -> dict:
    body = json.dumps(
        {
            "model": model,
            "prompt": PROMPT,
            "n": 1,
            "response_format": "b64_json",
            "size": "1024x1024",
            "quality": "medium",
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        f"{BASE}/api/images/generations",
        data=body,
        headers={"Content-Type": "application/json", "X-Channel-Id": channel_id},
        method="POST",
    )

    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as err:
        text = err.read().decode("utf-8", "replace")
        return {"model": model, "ok": False, "sec": round(time.time() - started, 1),
                "error": f"HTTP {err.code}: {text[:200]}"}
    except Exception as err:  # noqa: BLE001
        return {"model": model, "ok": False, "sec": round(time.time() - started, 1),
                "error": str(err)}

    elapsed = round(time.time() - started, 1)
    data = payload.get("data")
    if not isinstance(data, list) or not data:
        return {"model": model, "ok": False, "sec": elapsed,
                "error": json.dumps(payload, ensure_ascii=False)[:250]}

    raw = base64.b64decode(data[0]["b64_json"])
    path = out / f"{model}.png"
    path.write_bytes(raw)

    image = Image.open(io.BytesIO(raw))
    return {
        "model": model,
        "ok": True,
        "sec": elapsed,
        "bytes": len(raw),
        "size": f"{image.size[0]}x{image.size[1]}",
        "format": image.format,
        "usage": payload.get("usage", {}),
        "path": str(path),
    }


def make_sheet(results: list[dict], out: Path) -> None:
    """把成功的图拼成对比图（2 列）"""
    ok = [r for r in results if r["ok"]]
    if len(ok) < 2:
        return

    cell = 820
    label = 40
    cols = 2
    rows = (len(ok) + cols - 1) // cols
    sheet = Image.new("RGB", (cell * cols, (cell + label) * rows), (250, 250, 250))
    draw = ImageDraw.Draw(sheet)

    for i, r in enumerate(ok):
        with Image.open(r["path"]) as im:
            thumb = im.convert("RGB").resize((cell, cell), Image.LANCZOS)
        x = (i % cols) * cell
        y = (i // cols) * (cell + label)
        sheet.paste(thumb, (x, y + label))
        draw.text((x + 12, y + 13), r["model"], fill=(20, 20, 20))

    sheet.save(out / "comparison.png", "PNG")
    print(f"\n对比图: {out / 'comparison.png'}  {sheet.size}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", required=True, help="渠道名，如 woyao")
    parser.add_argument("--models", nargs="*", help="指定模型；缺省用渠道实际支持的")
    parser.add_argument("--quality", default="medium")
    args = parser.parse_args()

    channel_id, channel_name = resolve_channel(args.channel)
    out = COMPARE_ROOT / slug(channel_name)
    out.mkdir(parents=True, exist_ok=True)

    models = args.models or fetch_models(channel_id)
    print(f"渠道：{channel_name}（{channel_id}）")
    print(f"模型 {len(models)} 个：{models}\n")

    results = []
    for model in models:
        sys.stdout.write(f"{model:26} 生成中…")
        sys.stdout.flush()
        result = run(channel_id, model, out)
        results.append(result)
        if result["ok"]:
            print(f"\r{model:26} ✅ {result['sec']:>6.1f}s  "
                  f"{result['bytes'] / 1024 / 1024:.2f}MB  {result['size']}\n")
        else:
            print(f"\r{model:26} ❌ {result['sec']:>6.1f}s  {result['error'][:130]}\n")
        sys.stdout.flush()

    print("\n=== 汇总 ===")
    ok = [r for r in results if r["ok"]]
    print(f"成功 {len(ok)}/{len(results)}")
    for r in results:
        mark = "✅" if r["ok"] else "❌"
        detail = (f"{r['size']}  {r['bytes'] / 1024 / 1024:.2f}MB  {r['sec']}s"
                  if r["ok"] else r["error"][:110])
        print(f"  {mark} {r['model']:26} {detail}")

    (out / "results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    make_sheet(results, out)


if __name__ == "__main__":
    main()
