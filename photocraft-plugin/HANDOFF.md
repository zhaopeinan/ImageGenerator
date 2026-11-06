# PhotoCraft 插件开发 · 交接文档

> 读者：接手开发的 agent（或工程师）。
> 本文自包含，不依赖任何前序对话。文中每条事实都标注了来源，请按标注决定可信度。
>
> **来源标记**
> `[实测]` 在本机 PhotoCraft 0.20.2 上真实跑过，有输出为证
> `[源码]` 读自 `storytold/photocraft` 对应 tag 的 Rust 源码（v0.20.2）
> `[文档]` 读自仓库 `docs/plugins.md`（v0.20.2）
> `[未验证]` 推断或未在本机实测，第一次执行时需自行确认

---

## 0. 一句话现状

PhotoCraft 支持第三方插件，机制是**沙箱化的 WebAssembly 模块**（ABI v1），当前**只支持滤镜（filter）**，不支持 UI 面板、网络、文件、WASI。本机已实测跑通「安装 → 枚举 → 执行 → 像素正确」全链路 `[实测]`，但本机**没有 Rust 工具链**，所以现有可运行产物是手工汇编的 wasm，不是 Rust 编译的。

---

## 1. 一页速查卡

| 项 | 值 |
|---|---|
| 应用 | `/Applications/PhotoCraft.app`，bundle id `ai.storyteller.photocraft` `[实测]` |
| 版本 | 0.20.2，commit `7c12f6471`，构建于 2026-11-05 `[实测]` |
| 技术栈 | Rust + egui 原生应用（不是 Electron）`[实测]` |
| 上游仓库 | `github.com/storytold/photocraft`，MIT OR Apache-2.0 `[文档]` |
| 插件格式 | 单个 `.wasm` 文件，core WebAssembly，**零 import** `[源码]` |
| 运行时 | `wasmi 2.0.0`（纯 Rust 解释器，portable loop dispatcher）`[实测/源码]` |
| ABI 版本 | `1`，`pc_abi_version()` 必须返回 1 `[源码]` |
| 插件类型 | 仅 `"filter"` `[源码]` |
| 安装命令 | `plugin.install` / `plugin.list` / `plugin.run` / `plugin.remove` / `plugin.reload` `[实测]` |
| 菜单入口 | `Filter › Plug-ins`（已装插件 + Install Plug-in…）`[文档]` |
| 持久化 | 手动安装只对**当前进程**有效；持久化靠偏好里的插件文件夹 `[源码]` |
| CLI | `/Applications/PhotoCraft.app/Contents/MacOS/photocraft-cli`，无 `plugin` 子命令，插件命令走 `--cmd` `[实测]` |
| 本机工具链 | 无 cargo / rustc / rustup；有 node 22、python3 + PIL `[实测]` |

---

## 2. 环境现状（接手前先确认）

```
$ ls /Applications | grep -i photo          # PhotoCraft.app
$ plutil -p /Applications/PhotoCraft.app/Contents/Info.plist | grep CFBundleIdentifier
$ /Applications/PhotoCraft.app/Contents/MacOS/photocraft-cli --help
$ which cargo rustc rustup                  # 本机：均不存在
```

三条已知环境限制：

1. **无 Rust 工具链** `[实测]`。要写 Rust 插件必须先装（见 §8），否则走 §9 的无工具链路径。
2. **`curl` 访问外网被沙箱拦** `[实测]`：`raw.githubusercontent.com`、`cdn.jsdelivr.net` 均报 `OpenSSL SSL_connect: SSL_ERROR_SYSCALL`（exit 35）。同一时刻 `WebFetch` 正常。所以拉上游源码要走 WebFetch + GitHub API / raw 文本，不要用 `curl` 取二进制。
3. `TMPDIR` 不可写 `[实测]`，跑 python 前先 `export TMPDIR=~/.workbuddy/tmp`。

---

## 3. 能力边界：先判断需求是否在 ABI v1 之内

**能做**（v1 支持）：

