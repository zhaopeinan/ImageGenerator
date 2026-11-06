"""PhotoCraft desktop control-channel client (JSON lines over 127.0.0.1)."""

from __future__ import annotations

import json
import os
import re
import socket
from typing import Any

from .config import launch_hint, load_config


class Photocraft:
    """One authenticated connection to a running `photocraft --control <port>`."""

    def __init__(self, cfg: dict[str, Any] | None = None):
        self.cfg = cfg or load_config()
        self.dir = self.cfg["bridge_dir"]
        os.makedirs(self.dir, exist_ok=True)
        token_file = self.cfg["token_file"]
        try:
            with open(token_file, encoding="utf-8") as f:
                token = f.read().strip()
        except FileNotFoundError as e:
            raise RuntimeError(
                f"还没有 token 文件：{token_file}\n{launch_hint(self.cfg)}"
            ) from e
        try:
            self.sock = socket.create_connection(
                ("127.0.0.1", int(self.cfg["port"])), timeout=90
            )
        except OSError as e:
            raise RuntimeError(
                f"连不上 PhotoCraft :{self.cfg['port']}（{e}）\n{launch_hint(self.cfg)}"
            ) from e
        self.f = self.sock.makefile("rw", encoding="utf-8", newline="\n")
        self.n = 0
        self.call("auth", {"token": token})

    def call(self, method: str, params: dict[str, Any] | None = None) -> Any:
        self.n += 1
        self.f.write(
            json.dumps({"id": self.n, "method": method, "params": params or {}}) + "\n"
        )
        self.f.flush()
        while True:
            line = self.f.readline()
            if not line:
                raise RuntimeError(
                    f"PhotoCraft 在 {method} 期间断开连接（token 是否正确？）"
                )
            reply = json.loads(line)
            if reply.get("id") == self.n:
                break
        if not reply.get("ok"):
            raise RuntimeError(f"PhotoCraft {method}: {reply.get('error')}")
        return reply.get("result")

    def run(self, command: str, params: dict[str, Any] | None = None) -> Any:
        return self.call("engine.execute", {"command": command, "params": params or {}})

    def save_temp_doc(self, temp: int, name: str, back_to: int) -> None:
        """Export active temp document `temp` as PNG under bridge_dir, then reactivate `back_to`."""
        try:
            self.call("app.save", {"path": name})
        finally:
            self.run("file.close", {"document": temp})
            self.run("document.activate", {"document": back_to})
        if not os.path.exists(self.path(name)):
            raise RuntimeError(
                f"PhotoCraft 保存了 {name}，但文件不在 {self.dir}："
                "bridge_dir 必须与 --automation-write-root 一致"
            )

    def forget_temp_files(self) -> None:
        """Drop bridge temp names from File › Open Recent."""
        try:
            recent = self.run("prefs.get", {"path": "fileHandling.recentFiles"}) or []
            kept = []
            for p in recent:
                base = os.path.basename(str(p))
                if re.fullmatch(r"pcb_[0-9a-f]{12}_(?:image|mask|out)\.png", base):
                    continue
                kept.append(p)
            if kept != recent:
                self.run("prefs.set", {"path": "fileHandling.recentFiles", "value": kept})
        except Exception as e:  # noqa: BLE001 — never hide the caller error
            print(f"[photocraft-bridge] 清理 Open Recent 失败：{e}")

    def path(self, name: str) -> str:
        return os.path.join(self.dir, name)

    def __enter__(self) -> Photocraft:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.sock.close()
