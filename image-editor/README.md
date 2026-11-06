# 神笔

基于 OpenAI 兼容 `images/generations` 与 `images/edits` 接口的图像生成工具。前端 Vue 3，后端 Node 原生 http；也可打包为 macOS 应用「神笔」。

**API Key 只存在后端，永不下发到浏览器。**

## 快速开始

```bash
npm install
npm start          # 构建 + 启动，访问 http://127.0.0.1:5179
```

### macOS 应用（Electron）

```bash
npm run electron:dev    # 本地直接打开「神笔」窗口
npm run electron:pack   # 产出 release/mac-arm64/神笔.app
npm run electron:dist   # 额外打出 .dmg
```

桌面版数据默认在 `~/Library/Application Support/神笔/`（渠道在其中的 `data/`，画廊在浏览器存储分区）。  
右上角 **设置** 可改数据目录；换电脑时拷走整个目录，在新机器上选中即可还原。  
目录指针保存在 `~/Library/Application Support/ShenbiConfig/bootstrap.json`。

开发模式（前后端分离，前端热更新）：

```bash
npm run dev:api    # 终端 1：后端 :5179
npm run dev        # 终端 2：前端 :5178（vite 会代理不到后端，需设 VITE_API_BASE）
```

打开页面 → 右上角「渠道管理」→ 新建渠道（填名称、端点、API Key）→ 可先点「测试」验证连通 → 选「文生图」写描述，或切「图生图」上传图片。

## 功能

- **双模式**：文生图（`images/generations`）与图生图（`images/edits`），顶部 Tab 切换
- **模型（子渠道）**：**由渠道决定**。切换渠道时读取该渠道的 `/v1/models`
  声明，下拉只列该渠道实际提供的模型，切换后若当前模型不在新渠道列表会自动回退。
  各渠道实测不同，例如：
  - woyao：gpt-image-2、**gpt-image-2-x**（Azure 专属）、2.5-flare、2.5-sunburst，
    以及 gemini-3-pro-image / gemini-3.1-flash-image
  - TokenLab：gpt-image-1、1.5、2、2.5、2.5-flare、2.5-sunburst（**没有 2-x**）
  - `gpt-image-2.5` 官方标注「仅支持文生图」，图生图模式下会自动排除
  - 想确认某模型能否真正出图，用「渠道管理 → 测试」手动触发
- **画面比例**：1:1 / 3:2 / 16:9 / 9:16 / 2:3，与分辨率组合出实际 size。
  ⚠️ **比例必须由 size 参数控制，提示词里写「16:9」无效**（实测）
- **分辨率**：自动 / 1K / 2K / 4K，与比例组合决定长边像素
- **费用估算**：随模型、分辨率、张数实时显示预计花费
- **多图参考**：图生图最多 16 张输入图（OpenAI 官方上限）。第 1 张为主图，
  「附加参考图」可一次多选，缩略图带序号 —— 提示词里用「第1张」「第2张」指代
- **遮罩（局部重绘）**：显式三步 —— 「+ 增加遮罩」→ 全屏精绘 → 「确认应用」。
  - 全屏视图笔刷 8–400px 可调，支持 `[` `]` 快捷键微调
  - 拖动滑杆时**实时显示**笔刷直径（大字读数 + 圆形预览，预览用对数映射，
    保证 8–40px 精细区间也有可见变化）
  - 鼠标在图上时**以笔刷尺寸圈替代十字光标**，圈的直径 = 实际涂抹范围，
    改笔刷时圈实时跟着变，不必靠「试涂再撤销」校准
  - 实时显示已涂抹面积百分比，确认后才生效（取消则丢弃）
  - 三种显示模式循环切换：压暗选区外 / 全图明亮 / 纯遮罩叠加
  - 确认后在缩略图查看效果，点缩略图可随时再放大编辑
  - 也可切到「上传文件」用现成 mask
  - 遮罩**作用于第 1 张图**（官方行为）
- **源图上传**：点击 / 拖拽 / 粘贴三种方式，支持 PNG、JPEG、WebP
- **参数**：质量（低/中/高）、输出格式（PNG/JPEG/WebP）、生成张数（1–4）
- **画廊**：结果持久化展示，按「生成 / 编辑」筛选；点击提示词可展开完整详情
  （完整提示词 + 复制 + 模型/尺寸/质量/格式/时间），支持复制图片、下载、删除、清空，上限 18 张
- **多渠道**：可配置多条线路，网络失败时提示切换（不自动重试，避免重复计费）