- 逐像素滤镜、小邻域滤镜（模糊、锐化、扭曲、色彩映射、色调分离、噪点、图案叠加…）
- 声明参数并让宿主自动生成对话框（滑块 / 数字框 / 复选 / 下拉）
- 通过 `overlap` 拿到邻域上下文；通过 `area: "canvas"` 处理整幅画布（生成器类）
- 通过 `_image` 里的文档坐标做位置相关效果（渐变、暗角），跨分块无缝
- 作用在像素图层、Alpha 通道 / 快速蒙版、智能对象上（智能对象会记录成 smart filter）

**不能做**（v1 明确不支持，`[文档]`）：

- 面板 / UI 插件、自定义对话框布局
- 读取其它图层、其它文档、宿主内部状态
- 进度回调、用户取消
- 自定义文件格式、导入导出器
- 持久状态（每次分块都是全新实例，内存不保留）
- 任何文件 / 网络 / 时钟 / 随机数访问（零 import，没有 WASI）

> **判定规则**：如果需求落在「不能做」里，正确动作是**停下来汇报**，说明这是宿主能力缺口（需要改 `crates/` 并重新编译 PhotoCraft），不要试图用滤镜去绕沙箱。

---

## 4. ABI v1 契约（实现的最小充分条件）

### 4.1 必须导出的 5 项

全部整数为 `i32`，指针是线性内存内的字节偏移。`[源码]`

| 导出 | 精确签名 | 语义 |
|---|---|---|
| `memory` | memory | 模块线性内存，名字必须是 `memory` |
| `pc_abi_version` | `() -> i32` | 必须返回 `1` |
| `pc_manifest` | `() -> i64` | 返回 `(len << 32) \| ptr`，指向 UTF-8 manifest JSON，≤ 64 KiB |
| `pc_alloc` | `(size: i32) -> i32` | 返回一块宿主可写的 `size` 字节，失败返回 `0`。**永不释放** |
| `pc_filter` | `(buf, buf_len, width, height, channels, format, params, params_len) -> i32` | 原地处理像素，`0` 成功，非 0 为错误码 |

宿主用类型化查找（`get_typed_func`），**签名不对直接拒绝**，不是运行时才炸。

### 4.2 模块约束

- **零 import**。有任何 import（含 WASI、`env.*`）→ 安装阶段拒绝，报 `the module imports X.Y, but plug-ins get no host imports (no WASI, files or network)` `[源码]`
- 核心 WebAssembly MVP + bulk memory / sign extension / multi-value / saturating conversions；**无 SIMD、无 memory64** `[文档]`
- 模块 ≤ 32 MiB；wasmi 严格限制：≤ 10,000 函数、1 个内存、4 张表、表元素 ≤ 100,000、1 个实例 `[源码]`
- 文件必须以 `\0asm` 开头，否则报 `not a WebAssembly binary (missing \0asm header)` `[实测]`

### 4.3 像素缓冲

`[文档]`

- `buf` 里有 `width × height × channels` 个 **little-endian `f32`**，交错、行主序
- 数值归一化到 0–1（32 位深文档可能 > 1）
- **单位是样本，不是字节**：第 `i` 个样本在 `buf[i]`（C 里 `i * 4` 字节）
- `width/height` 是**含 overlap 边距**的分块尺寸，不是整幅图

### 4.4 `format` 位域

`format = depth | (alpha << 8) | (mode << 16)` `[文档]`

- `depth`（bit 0–7）：文档位深 8 / 16 / 32，仅信息性（样本永远是 f32）
- `alpha`（bit 8）：为 1 表示最后一个通道是**直通（非预乘）alpha**
- `mode`（bit 16–23）：按 PSD 编号 —— `0` Bitmap，`1` Grayscale，`2` Indexed（按 RGB 存），`3` RGB，`4` CMYK，`7` Multichannel，`8` Duotone（按灰度存），`9` Lab

Alpha 通道和快速蒙版目标进来时是**单通道灰度**。

### 4.5 `params` 与 `_image`

`params` 指向 `params_len` 字节 UTF-8 JSON：校验过的参数值，外加 `_image`：`[文档]`

