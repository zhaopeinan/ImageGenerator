# PhotoCraft Control-Channel 生图桥

通过 PhotoCraft 的 **control channel**（不是官方 `.wasm` 插件）把画布/选区接到本机 [`image-editor`](../image-editor/)：文生图与选区局部编辑，结果以新图层写回。

渠道与 API Key **只存在 image-editor 后端**，本桥只传渠道 ID。

## 前置

1. 已安装 PhotoCraft（本机默认 `/Applications/PhotoCraft.app`）
2. Python 3.10+，建议用项目内 venv：

```bash
cd photocraft-bridge
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

3. `image-editor` 已配置渠道并启动：

```bash
cd ../image-editor && npm start   # http://127.0.0.1:5179
```

## 启动 PhotoCraft

**推荐**：安装快捷方式后，Dock 里点 **PhotoCraft AI**（原版图标）。  
一次拉起 **image-editor（:5179）+ 带 control 的 PhotoCraft**；都已就绪则只前置窗口。

点「文生图 / 局部编辑」时同样会自动确保两端就绪。

终端备用：

```bash
./scripts/ensure-stack.sh
```

交换目录默认项目内 `.exchange/`（已 gitignore）。可选复制 `config.example.json` → `config.json`。

## 用法

在 PhotoCraft 里用 **Note 工具**写提示词；局部编辑时先画选区或进 Quick Mask（`Q`）。

```bash
cd photocraft-bridge
.venv/bin/python -m photocraft_bridge status      # 检查两端连通
.venv/bin/python -m photocraft_bridge generate    # 文生图 → 图层 ImageGen
.venv/bin/python -m photocraft_bridge edit        # 选区局部编辑 → 图层 ImageEdit
```

常用参数：

```bash
.venv/bin/python -m photocraft_bridge generate --prompt "一只猫" --model gpt-image-2
.venv/bin/python -m photocraft_bridge generate --channel <渠道id>
.venv/bin/python -m photocraft_bridge edit --padding 48 --invert-mask
.venv/bin/python -m photocraft_bridge edit --source active_layer --layer-name Fill
```

## 工作流

```
Notes / 选区  →  bridge Get（PNG 经共享目录）
              →  image-editor /api/images/{generations|edits}
              →  bridge Send（新图层 + offset）
```

`edit` 会把选区裁切后送上游；OpenAI mask 语义为「透明 = 重绘」，桥接会自动把选区白转成透明 alpha。

## 一键执行（推荐）

```bash
cd photocraft-bridge
./scripts/install-shortcuts.sh
```

会装好：

| 入口 | 作用 |
|---|---|
| `PhotoCraft AI.app` | **日常启动器**（原版图标；自动拉起后端 + PhotoCraft） |
| `PhotoCraft 文生图.app` | 点一下文生图（缺 control 会自动拉起） |
| `PhotoCraft 局部编辑.app` | 点一下局部编辑 |
| 系统服务 + 快捷键 | `⌘⌥G` 文生图，`⌘⌥E` 局部编辑 |

建议 Dock 只留 **PhotoCraft AI + 文生图 + 局部编辑** 三个。通知与日志：`/tmp/photocraft-bridge-last.log`。

## 限制

- 不是 `Filter › Plug-ins` 菜单项（宿主 ABI v1 滤镜无法联网）
- PhotoCraft 必须以 `--control` 启动；普通双击启动的实例连不上
- 像素走 8-bit PNG；控制通道本身不传大图
- 生成耗时可达数分钟，请耐心等待 CLI 返回

## 安全

- control token 仅本机文件，任何人持有 token 可完全控制该 PhotoCraft 会话
- 不要把 `config.json`、`*.token`、交换目录里的 PNG 提交到 Git