## 架构

```
浏览器                    本机后端 :5179                 上游渠道
  │                            │                            │
  │  GET /api/channels         │                            │
  │ ────────────────────────►  │  读 server/data/            │
  │ ◄──── 渠道列表（无明文 Key）│    channels.json            │
  │                            │                            │
  │  POST /api/channels        │                            │
  │ ────────────────────────►  │  Key 写入磁盘               │
  │                            │                            │
  │  POST /api/images/edits    │                            │
  │  X-Channel-Id: <id>        │                            │
  │ ────────────────────────►  │ ──注入 Key，流式转发──────► │
  │ ◄──── 图片响应（透传）      │ ◄───────────────────────── │
```

前端只传渠道 ID，Key 由后端在转发时注入。

## 后端设计要点

### Key 不下发

`GET /api/channels` 返回的每条记录都不含 `apiKey` 字段，只有：

```json
{ "hasKey": true, "keyPreview": "sk-sup…3456" }
```

编辑渠道时 Key 留空表示不修改，避免前端把脱敏值写回去。

### 流式转发

`req.pipe(upstreamReq)` 直接把 multipart 体接到上游，不读进内存。图片动辄数 MB，读进内存再转发会白白吃一份内存并拖慢首字节。

### 原子写入

渠道数据用「写临时文件 + rename」落盘，进程在写入途中被杀不会损坏文件。文件解析失败时会先备份为 `.corrupt-<时间戳>` 再重置，不会静默丢失。

### 连通性测试

`POST /api/channels/:id/test` 发一个 1×1 像素的最小请求，返回耗时与上游错误摘要（如 `HTTP 401：Incorrect API key`）。错误信息从上游 JSON 里提取 `error.message`，不回显密钥。

### 监听范围

默认只监听 `127.0.0.1`，局域网内其他机器访问不到，这是本机工具最安全的默认值。

需要从其他机器访问时：

```bash
HOST=0.0.0.0 ACCESS_TOKEN=你的令牌 npm start
```

**不设 `ACCESS_TOKEN` 就放开到 `0.0.0.0` 会让任何能访问该端口的人读取你的 API Key**，启动日志会打这条警告。

## 前端技术要点

### 批量不是 n=N

「生成张数 N」实现为**并发发起 N 次独立请求，每次 `n=1`**，而非单请求 `n=N`。每张图独立成请求，便于计费、限流与失败隔离。任一失败则整体报错。

### 双层存储

| 层 | 存什么 |
|---|---|
| localStorage | 草稿元数据、画廊索引、世代号（**绝不放图片**） |
| IndexedDB (`image-editor-v2` / store `kv-v2`) | 图片 blob、上传的源图与蒙版 File |

图片以 Blob 形式存 IndexedDB，索引里 `src` 恒为空字符串。localStorage 有 5MB 限制，一张 1024×1024 PNG 的 base64 约 1.4MB，几张就爆。

### 世代号（clear-epoch）机制

清空数据时**不逐条删除 blob**，而是写入新世代号（如 `clear-1792209506946-npsiavfuhb`）让旧记录立即失效：

- 清空是 **O(1)**，几百张还是上千张一样快
- 在途写入不会把旧数据写回来——每次 IndexedDB 写入都在事务内先校验世代号，不匹配则放弃
- 跨标签页同步：监听 `storage` 事件，其他标签清空后本标签自动跟随

### 写入串行化

三条 Promise 队列分别串行化 source 上传、mask 上传、画廊变更。所有异步操作在每个 `await` 之后重新校验 `(epoch, revision)`，防止 await 期间被其他标签页操作打断导致数据错乱。

### 响应兼容

```jsonc
{ "data":    [{ "b64_json": "..." }] }   // OpenAI 标准
{ "output": [{ "result": "..." }] }      // 另一种网关形态
```

## 数据位置

| 内容 | 位置 |
|---|---|
| 渠道与 API Key | `server/data/channels.json`（**明文，注意备份与同步工具排除**） |
| 图片与草稿 | 浏览器 IndexedDB / localStorage |
| 画廊上限 | 18 张 |

「清空本地数据」只清浏览器侧，渠道与 Key 保留在后端。

## 已知限制

- 无用户体系与配额控制，单机单用户设计；多人场景需要自建鉴权或改用 sub2api
- 未在真实 OpenAI 端点验证过，仅用 mock 服务验证了完整链路
- 依赖浏览器支持 `ClipboardItem`（Chrome/Edge 支持）

## 目录结构