```json
{"amount": 50, "mode": "soft",
 "_image": {"x": 0, "y": 256, "width": 1024, "height": 256, "overlap": 0,
            "canvasWidth": 6000, "canvasHeight": 4000,
            "mode": "rgb", "depth": 8, "alpha": true, "channels": 4}}
```

`x, y` 是缓冲左上角样本在**文档坐标系**中的位置（含边距）。做渐变、暗角这类效果必须用它算绝对坐标，否则分块边界会出现接缝。

---

## 5. Manifest 规范

### 5.1 顶层字段

`[文档]` + `[源码]`

```json
{
  "id": "org.example.tone",
  "name": "Tone",
  "version": "1.0.0",
  "kind": "filter",
  "author": "Example",
  "description": "What it does.",
  "params": { "...": "..." },
  "overlap": 0,
  "area": "content"
}
```

| 字段 | 必填 | 规则 |
|---|---|---|
| `id` | 是 | `[A-Za-z0-9._-]{1,64}`，建议 reverse-DNS；**同 id 安装即替换** |
| `name` | 是 | 菜单标签，1–64 可见字符；拒绝控制字符与 Unicode 格式字符（bidi 覆写、零宽空格、软连字符），仅允许 ZWJ/ZWNJ；至少一个可见字符 |
| `version` | 否 | 缺省空串 |
| `kind` | 是 | 只能 `"filter"` |
| `author` / `description` | 否 | 缺省空串 |
| `params` | 否 | JSON 对象，键顺序即对话框顺序，≤ 64 个 |
| `overlap` | 否 | 0–256，邻域半径（像素） |
| `area` | 否 | `"content"`（默认）或 `"canvas"` |

### 5.2 参数类型

```json
"params": {
  "amount": {"type": "number", "min": 0, "max": 100, "default": 50},
  "radius": {"type": "number", "min": 0, "max": 40, "default": 4, "unit": "px"},
  "steps":  {"type": "int", "min": 1, "max": 16, "default": 4},
  "mono":   {"type": "bool", "default": false},
  "mode":   {"type": "choice", "options": ["soft", "hard"], "default": "soft"}
}
```

- 参数名：`[A-Za-z0-9_]`，长度 1–64，不以 `_` 开头，**不能叫 `id` / `layer` / `target` / `channel`**（宿主保留给命令路由）`[源码]`
- 宿主在调用前校验：缺值取 default；number 夹到 `min..=max`；int 四舍五入并夹紧；类型错或 choice 值不在 options 里 → **报错，不调用插件** `[文档]`
- `int` 的 `min`/`max` 缺省为 ±1,000,000 `[源码]`

### 5.3 `unit`

只对 `number` / `int` 有效。`"px"` 表示「文档像素长度」（半径、距离、位移、尺寸）；缺省或任何其它值都当作无单位（色阶、倍数、计数、百分比）`[源码]`

作用：大文档的实时预览跑在缩小副本上，宿主会把 `px` 参数按缩放比除下去，让预览和 OK 应用的长度一致；若除完低于参数 `min`，预览会改用更小的缩小倍数 `[文档]`。

### 5.4 `overlap` 与 `area`

- `overlap`：每个输出像素需要的邻域上下文像素数。宿主给每个分块四边各补 `overlap`，补的是画布边缘像素（或画外图层内容）的重复，最后只取内部矩形。**模糊/形态学类必须设，且要 ≥ 实际核半径**，否则分块边界露缝 `[文档]`
- `area`：`"content"` 只处理图层非透明边界（按 `overlap` 外扩）；`"canvas"` 处理整幅画布含透明像素（生成器用）

---

## 6. 宿主替你做的事（别重复实现）

`[文档]` + `[源码]`

- **分块与并行**：图层切成 tile 对齐、每块约 4 MiB f32 的 band，原生机型多线程并行；每块**独立实例**
- **选区混合**：`out = original + (filtered − original) × coverage`，与内置滤镜一致，插件看不到选区
- **撤销**：一次 `plugin.run` 是一步撤销，失败时事务回滚、文档不动
- **NaN/Inf**：输出样本为 NaN 或 Inf 时**保留原值**；整数位深与 alpha 夹到 0–1
- **透明锁定**：图层开了 Lock Transparency 时只允许改颜色、不改 alpha
- **智能对象**：作用在智能对象上会记录成 smart filter（`{"command":"plugin.run","params":{"id","params"}}`），重渲染时重跑；插件被卸载则跳过、保留缓存像素
- **对话框与预览**：有 `params` 就自动生成对话框与实时预览

