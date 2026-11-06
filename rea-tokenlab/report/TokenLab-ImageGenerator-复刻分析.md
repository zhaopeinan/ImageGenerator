# TokenLab `/image-generator` 逆向分析与复刻方案

分析对象：`https://tokenlab.cc.cd/image-generator`
分析日期：2026-10-17
分析手段：静态 bundle 解码（esbuild）＋ 运行时观察（ego-browser / Ego Lite）＋ 上游源码比对

---

## 0. 结论先行

**这个页面不是独立产品，而是开源项目 sub2api 的一个前端扩展模块。**

| 判断 | 证据 | 类型 |
|---|---|---|
| 后端 = sub2api | localStorage 键 `sub2api_locale`、`sub2api_login_agreement_consent`；`/api/v1/settings/public` 响应结构与 sub2api 源码字段一一对应 | 运行时观察 + 源码比对 |
| 站点版本 0.2.15 | `/api/v1/settings/public` → `version: "0.2.15"` | 运行时观察 |
| 上游 main 为 0.2.17 | `backend/cmd/server/VERSION` | 源码 |
| 前端框架 Vue 3 + Vite | 单一入口 `index-*.js`，路由懒加载，`__vite__mapDeps` | 静态 |
| 后端语言 Go + Gin | `backend/internal/handler/openai_images.go` 使用 `gin.Context` | 源码 |
| 许可证 LGPL-3.0 | GitHub API | 运行时观察 |
| **网页版生图 UI 是 TokenLab 自加的** | 上游 main 分支 `frontend/src/views/user/` **没有** `ImageGeneratorView.vue`，只有 `BatchImageGuideView.vue`（另一个功能） | 源码 |

**复刻建议：不要从零手写。** 直接 fork sub2api，把逆向出来的 `ImageGeneratorView.vue` + `imageGenerator.ts` 两个文件补进去即可 —— 后端生图接口、计费、渠道调度全部现成。

⚠️ LGPL-3.0 有传染性：动态链接/独立模块调用可以，闭源整仓搬运前请自行评估法务。

---

## 1. 技术栈与产物指纹

```
前端  Vue 3 (Composition API + Pinia) / Vite / vue-i18n / Tailwind
后端  Go + Gin，REST 风格，统一响应信封 {code, message, data}
网关  多线路自定义端点（api_base_url + custom_endpoints[]）
存储  localStorage（元数据）+ IndexedDB（大 blob）
模型  gpt-image-2（硬编码常量）
```

线上产物（`/assets/`，Vite hash 文件名）：

| 文件 | 大小 | 作用 |
|---|---|---|
| `index-CleCVXFw.js` | 287 KB | 入口：路由表、store、API 客户端、i18n 词典 |
| `vendor-vue-hMeO97m5.js` | 114 KB | Vue 运行时 |
| `vendor-misc-CjwlkjM2.js` | 637 KB | 第三方库 |
| `vendor-i18n-YzmmkrdN.js` | 63 KB | i18n 运行时 |
| **`ImageGeneratorView-Cp8RDZb3.js`** | **24 KB** | **生图页面（UI + 请求逻辑）** |
| **`imageGenerator-CX1zM4zJ.js`** | **31 KB** | **生图状态层（Pinia store + 持久化）** |
| `gatewayEndpoint-DycZ91hV.js` | 332 B | 端点 URL 拼接 |

路由表共 **75 条**，`/image-generator` 的元数据：

```js
{ path: "/image-generator", name: "ImageGenerator",
  component: () => import("./ImageGeneratorView-Cp8RDZb3.js"),
  meta: { requiresAuth: true, requiresAdmin: false, ... } }
```

---

## 2. 运行时验证结果

用 ego-browser 实测（未登录态）：

| 观测项 | 结果 |
|---|---|
| 路由守卫 | 访问 `/image-generator` → 302 到 `/login?redirect=/image-generator` |
| 页面标题 | `TokenLab - AI API Gateway` |
| 生图接口未授权 | `POST /v1/images/generations` → **401** `{"code":"API_KEY_REQUIRED","message":"API key is required in Authorization header (Bearer scheme), x-api-key header, or x-goog-api-key header"}` |
| 功能开关 | `/api/v1/settings/public` 含 `image_generator_enabled`、`image_generator_web_max_count` |
| 真实线路配置 | `api_base_url = https://api.tokenlab.cc.cd`，另有 4 条 custom_endpoints（含一条名为「cloudflare直连(生图不稳定)」）—— **实证了多端点降级设计的现实动机** |

