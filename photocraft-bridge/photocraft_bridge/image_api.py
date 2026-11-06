"""HTTP client for local image-editor (Key stays on the server)."""

from __future__ import annotations

import base64
import io
import json
import urllib.error
import urllib.request
from typing import Any

from PIL import Image


class ImageEditorError(RuntimeError):
    pass


def _request(
    base: str,
    path: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout: float = 650,
) -> tuple[int, bytes, str]:
    url = base.rstrip("/") + path
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(), resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            payload = json.loads(raw.decode("utf-8", errors="replace"))
            msg = (
                (payload.get("error") or {}).get("message")
                or payload.get("message")
                or raw.decode("utf-8", errors="replace")
            )
        except Exception:  # noqa: BLE001
            msg = raw.decode("utf-8", errors="replace") or str(e)
        raise ImageEditorError(f"image-editor HTTP {e.code}: {msg}") from e
    except urllib.error.URLError as e:
        raise ImageEditorError(
            f"连不上 image-editor（{base}）：{e.reason}\n"
            "请先在 image-editor 目录执行 npm start"
        ) from e


def health(base: str) -> dict[str, Any]:
    _, raw, _ = _request(base, "/api/health", timeout=10)
    return json.loads(raw.decode("utf-8"))


def list_channels(base: str) -> list[dict[str, Any]]:
    _, raw, _ = _request(base, "/api/channels", timeout=15)
    return list(json.loads(raw.decode("utf-8")).get("channels") or [])


def pick_channel(base: str, channel_id: str | None) -> dict[str, Any]:
    channels = list_channels(base)
    if channel_id:
        for c in channels:
            if c.get("id") == channel_id:
                if not c.get("enabled"):
                    raise ImageEditorError(f"渠道已禁用：{c.get('name') or channel_id}")
                if not c.get("hasKey"):
                    raise ImageEditorError(
                        f"渠道尚未配置 API Key：{c.get('name') or channel_id}"
                    )
                return c
        raise ImageEditorError(f"找不到渠道 id={channel_id}")

    usable = [c for c in channels if c.get("enabled") and c.get("hasKey")]
    if not usable:
        raise ImageEditorError(
            "没有可用渠道（需 enabled 且已填 Key）。请打开 http://127.0.0.1:5179 配置渠道。"
        )
    return usable[0]


def _parse_images(payload: dict[str, Any]) -> list[bytes]:
    """Return PNG/JPEG bytes from OpenAI-style or gateway-style responses."""
    out: list[bytes] = []
    data = payload.get("data")
    if isinstance(data, list):
        for item in data:
            if not isinstance(item, dict):
                continue
            b64 = item.get("b64_json")
            if b64:
                out.append(base64.b64decode(b64))
                continue
            url = item.get("url")
            if isinstance(url, str) and url.startswith("data:"):
                # data:image/png;base64,...
                try:
                    out.append(base64.b64decode(url.split(",", 1)[1]))
                except Exception:  # noqa: BLE001
                    pass
    output = payload.get("output")
    if isinstance(output, list) and not out:
        for item in output:
            if not isinstance(item, dict):
                continue
            raw = item.get("result") or item.get("b64_json") or item.get("image_url")
            if not raw:
                continue
            if isinstance(raw, str) and raw.startswith("http"):
                with urllib.request.urlopen(raw, timeout=120) as resp:
                    out.append(resp.read())
            elif isinstance(raw, str) and raw.startswith("data:"):
                out.append(base64.b64decode(raw.split(",", 1)[1]))
            else:
                out.append(base64.b64decode(raw))
    if not out:
        raise ImageEditorError("响应中不含图片")
    return out


def generate(
    base: str,
    channel_id: str,
    *,
    prompt: str,
    model: str,
    size: str | None,
    quality: str,
    size_via_prompt: bool = False,
) -> Image.Image:
    body: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "response_format": "b64_json",
        "quality": quality,
    }
    if size and not size_via_prompt:
        body["size"] = size
    raw_body = json.dumps(body).encode("utf-8")
    _, raw, _ = _request(
        base,
        "/api/images/generations",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Channel-Id": channel_id,
        },
        body=raw_body,
    )
    payload = json.loads(raw.decode("utf-8"))
    png = _parse_images(payload)[0]
    return Image.open(io.BytesIO(png)).convert("RGBA")


def _multipart(fields: list[tuple[str, Any]]) -> tuple[bytes, str]:
    """Build multipart/form-data. File fields are (name, (filename, bytes, content_type))."""
    boundary = "----PhotoCraftBridge7MA4YWxkTrZu0gW"
    chunks: list[bytes] = []
    for name, value in fields:
        chunks.append(f"--{boundary}\r\n".encode())
        if isinstance(value, tuple):
            filename, data, ctype = value
            chunks.append(
                (
                    f'Content-Disposition: form-data; name="{name}"; '
                    f'filename="{filename}"\r\n'
                    f"Content-Type: {ctype}\r\n\r\n"
                ).encode()
            )
            chunks.append(data)
            chunks.append(b"\r\n")
        else:
            chunks.append(
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
            )
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def edit(
    base: str,
    channel_id: str,
    *,
    prompt: str,
    model: str,
    image: Image.Image,
    mask: Image.Image | None,
    size: str | None,
    quality: str,
    size_via_prompt: bool = False,
) -> Image.Image:
    img_buf = io.BytesIO()
    image.convert("RGBA").save(img_buf, format="PNG")
    fields: list[tuple[str, Any]] = [
        ("model", model),
        ("prompt", prompt),
        ("n", "1"),
        ("response_format", "b64_json"),
        ("quality", quality),
        ("image", ("image.png", img_buf.getvalue(), "image/png")),
    ]
    if size and not size_via_prompt:
        fields.append(("size", size))
    if mask is not None:
        # OpenAI edits: transparent = redraw. Selection luminance → alpha inverted
        # (opaque keep / transparent edit) is prepared by caller.
        mask_buf = io.BytesIO()
        mask.convert("RGBA").save(mask_buf, format="PNG")
        fields.append(("mask", ("mask.png", mask_buf.getvalue(), "image/png")))

    body, content_type = _multipart(fields)
    _, raw, _ = _request(
        base,
        "/api/images/edits",
        method="POST",
        headers={
            "Content-Type": content_type,
            "X-Channel-Id": channel_id,
        },
        body=body,
    )
    payload = json.loads(raw.decode("utf-8"))
    png = _parse_images(payload)[0]
    return Image.open(io.BytesIO(png)).convert("RGBA")