---

## 7. 沙箱预算

`[源码]` 默认值（`photocraft_plugins::Limits::default()`）：

| 限制 | 默认 | 超限表现 |
|---|---|---|
| 宿主 import | 无 | 安装即拒 |
| 模块大小 | 32 MiB | 拒绝 |
| 单实例线性内存 | 512 MiB | `memory.grow` 返回 −1 |
| 单次运行总内存 | 2 GiB（并行 4 个实例封顶） | 减少并行 band 数 |
| 指令燃料 | 每次调用 50M + 每样本 4,000 | `Limit("instruction budget")` |
| 墙钟 | 60 秒 / 次运行（原生；每 20M 指令检查一次） | `Limit("time budget")` |
| 调用深度 | 1,024 帧 | trap |

解释执行，**比原生慢约 10–100 倍** `[文档]`。所以：内层循环要短、避免除法、优先 `chunks_exact`、能用 u32 整数运算就别用浮点。官方基准：24 MP RGBA 8-bit 图层跑 Invert，插件 1.1–1.6 s（分块并行），内置单线程 Invert 3.6–5.1 s。

---

## 8. 开发路径 A：Rust `no_std`（推荐，但本机需先装工具链）

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # 需外网，本机 curl 被拦，见 §2
rustup target add wasm32-unknown-unknown
cd template/invert-rs && ./build.sh
```

`build.sh` 会编译、复制产物、并调用 `scripts/inspect_wasm.mjs` 检查零 import + 导出齐备。

**关键约束**：必须是 `#![no_std]`（或 `std` 但绝不触碰 WASI，实际上不可行），否则 `std` 会引入 import 被拒。

Edtion 2024 用 `#[unsafe(no_mangle)]`；edition 2021 用 `#[no_mangle]`。`[源码]` 上游示例是 2024。

### 参数怎么读（no_std 下的真实难点）

两种做法，按复杂度选：

1. **手写解析（推荐给少量数值参数）**：在 `params` 那段 UTF-8 里找 `"key"`，跳过 `:` 和空白，用一个小型 `f32`/`i64` 解析器读数字。代码量 ~40 行，无依赖，最稳。
2. **引 `serde_json` + `alloc`**：需要自带全局分配器（可以用基于 `memory.grow` 的 bump allocator，反正每次分块都是新实例、永不释放），模块会涨到 100 KiB 级别。只有在参数结构复杂时才值得。

> 不要把 manifest 里的 default 当作运行时缺省——宿主已经填好了缺值，插件收到的一定是全量参数。

---

## 9. 开发路径 B：无工具链（本机当前唯一可跑通的路，已实测）

`reference/mkplugin.py` 是一个**纯 Python 的 wasm 汇编器**，直接按字节生成符合 ABI v1 的模块：`[实测]`

```sh
export TMPDIR=~/.workbuddy/tmp
cd reference && python3 mkplugin.py     # -> demo-invert.wasm, 554 bytes
```

它生成的是标准 5 段模块（type / function / memory / export / code / data），已在本机 0.20.2 上验证：

```
$ node scripts/inspect_wasm.mjs reference/demo-invert.wasm
file    : reference/demo-invert.wasm (554 bytes)
imports : none
exports :
  - memory (memory)
  - pc_abi_version (function)
  - pc_manifest (function)
  - pc_alloc (function)
  - pc_filter (function)
OK: zero imports, all required exports present
```

**适用场景**：只需要验证宿主行为、做最小复现、或临时打补丁。**不适合**做正经产品——手写字节码不可维护。要真做插件，装 Rust。

如果坚持不用 Rust，其它可行语言：C / Zig / AssemblyScript（需保证不生成 import）、或直接写 WAT 再找工具汇编。

---

## 10. 安装、热重载与调试