---

## 3. 架构还原

```
┌──────────────────────────────────────────────────────┐
│  ImageGeneratorView.vue  （UI 层，24KB）             │
│  ├ Tab: 生成 / 编辑                                    │
│  ├ 表单: prompt / size / quality / count / format      │
│  ├ 上传: source + mask（点击/拖拽/粘贴）                │
│  ├ 画廊: 筛选 all|generate|edit，复制/下载/删除/清空     │
│  └ 端点选择器（多线路）                                 │
└───────────────┬──────────────────────────────────────┘
                │ 读状态 / 调 action
┌───────────────▼──────────────────────────────────────┐
│  imageGenerator.ts  （Pinia store，31KB）             │
│  ├ 19 个 ref 状态 + 22 个 action                       │
│  ├ localStorage：draft 元数据、gallery-meta            │
│  ├ IndexedDB：图片 blob（kv-v2 store）                 │
│  └ 并发控制：写队列串行化（at/et 链）                    │
└───────────────┬──────────────────────────────────────┘
                │ fetch(endpoint + /v1/images/*)
┌───────────────▼──────────────────────────────────────┐
│  sub2api 网关（Go + Gin）                             │
│  ├ 鉴权: Bearer / x-api-key / x-goog-api-key           │
│  ├ 权限: group.allow_image_generation                  │
│  ├ 限流: acquireImageGenerationSlot（用户并发）          │
│  ├ 计费: 按 size/quality 计价（image_pricing）          │
│  └ 转发: OpenAI 兼容渠道 + 故障转移                     │
└──────────────────────────────────────────────────────┘
```

---

## 4. 核心逻辑逐项还原

### 4.1 文生图请求

```js
// 端点：POST {base}/v1/images/generations
{
  model: "gpt-image-2",
  prompt: "<trimmed prompt>",
  n: 1,                       // 见 4.3 并发策略
  response_format: "b64_json",
  size: "<非 auto 才传>",
  quality: "<low|medium|high>",
  output_format: "<非 png 才传>"   // jpeg | webp
}
```

### 4.2 图生图请求（multipart）

```js
// 端点：POST {base}/v1/images/edits   Content-Type: multipart/form-data
FormData:
  model        = "gpt-image-2"
  prompt       = <必填>
  image        = <File>          // source，支持 png/jpeg/webp
  mask         = <File>          // 可选
  n            = 1
  response_format = "b64_json"
  size / quality / output_format   // 同上条件传参
```

### 4.3 「批量」是并发 N 次，不是 `n=N`

这是最容易复刻错的一点。源码 `Re(count, send, parse, {onImages})`：

1. 用 `Promise.allSettled` **并发发起 count 次独立请求**，每次 `n=1`
2. 每次拿到图立刻 `onImages` 落库（流式进画廊，用户能边看边出）
3. 任一失败则整体抛错
4. 数量不足则报 "did not contain enough images"

**为什么这么做**：`count` 被 clamp 到 `min(用户并发数, 全局上限)`，本质是把「用户并发额度」映射成前端并发出图。所以后端看到的永远是 `n=1` 的小请求，便于限流与计费。

### 4.4 响应解析（兼容三种上游形态）

```js
for (const it of (res.data || []))   if (it.b64_json) push(dataURL); if (it.url) push(it.url);
for (const it of (res.output || [])) push(it.result || it.b64_json || it.image_url);
```

即同时兼容 OpenAI 标准（`data[].b64_json`）和另一种 `output[].result` 形态。

### 4.5 端点 URL 拼接（`gatewayEndpoint.js` 全文逻辑）

```js
function buildEndpoint(base, path, fallback = location.origin) {
  const p = path.startsWith("/") ? path : "/" + path;
  const u = new URL(base || "/api/v1", fallback);
  let e = u.pathname.replace(/\/+$/, "");
  if (e.endsWith("/api/v1")) e = e.slice(0, -7);
  else if (e.endsWith("/api")) e = e.slice(0, -4);
  else if (e.endsWith("/v1")) e = e.slice(0, -3);
  u.pathname = (e + p) || p;
  u.search = ""; u.hash = "";
  return u.toString();
}
```

作用：把「控制台基址」（可能带 `/api/v1` 或 `/api` 后缀）规范化后拼上 `/v1/images/*`。

### 4.6 可用 Key 的筛选条件

