# ninepatch-cli

[![CI](https://github.com/midi-zeng/ninepatch-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/midi-zeng/ninepatch-cli/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ninepatch-cli.svg)](https://www.npmjs.com/package/ninepatch-cli)
[![license](https://img.shields.io/npm/l/ninepatch-cli.svg)](./LICENSE)

**Android 点九图（`.9.png`）命令行工具** —— 检测图片类型，并在点九图的两种形态之间互相转换：

- **源图（raw source）**：设计工具导出的原始格式，带 1px 黑色标示线
- **编译图（AAPT-compiled）**：APK 里真正的资源格式——标示线被剥离，信息存入 `npTc` / `npOl` / `npLb` PNG chunk

编译输出与真实 AAPT **逐字节一致**（`npTc`、`npOl` 均有真实 fixture 在 CI 中对比验证），反编译可完整还原标示线。
English documentation: [README.md](./README.md)。

```sh
$ ninepatch detect btn.9.png btn.png photo.jpg
btn.9.png   9patch-source (raw .9.png)   182x122
btn.png     9patch-compiled (AAPT, npTc) 180x120
photo.jpg   jpeg                         800x600
```

## 目录

- [安装](#安装)
- [CLI 参考](#cli-参考)
- [点九图的两种形态](#点九图的两种形态)
- [二进制格式参考](#二进制格式参考)
- [类型检测规则](#类型检测规则)
- [与 AAPT 的兼容性](#与-aapt-的兼容性)
- [编程 API](#编程-api)
- [常见问题](#常见问题)
- [生态](#生态)
- [开发](#开发)

## 安装

```sh
npm install -g ninepatch-cli      # 全局安装 CLI
npm install -D ninepatch-cli      # 项目依赖 / CI
npx ninepatch detect a.png        # 免安装试用
```

需要 Node.js >= 18。

## CLI 参考

```
$ ninepatch --help
Usage: ninepatch [options] [command]

Detect, compile and decompile Android nine-patch (.9.png) images.

Options:
  -V, --version                   print version
  -h, --help                      display help for command

Commands:
  detect [options] <files...>     detect the image type: 9patch-source /
                                  9patch-compiled / png / jpeg / ...
  info [options] <files...>       show nine-patch details (divs, padding,
                                  chunks, outline, layout bounds)
  compile [options] <files...>    compile a raw .9.png source into the
                                  AAPT-compiled format (strips the border, adds
                                  npTc/npOl/npLb)
  decompile [options] <files...>  decompile an AAPT-compiled nine-patch back
                                  into a raw .9.png source (rebuilds the guide
                                  borders)
  help [command]                  display help for command
```

（CLI 帮助文本为英文；各命令的中文说明见下文。）

### `detect` —— 检测图片类型

```sh
ninepatch detect <files...> [--json]
```

每个文件输出一种类型：`9patch-source`、`9patch-compiled`、`png`、`jpeg`、`gif`、`bmp`、`webp`、`unknown`（规则见[类型检测规则](#类型检测规则)）。

```sh
$ ninepatch detect --json btn.9.png btn.png
[
  {
    "file": "btn.9.png",
    "type": "9patch-source",
    "format": "png",
    "width": 182,
    "height": 122
  },
  {
    "file": "btn.png",
    "type": "9patch-compiled",
    "format": "png",
    "width": 180,
    "height": 120
  }
]
```

### `info` —— 查看九宫格详情

```sh
ninepatch info <files...> [--json]
```

```sh
$ ninepatch info btn.png
btn.png — 9patch-compiled (AAPT, npTc), 180x120
  chunks: IHDR(13) npOl(24) npTc(84) IDAT(8192) IDAT(7271) IEND(0)
  npTc: wasDeserialized=0 numXDivs=2 numYDivs=2 numColors=9
  stretch-x: [14, 29)
  stretch-y: [14, 29)
  padding: left=10 right=20 top=10 bottom=20
  npOl: insets [3, 3, 3, 3] radius=17.07 alpha=255
```

源图则由标示线计算出同样的字段；边框不合法会以 `error:` 列出，非致命问题以 `warning:` 列出。
拉伸区间为 **content 坐标系**下的半开区间 `[start, stop)`——与 AAPT 存进 `npTc` 的值完全一致。

### `compile` —— 源图 → 编译图

```sh
ninepatch compile <files...> [-o <path>] [--stdout]
```

剥离 1px 标示线并写入：

- `npTc` —— 拉伸区、padding、各区块实色提示
- `npOl` —— 圆角轮廓（insets / radius / alpha），与 AAPT 一样自动计算
- `npLb` —— 仅当源图存在红色 layout bounds 标记时写入

```sh
$ ninepatch compile btn_normal.9.png
compiled btn_normal.9.png -> btn_normal.png (180x120)
```

解析规则与 AAPT 完全一致，包括"底/右边无标记时从第一个拉伸区推断 padding"等行为。

### `decompile` —— 编译图 → 源图

```sh
ninepatch decompile <files...> [-o <path>] [--stdout]
```

依据 `npTc` 重建 1px 标示线（拉伸区 + padding 标记）、依据 `npLb` 重建红色 layout bounds 标记，并移除 `npTc/npOl/npLb` chunk。padding 始终物化为显式标记（即使编译图里是推断值），保证 反编译 → 再编译 逐字节稳定。

```sh
$ ninepatch decompile btn_compiled.png
decompiled btn_compiled.png -> btn_compiled.9.png (182x122)

# 通过管道输出而不是写文件
ninepatch compile btn.9.png --stdout > out.png
```

### 选项、命名规则与退出码

| 选项 | 适用于 | 说明 |
| --- | --- | --- |
| `-o, --output <path>` | `compile`、`decompile` | 输出文件（仅单文件输入） |
| `--stdout` | `compile`、`decompile` | PNG 二进制写入 stdout，日志走 stderr |
| `--json` | `detect`、`info` | 机器可读输出 |

输出名遵循 AAPT 约定：

| 命令 | 输入 | 输出 |
| --- | --- | --- |
| `compile` | `a.9.png` | `a.png`（去掉 `.9`） |
| `decompile` | `a.png` | `a.9.png`（补上 `.9`） |

若按约定推导出的输出名会覆盖输入（如编译 `a.png`），命令会报错并提示用 `-o`。多文件输入逐个处理，单个失败不影响其余文件。
退出码：`0` 成功，`1` 失败，`2` 用法错误。

## 点九图的两种形态

```
源图（182×122）                          编译图（180×120）
┌─────────────────────────┐              ┌───────────────────┐
│ ■■■ 黑线=横向拉伸区        │              │                   │
│                         │    aapt      │   内容像素         │
│                    □    │  ─────────►  │   + npTc chunk    │
│ □ 黑线=纵向拉伸区          │  ninepatch   │   + npOl chunk    │
│                         │   compile    │   (+ npLb)        │
│ ■■■ 黑线=横向 padding    │              └───────────────────┘
└─────────────────────────┘
   底/右边的红线 = layout bounds（npLb）
```

- 源图恰好比内容大 1px：上/左边框标记拉伸区，下/右边框标记 padding 范围，下/右边框上的红线标记 layout bounds。
- 编译剥离边框、把信息存入二进制 chunk；反编译反向还原。两个方向本工具都支持。

## 二进制格式参考

以下细节均与真实 AAPT 产物及 AOSP 源码（`frameworks/base/tools/aapt/Images.cpp`、`libs/androidfw/ResourceTypes.{h,cpp}`）逐字节核对过。

### npTc —— `Res_png_9patch`（32 字节头 + 数组）

| 偏移 | 大小 | 字段 | 端序 |
| --- | --- | --- | --- |
| 0 | 1 | `wasDeserialized` | —（文件中为 0，运行时置 1） |
| 1 | 1 | `numXDivs` | —（int32 值个数 = 区间数 × 2） |
| 2 | 1 | `numYDivs` | — |
| 3 | 1 | `numColors` | — |
| 4 | 4 | `xDivsOffset`（= 32） | **小端** |
| 8 | 4 | `yDivsOffset` | **小端** |
| 12 | 16 | `paddingLeft/Right/Top/Bottom` | **大端** |
| 28 | 4 | `colorsOffset` | **小端** |
| 32… | 4·n | `xDivs`、`yDivs`、`colors` | **大端** |

- divs 按 `(start, stop)` 成对存储——content 坐标系下的**半开区间** `[start, stop)`。源图边框第 `a..b` 位（1-based）的黑线对应 div `[a-1, b)`。
- `colors` 每个网格区块一条（`(numXDivs/2+1) × (numYDivs/2+1)`，贴边拉伸区会合并，总数 ≤ 127）：区块实色为 `0xAARRGGBB`，全透明为 `0x00000000`，混杂为 `0x00000001`（`NO_COLOR`）。
- 混合端序的来历：AAPT 写文件时偏移字段保持主机序（x86/ARM 均为小端），而 padding/divs/colors 经 `htonl` 变为大端。
- Android 4.1 之前的旧格式为 20 字节头（无偏移字段、全部小端）；`parseNpTcChunk` 两种都支持。

### npOl —— 自动生成的轮廓数据（24 字节，全小端）

| 偏移 | 大小 | 字段 |
| --- | --- | --- |
| 0 | 4×4 | 轮廓 insets left/top/right/bottom（uint32） |
| 16 | 4 | 圆角半径（float32，按 `fround(fround(3.4142)·inset)` 计算） |
| 20 | 4 | 轮廓 alpha（uint32，0–255） |

### npLb —— layout bounds（16 字节，小端 int32）

顺序：`left, top, right, bottom`（content 坐标系）。仅当源图下/右边框存在红线时写入。

### chunk 顺序

`IHDR → npOl → npLb（可选）→ npTc → IDAT… → IEND` —— 九宫格 chunk 紧跟 IHDR（aapt 注释原话："older platforms depend on the base 9 patch data being last"）。

## 类型检测规则

`9patch-compiled` 是精确的：PNG 含 `npTc` chunk 即是。`9patch-source` 是基于内容的启发式（AAPT 自身依赖 `.9.png` 文件名）：

- 角点像素全透明（或旧式白框模式：不透明白色）
- 边框像素均为透明、不透明黑、不透明红，或其他不透明色（与 aapt1 一致，视为标示线）
- 上边框与左边框各自至少有一条黑线

因此带黑色上/左边框的照片可能被误判——可用 `info` 核实。半透明的边框像素（普通图片抗锯齿的典型产物）会使启发式失效。非 PNG 类型按魔数识别，并尽力嗅探 JPEG/GIF/BMP/WebP 的宽高。

## 与 AAPT 的兼容性

- `npTc`、`npOl` 输出与真实 AAPT 产物逐字节一致（CI 中用 `orgin.png` ↔ `serialized.png` fixture 对验证）。
- 边框解析忠实移植 aapt1 的 `do_9patch`：标示线状态机、padding 推断、区块实色统计、白框模式、区块数 ≤ 127 限制等行为一致。
- 两处刻意差异：① 不透明但非黑/红的标示像素——aapt1 静默接受，本工具同样接受但打印 warning；② 输出 PNG 始终为 RGBA8——aapt 会尽量压缩为调色板/灰度色型，只影响体积不影响语义。

## 编程 API

```ts
import { detectImage, inspectImage, compileNinePatch, decompileNinePatch } from 'ninepatch-cli'
```

| 函数 | 说明 |
| --- | --- |
| `detectImage(buffer)` | → `{ type, format, width, height }` |
| `inspectImage(buffer)` | → 检测结果 + chunk 表 + 解析详情 + 校验错误 |
| `compileNinePatch(buffer)` | 源图 → 编译图；边框不合法抛 `NinePatchError` |
| `decompileNinePatch(buffer)` | 编译图 → 源图；缺少 `npTc` 时抛错 |

更底层的工具同样导出：

- `decodeRgbaPng` / `encodeRgbaPng` / `sniffDimensions` —— 像素编解码（基于 pngjs）
- `crc32`、`buildPngChunk`、`insertChunksAfterIhdr`、`removePngChunks` —— chunk 读写
- `packNpTcChunk` / `parseNpTcChunk`（新旧两种布局）、`packNpOlChunk` / `parseNpOlChunk`、`packNpLbChunk` / `parseNpLbChunk`
- `parseSourceNinePatch`、`looksLikeSourceNinePatch`、`getOutline`、`sectionColor`、`readTick`、`getHorizontalTicks`、`getVerticalTicks`、`getHorizontalLayoutBoundsTicks`、`getVerticalLayoutBoundsTicks` —— AAPT 边框算法
- `NinePatchError`、`TickType`、`NO_COLOR`、`TRANSPARENT_COLOR`

## 常见问题

**编译后的 PNG 为什么比 aapt 产出的大？**
输出始终为 RGBA8；aapt 会额外选择调色板/灰度色型。像素完全一致，只是容器不同。

**反编译出来的图底部/右侧多了标示线，原图明明没有？**
padding 始终物化为显式标记（原本是推断值时也写入推断结果），这样反编译 → 再编译能得到完全相同的 `npTc`。

**全透明像素的 RGB 为什么和 AAPT 输出不一样？**
alpha=0 时 RGB 不可见；AAPT 可能存 0。比较像素时应忽略全透明像素的 RGB（本仓库测试即如此）。

**能在 CI 里用吗？**
可以——`--json` 加退出码（`0/1/2`）专为脚本设计，例如构建前批量校验 `res/` 下所有 `*.9.png` 是否为合法源图。

## 生态

- [ninepatch-core](https://github.com/midi-zeng/ninepatch-core) —— 浏览器端点九图解析（npTc 读取 / 边框计算）
- [ninepatch-react](https://github.com/midi-zeng/ninepatch-react) —— React 点九图渲染组件
- [ninepatch-vue](https://github.com/midi-zeng/ninepatch-vue) —— Vue 3 点九图渲染组件

## 开发

```sh
pnpm install
pnpm run check   # oxlint + tsc --noEmit + vitest
pnpm run build   # tsc -> dist/
pnpm run test    # vitest（含真实 fixture 字节级对比测试）
```

发布：`pnpm run release`（bumpp + npm publish），或推送 `v*` tag 由 GitHub Actions 自动发布（需配置 `NPM_TOKEN` secret）。

## License

[ISC](./LICENSE)