### 三种安装方式

1. **CLI 一次性（开发验证用）**：进程内有效，`plugin.install` 之后同一进程的 `plugin.run` 立刻可用。进程退出即消失。`[实测]`
2. **GUI 手动**：`Filter › Plug-ins › Install Plug-in…` 选 `.wasm`。同样**只对当前进程有效**，重启丢失。`[文档]`
3. **持久化（正式发布路径）**：把 `.wasm` 放进任意文件夹，`Edit › Preferences › Plug-ins` 勾选 *Use Additional Plugins Folder* 并填路径。启动时及偏好变更时自动加载该目录下所有 `*.wasm`（**不递归**）。`[文档]`

本机偏好现状 `[实测]`：`plugIns.useAdditionalPluginsFolder = false`，`additionalPluginsFolder = ""` —— 即默认关闭，要持久化必须手动开。

### 热重载

改完 `.wasm` 后重跑 `plugin.reload`（`{"path": "<folder>"}`，缺省用偏好文件夹），无需重启应用。`[文档]`

### 命令参数形态

```
plugin.install  {"path": "/abs/x.wasm"} | {"data": "<base64>"}   replace: bool = true
plugin.list     {}
plugin.run      {"id": "...", "params": {...}}                   # 参数也可平铺在顶层
plugin.remove   {"id": "..."}
plugin.reload   {"path": "<folder>"}
```

`plugin.run` 的顶层键里 `id` / `layer` / `target` / `channel` 是命令自己的路由键，`__` 前缀的键被忽略；插件参数要么放 `params` 里，要么用其它键平铺 `[源码]`。`path`（文件路径）**仅原生机型**可用；`data`（模块 base64）原生与 Web 两版都可用，Web 版只能用它。

---

## 11. 验证闭环（每次改完都跑）

```sh
cd ~/DevProjects/photocraft-plugin

# 1) 结构检查：零 import + 导出齐备（不需要任何工具链）
node scripts/inspect_wasm.mjs path/to/your.wasm

# 2) 端到端：安装 → 枚举 → 在 fixture 上执行 → 存 PNG → 通用断言
./scripts/verify.sh path/to/your.wasm org.example.yourid

# 3) 像素级断言：自己写，断言你的滤镜语义
python3 -c "
from PIL import Image
a=Image.open('.verify/fixture.png').convert('RGBA'); b=Image.open('.verify/out.png').convert('RGBA')
pa,pb=a.load(),b.load()
print('before',pa[10,10],'after',pb[10,10])
assert pb[10,10][3]==pa[10,10][3], 'alpha 被意外修改'
"
```

`verify.sh` 的通用断言只保证「跑通了 + 图变了 + 没把 alpha 全弄没」，**它不验证你的滤镜语义**。滤镜正确性必须自己加断言。

本机已跑通的参考输出 `[实测]`：

```
$ ./scripts/verify.sh reference/demo-invert.wasm com.example.pc.demo.invert
== 0. fixture
fixture: fixture.png (64, 64) RGBA
== 1. install + list + run
{"command":"plugin.install","result":{"area":"content",...,"id":"com.example.pc.demo.invert","kind":"filter","name":"Invert (WASM demo)","overlap":0,"params":"{}","size":554,"source":".../demo-invert.wasm","version":"1.0.0"}}
{"command":"plugin.list","result":{"folder":null,"plugins":[{ ... }]}}
{"command":"plugin.run","result":{"layer":2,"plugin":"com.example.pc.demo.invert"}}
== 2. assertions
changed pixels : 4032/4096 (98.4%)
opaque output  : 4032/4096
PASS (generic checks)
```

98.4% 而非 100% 是**正确行为**：fixture 最后一行 `alpha = 0`，插件的 `alpha <= 0 则跳过` 生效，那 64 个像素未改动。逐点校验结果为「RGB 全部反相、alpha 精确保留」。

---

## 12. 已知陷阱（都是实际踩过的）