```js
keys.filter(k => k.status === "active"
              && k.group?.platform === "openai"
              && k.group?.allow_image_generation === true)
```

**生图只走 OpenAI 平台分组**。选中 Key 直接取 `key` 明文发到 `Authorization: Bearer <key>` —— 即前端持有用户 API Key 明文。

### 4.7 数量上限的三层收敛

```
maxCount = min( user.concurrency , settings.image_generator_web_max_count ?? ∞ )
count    = clamp(count, 1, maxCount)
```
文案用 `countLimitHint` 插值同时展示用户限制与全局限制。

### 4.8 多端点故障转移

请求失败时判定 `TypeError` 且 message 含 `load failed` / `failed to fetch` / `networkerror` / `network request failed` → 弹出确认框，提示切换到另一条备用线路，用户确认后才切换。**不会自动重试**。

### 4.9 离开页面保护

`beforeunload` 事件：有进行中的任务时 `preventDefault()` 并设 `returnValue = ""`。

---

## 5. 持久化设计（最值得抄的部分）

这是整个模块工程量最大、也最有参考价值的部分：**双层存储 + 世代号（epoch）机制 + 跨标签页同步 + v1→v2 迁移**。

### 5.1 双层存储分工

| 层 | 存什么 | 键名 |
|---|---|---|
| localStorage | 草稿元数据、画廊元数据、世代号、待删队列 | `tokenlab:image-generator:draft:v2`、`gallery-meta:v2`、`clear-epoch:v2`、`gallery:pending-delete:v2` |
| IndexedDB | 图片二进制 blob、上传的原图/蒙版 File | DB `tokenlab-image-generator-v2`，store `kv-v2` |

索引里**只存不含 src 的元数据**，blob 单独按 `gallery:item:v2:<id>` 存 —— 避免 localStorage 5MB 爆掉。

### 5.2 世代号（clear-epoch）机制

```
清空画廊 = 写入新世代号 "clear-<timestamp>-<rand>"，而不是删数据
所有记录都带 clearEpoch，读写时校验，不匹配即视为过期
```
好处：**清空是 O(1) 的**，不需要遍历删除成百上千条 blob；旧数据靠世代号自然失效，后台再异步清理。

### 5.3 跨标签页同步

监听 `window` 的 `storage` 事件，仅当 key 是 `clear-epoch:v2` 且世代号变化时，重新 hydrate。多标签页不会互相覆盖。

### 5.4 写入串行化

三对 Promise 链（`at` / `et`）把所有写操作排队：
```
source 上传队列 → Xe
mask  上传队列 → He
画廊/草稿队列  → De
```
配合 `epoch + revision` 双重复核（`v(epoch, revision)` 函数在每次 await 之后重新校验），**彻底避免异步竞态导致的数据错乱**。

### 5.5 v1 → v2 迁移

检测到 v1 数据（DB `tokenlab-image-generator` / store `kv`，键名带 `:v1`）时，在单次事务内读出并迁移到 v2，随后清理 v1。迁移带 `destructiveRevision` 对账，避免迁移过程误删。

### 5.6 容量上限

画廊最多 **18** 张（常量 `re = 18`），超出丢弃最旧的。

---

## 6. 后端接口契约（sub2api `openai_images.go`）

```go
type OpenAIImagesRequest struct {
    Endpoint, ContentType  string
    Multipart              bool
    Model, Prompt         string
    ExplicitModel          bool
    Stream                 bool
    N                      int
    Size, SizeTier         string
    ExplicitSize           bool
    ResponseFormat         string
    Quality                string
    Background, OutputFormat, Moderation, InputFidelity, Style string
    OutputCompression      *int
    PartialImages          *int
    HasMask                bool
    HasNativeOptions       bool
    RequiredCapability     OpenAIImagesCapability
    InputImageURLs         []string
    MaskImageURL           string
    Uploads                []OpenAIImagesUpload
    MaskUpload             *OpenAIImagesUpload
}
```

Handler 关键流程（`backend/internal/handler/openai_images.go`）：

1. 取 API Key → 无效则 401 `authentication_error`
2. `ParseOpenAIImagesRequest` 解析（JSON 或 multipart 双形态）
3. `compositeTargetPlatformAllowed` 复合分组平台校验
4. `GroupAllowsImageGeneration(apiKey.Group)` → 403 `permission_error`
5. `checkSecurityAudit` 内容安全审核
6. `acquireImageGenerationSlot` **并发槽位获取**（拿不到直接返回，前端据此显示「任务进行中」）
7. `ResolveChannelMappingAndRestrict` 渠道映射 + 故障转移
8. 转发上游，回写用量与计费