```
server/
├── index.js            # HTTP 服务：路由、代理、静态托管
├── channels.js         # 渠道存储（原子写、脱敏视图）
└── data/channels.json  # 渠道数据
src/
├── App.vue             # 主页面
├── style.css           # 全局样式（teal 主色，支持深色模式）
├── types/index.ts      # 类型定义
├── utils/
│   ├── api.ts          # 后端接口客户端
│   └── storage.ts      # 双层存储原语 + 世代号
└── composables/
    └── useEditorStore.ts  # 状态层：调度、持久化、请求
```

## 质量（quality）参数：并非所有渠道都支持

**实测结论（gpt-image-2，同一提示词，仅改 quality）**：

| 渠道 | low | medium | high | 体积极差 | 透传? |
|---|---|---|---|---|---|
| woyao | 1097KB / 425 tok | 1733KB / 1650 tok | 1973KB / 6500 tok | **23%** | ✅ |
| TokenLab | 1815KB | 1824KB | 1832KB | **0.5%** | ❌ |

TokenLab 三档画质、体积、耗时几乎完全一样（18–20s），**上游不透传 quality** ——
选了也没用，还会让人误以为在省/多花钱。

**判据用「体积极差」而不是 `usage`**：部分中转站的 usage 是固定值
（TokenLab 实测所有模型 usage 恒为 515，完全不真实），不能作为依据。
文件体积的离散度才反映上游是否真的做了不同档位的推理。

**处理**：渠道新增 `qualityPassthrough` 能力标记（true / false / null=未验证）。
为 false 时 UI 禁用质量选择并说明原因，费用估算也按三档同价计算。
默认值：woyao = true，TokenLab 三条线路 = false。

**另实测**：传非法值（如 `ultra-hd`）上游不报错而是静默降级到 medium，
但耗时从 30s 涨到 95s。客户端已做枚举校验，生图/图生图共用 `assertValidQuality()`。

## 渠道模型列表：声明 ≠ 可用

渠道的 `/v1/models` 是**能力声明**，不等于这个 Key 真能用。实测两类反例：

| 渠道 | 声明了 | 实际情况 |
|---|---|---|
| TokenLab | `gpt-image-1` | `is not enabled for this channel`（管理员未配价格/映射）|
| woyao | `gemini-3-pro-image` | `Images API is not supported for this platform`（走 chat 接口）|

处理机制：

- 模型下拉 = **渠道声明 − 实测屏蔽**，屏蔽项不显示
- 点「测试」若返回上述三类错误，**自动记入该渠道黑名单**，无需手动清理
- 「渠道管理」里能看到被屏蔽的模型（悬停看原因），点「恢复」可放回下拉 ——
  管理员后来开通后能找回
- 黑名单**只屏蔽不物理删除**，且按渠道隔离（同一模型在不同渠道可用性可能不同）
- 刻意不记录「账号额度耗尽 / 网络失败 / 参数错误」等临时状态，避免误伤可用模型

## 下拉框为什么不用原生 `<select>`

原生控件只有**触发器**能上样式（`appearance:none` + 自绘箭头），
**展开后的选项列表由系统绘制，无法用 CSS 控制配色与圆角** ——
深色模式下点开会突然变成灰白方块，与全站风格割裂。

现在全部换成自定义的 `SelectBox` 组件，弹层也用 HTML 渲染，
浅色/深色、悬停/选中、键盘导航都统一。支持 `↑↓` `Enter` `Esc` `Home` `End`。

## 遮罩（mask）的关键语义

**透明 = 重绘，不透明 = 保留。** 这与很多设计工具的黑白蒙版相反
（那里是黑色=编辑区）。搞反的结果是「除了你想改的地方，其他全被改了」。

官方硬性要求（实测 woyao 一致）：

| 要求 | 说明 |
|---|---|
| 必须是 PNG | JPEG 无 alpha 通道，会被当作**整图可改** |
| 尺寸必须与输入图完全一致 | 不一致直接报错 |
| 多图时只作用于第 1 张 | 官方明确说明 |

用「画笔涂选」就不需要关心这些 —— 导出的 PNG 尺寸与主图自动对齐，
alpha 语义由代码保证（未涂=不透明=保留，涂过=透明=重绘）。

另外，mask 只是**提示**而非硬边界。官方原话是
"Masking with GPT Image is entirely prompt-based. The model uses the mask as
guidance, but may not follow its exact shape with complete precision."
所以需要边缘绝对干净时，建议在提示词里说明「不要在遮罩边界留下接缝」。