1. **局部变量声明位置**。Code section 的每个函数体是 `局部变量声明 + 指令`，局部声明必须是**第一个字节组**，写成 `0x00`（0 组）再跟指令会把指令当声明解析。第一次我这么写，宿主报 `type mismatch: expected i32 but nothing on stack (at offset 0xae)` `[实测]`。Rust 编译产物不会有这问题——这是手工汇编才踩的坑。
2. **字符序错了**。手工生成时 section 顺序必须按 id 递增（1 type、3 function、5 memory、7 export、10 code、11 data），乱序会被拒。
3. **`.wasm` 里的 `pc_manifest` 返回的是打包整数**，不是指针：高 32 位是长度、低 32 位是偏移，容易写反。
4. **别用 `pc_alloc` 之前的地址**。静态数据段放在低地址（示例用 1024），宿主写入的缓冲从 `memory.grow` 之后开始；把 manifest 放在会被覆盖的区域会读到垃圾。
5. **`overlap` 不设 → 分块边界接缝**。任何邻域滤镜都必须设，且 ≥ 核半径。
6. **位置相关效果必须用 `_image.x/y`**，不能用分块内局部坐标。
7. **CLI 没有 `plugin` 子命令**，别写 `photocraft-cli plugin install`，会报 `unrecognized subcommand` `[实测]`。插件命令是引擎命令，走 `--cmd plugin.install`。
8. **`--params` 作用于它前面那个 `--cmd`**，顺序不能乱。
9. **`--out` 不能等于输入文件**，除非加 `--in-place`。
10. **造测试图别用 `layer.fill`**：不存在；`layer.fill.solidColor.set` 也存在但要求目标是填色图层。直接用 PNG 当 fixture 最省事 `[实测]`。
11. **安装不持久**。CLI 装完、GUI 里看不到，是设计如此，不是 bug。
12. **重复 id 会静默替换**（`replace` 默认 true）。调试时以为没生效，可能是装了旧的。
13. **燃料是硬上限**。每样本 4,000 指令听起来多，但在内层循环里加一个除法或一次越界检查就可能爆。先跑小图，再放大图。

---

## 13. 错误信息 → 病因

`[实测]` 为本机真实输出，`[源码]` 为源码格式化串。

| 报错 | 病因 |
|---|---|
| `not a valid plug-in module: not a WebAssembly binary (missing \0asm header)` `[实测]` | 传了文本/`.wat`/错误文件 |
| `plug-in ABI: the module must export its linear memory as \`memory\`` `[实测]` | 未导出内存，或名字不是 `memory` |
| `the module imports \`env.x\`, but plug-ins get no host imports (no WASI, files or network)` `[源码]` | 用了 std/WASI，或有任何 import |
| `pc_abi_version returned N; this host implements version 1` `[源码]` | ABI 版本不符 |
| `manifest: ...` / `manifest is N bytes (limit 65536)` `[源码]` | manifest JSON 非法或超长 |
| `type mismatch: expected i32 but nothing on stack (at offset 0x..)` `[实测]` | 手写模块结构错（见 §12.1） |
| `pc_alloc returned 0 (out of memory)` `[源码]` | 超过 512 MiB 单实例内存 |
| `Limit("instruction budget")` / `Limit("time budget")` `[源码]` | 燃料或 60 秒耗尽，算法太重 |
| `plug-in filters need a pixel layer (active layer is X layer)` `[源码]` | 目标不是像素图层（文字/形状/填色/智能对象以外的类型） |
| `missing \`id\` (see plugin.list)` `[源码]` | `plugin.run` 没给 id，或 id 未安装 |

---

## 14. 验收清单（交付前逐条打勾）

- [ ] `node scripts/inspect_wasm.mjs <wasm>` 通过：零 import，5 个导出齐备
- [ ] `plugin.install` 返回的 manifest 字段与设计一致（id / name / params / overlap / area）
- [ ] `plugin.list` 能看到，`params` 概要与预期一致
- [ ] `plugin.run` 返回 `{"layer": N, "plugin": "<id>"}`，退出码 0
- [ ] 像素断言：语义正确，**alpha 未被意外修改**（除非设计如此）
- [ ] 边界：全透明图层、1×1 图层、超宽/超高图层各跑一次不崩
- [ ] 至少一种非 RGBA 文档不崩（灰度 / 16 位）：`channels` 与 `format` 分支有处理
- [ ] 大图（≥ 4000×3000）不触发燃料或时间预算
- [ ] 带 `overlap` 的滤镜：分块边界无接缝（用大图目视 + 与整图参考对比）
- [ ] 参数极值（min / max）不 panic、不越界
- [ ] 参数对话框在 GUI 里显示正常（装到偏好文件夹后重启验证）
- [ ] 卸载（`plugin.remove`）后再 `run` 得到干净的 `NotFound`，不是崩溃