---

## 7. 复刻路线（三选一）

### 方案 A：Fork sub2api（推荐，成本最低）

```bash
git clone https://github.com/Wei-Shaw/sub2api
# 1. 补 frontend/src/views/user/ImageGeneratorView.vue      ← 按 §4 逆向结果重写
# 2. 补 frontend/src/composables/useImageGenerator.ts         ← 按 §5 重写（可先简化为 localStorage）
# 3. 注册路由 requiresAuth
# 4. 后端无需改动：/v1/images/generations 与 /v1/images/edits 已存在
# 5. 管理端加 image_generator_enabled / image_generator_web_max_count 开关
```

后端 0 改动，前端约 1200 行。LGPL-3.0 需保留版权声明与变更说明。

### 方案 B：纯前端 + 现成生图 API（最独立）

若只要「生图 + 编辑 + 画廊」这个界面，不要网关：

- Vue 3 + Vite 复刻 UI，直接打 OpenAI 官方 `/v1/images/generations`
- Key 由用户在设置页自行填入（存 localStorage）
- §5 的持久化设计**建议完整照搬**，这是踩过坑的沉淀
- 后端零依赖，静态部署即可

代价：失去 sub2api 的计费、限流、渠道故障转移、多线路降级。

### 方案 C：完整自建网关

只有在需要多用户配额/计费时才有意义。工作量集中在：API Key 体系、用量记录、按 size×quality 计价、渠道池与故障转移。**建议直接用 sub2api，不要重写。**

---

## 8. 复刻时容易踩的坑

1. **别用 `n=N` 做批量**。站点是并发 N 次 `n=1`，语义完全不同（涉及后端限流与计费口径）。
2. **大 blob 别塞 localStorage**。必须 IndexedDB，索引只存元数据，否则几 MB 就爆。
3. **清空别遍历删除**。用世代号，O(1)。成百上千条 blob 逐个删会卡死主线程。
4. **异步写入必须串行化 + 世代复核**。多 await 之间可能被 storage 事件打断，这是他们写 `v(epoch, revision)` 反复校验的原因。
5. **端点基址的后缀要规范化**。用户填 `https://x.com/api/v1` 时直接拼会变成 `/api/v1/v1/images/...`。
6. **质量/尺寸枚举要与后端对齐**。前端 `size` 只有 `auto`，质量 `low|medium|high`，格式 `png|jpeg|webp`。
7. **切线路不要自动重试**。站点是弹窗让用户确认，避免重复计费。
8. **注意 `beforeunload` 保护**，任务进行中直接离开会丢结果。

---

## 9. 本次分析的能力边界

诚实标注，以下内容**没有**证据支撑：

- **未登录**，未观察到登录后的真实生图界面渲染、真实响应体结构、错误提示文案。运行时部分结论来自未授权态的 401 与公开配置接口。
- **未执行成功的 REA 语义分析**。本机 Command Line Tools 损坏（`SwiftBridging` 模块重复定义），REA 的 macOS 进程归属 helper 编译失败，静态分析层全部返回 `incomplete-module`。改用 esbuild 反压缩 + 人工判读完成等效工作，结论不依赖 REA 语义图。
- 图片生成的实际计费单价、各 `size` 的具体可选值（前端只暴露 `auto`），需登录后查管理端 `groupsImagePricing` 才能确认。
- 未验证 `/v1/images/edits` 在真实上游（OpenAI 官方 vs 其他渠道）的行为差异。

---

## 10. 产物清单

```
rea-tokenlab/
├── app/assets/                 # 线上原始 bundle
│   ├── ImageGeneratorView-Cp8RDZb3.js
│   ├── imageGenerator-CX1zM4zJ.js
│   ├── index-CleCVXFw.js
│   ├── gatewayEndpoint.js
│   └── vendor-*.js
├── pretty/                     # esbuild 反压缩可读版
│   ├── ImageGeneratorView-Cp8RDZb3.pretty.js   (418 行)
│   └── imageGenerator-CX1zM4zJ.pretty.js       (952 行)
├── target/                     # REA 分析目标目录
├── rea_evidence.json           # REA 证据记录（含能力边界说明）
└── upstream/                   # sub2api 源码（/tmp/s2a/sub2api-main）
```
