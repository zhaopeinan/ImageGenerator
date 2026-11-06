# ImageGenerator

本地图像生成与编辑工具集，主产品为 macOS 应用「神笔」。

## 目录

| 路径 | 说明 |
|------|------|
| `image-editor/` | 神笔：Vue 3 前端 + Node 代理后端 + Electron 打包 |
| `photocraft-bridge/` | PhotoCraft 与神笔之间的控制通道桥接 |
| `photocraft-plugin/` | PhotoCraft 插件相关模板与交接文档 |
| `rea-tokenlab/` | 渠道能力实测与分析笔记（不含密钥与上游二进制） |

## 快速开始（神笔）

```bash
cd image-editor
npm install
npm start          # http://127.0.0.1:5179
```

渠道数据放在 `image-editor/server/data/channels.json`（含 API Key，已加入 `.gitignore`）。  
可参考同目录的 `channels.example.json` 自行创建。

桌面版：

```bash
cd image-editor
npm run electron:pack   # release/mac-arm64/神笔.app
```

## 隐私

请勿提交：

- `image-editor/server/data/channels.json`（API Key）
- `photocraft-bridge/.exchange/`（控制令牌）
- `.env*`、各类 `*.key` / `*.pem`
- 个人笔记目录（`.workbuddy/`、`.aris/`）