---

## 15. 交付与汇报

接手 agent 完成后请提供：

1. **产物**：`<name>.wasm`、源码、`build.sh`（或生成脚本）、manifest 的最终 JSON
2. **验证证据**：`inspect_wasm.mjs` 输出、`verify.sh` 完整输出、至少 2 条像素断言及其通过结果
3. **能力声明**：明确写出该插件支持哪些色彩模式 / 通道数 / 是否依赖 `overlap`、是否处理 alpha=0 像素
4. **未覆盖项**：哪些边界没测、为什么（例如没有 CMYK 测试文档）
5. **风险**：性能实测数字（在多大图上耗时多少）、是否触碰燃料上限

**汇报纪律**：不要把「CLI 跑通了」当成「插件可用」。CLI 走的是同一引擎，但 GUI 侧还要验证菜单显示、参数对话框、预览、撤销；这三项没验就不要写「已完成」。

---

## 附录 A · 官方参考实现（Rust，上游 v0.20.2 原样）

`template/invert-rs/src/lib.rs` 即上游 `examples/plugins/invert-rs` 的 `lib.rs`，`no_std`、无分配器、约 1 KiB。这是**最可信的基线**：先用它跑通编译与安装，确认工具链正常，再改造成你的滤镜。

`template/invert-rs/Cargo.toml` 是本文档补写的最小配置（`cdylib` + `opt-level="s"` + `lto` + `panic="abort"`），**未在本机编译验证**（无 Rust）。如果首次编译报错，优先怀疑这里，而不是 ABI。

## 附录 B · 文件清单

```
~/DevProjects/photocraft-plugin/
├── HANDOFF.md                      # 本文档
├── reference/
│   ├── demo-invert.wasm            # 已验证可安装的 554 B 模块
│   ├── mkplugin.py                 # 纯 Python wasm 汇编器（改滤镜逻辑即可复用）
│   ├── base.png / out.png          # 8×8 前后对照
│   └── compare.png                 # 并排对比图
├── scripts/
│   ├── inspect_wasm.mjs            # 零依赖结构检查（零 import + 导出齐备）
│   ├── verify.sh                   # 端到端：安装 → 枚举 → 执行 → 通用断言
│   └── make_fixture.py             # 64×64 RGBA 测试图（四象限 + 渐变 + alpha 斜坡）
├── template/invert-rs/
│   ├── src/lib.rs                  # 上游官方示例
│   ├── Cargo.toml                  # 本文档补写，未编译验证
│   └── build.sh                    # 编译 + 复制 + 结构检查
└── .verify/                        # verify.sh 的工作目录（可随时删除）
```

## 附录 C · 事实来源速查

- 上游仓库：`github.com/storytold/photocraft`
- 插件规范：`docs/plugins.md`（对应 tag `v0.20.2`）
- 宿主实现：`crates/plugins/src/{manifest,runtime,apply}.rs`
- 命令实现：`crates/engine/src/cmd/plugin_cmds.rs`
- 菜单/UI：`crates/ui-egui/src/menus/plugin_ui.rs`
- 读源码的方式（本机 curl 被封）：`https://api.github.com/repos/storytold/photocraft/contents/<path>?ref=v0.20.2`，或 `https://raw.githubusercontent.com/storytold/photocraft/v0.20.2/<path>`，用 WebFetch 取文本
- 本机日志：`~/Library/Application Support/Photocraft/logs/photocraft.log`
- 本机偏好：`~/Library/Application Support/Photocraft/preferences.json`（插件项在顶层 `plugIns`）
