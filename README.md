# ninepatch-cli

[![CI](https://github.com/midi-zeng/ninepatch-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/midi-zeng/ninepatch-cli/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ninepatch-cli.svg)](https://www.npmjs.com/package/ninepatch-cli)
[![license](https://img.shields.io/npm/l/ninepatch-cli.svg)](./LICENSE)

**点九图（.9.png）命令行工具** —— 检测图片类型，并在点九图的两种形态之间互相转换：

- **源图（raw / NotSerialized）**：带 1px 黑色标示线的 `.9.png`（设计工具导出的原始格式）
- **编译图（AAPT-compiled / Serialized）**：AAPT/aapt2 编译后的 PNG（标示线被剥离，信息存入 `npTc` / `npOl` / `npLb` chunk，即 APK 里真正的资源格式）

编译输出与真实 AAPT **逐字节一致**（npTc / npOl 均已对照真实 fixture 验证），反编译能完整还原标示线。

## 安装

```sh
npm install -g ninepatch-cli
# 或作为项目依赖
npm install -D ninepatch-cli
```

Node.js >= 18。

## CLI 用法

### detect —— 检测图片类型

```sh
$ ninepatch detect btn_normal.9.png btn_compiled.png photo.jpg
btn_normal.9.png  9patch-source (raw .9.png)   182x122
btn_compiled.png  9patch-compiled (AAPT, npTc) 180x120
photo.jpg         jpeg                         800x600
```

类型：`9patch-source`、`9patch-compiled`、`png`、`jpeg`、`gif`、`bmp`、`webp`、`unknown`。
加 `--json` 输出 JSON（适合脚本/CI）。

### info —— 查看九宫格详情

```sh
$ ninepatch info btn_compiled.png
btn_compiled.png — 9patch-compiled (AAPT, npTc), 180x120
  chunks: IHDR(13) npOl(24) npTc(84) IDAT(8192) IDAT(7271) IEND(0)
  npTc: wasDeserialized=0 numXDivs=2 numYDivs=2 numColors=9
  stretch-x: [14, 29)
  stretch-y: [14, 29)
  padding: left=10 right=20 top=10 bottom=20
  npOl: insets [3, 3, 3, 3] radius=17.07 alpha=255
```

对源图则会显示由标示线计算出的拉伸区间、padding、layout bounds（红线）等。
支持 `--json`。

### compile —— 源图 → 编译图

```sh
$ ninepatch compile btn_normal.9.png
compiled btn_normal.9.png -> btn_normal.png (180x120)
```

剥离 1px 标示线，写入 `npTc`（拉伸区 + padding + 区块颜色）、`npOl`（自动计算的圆角轮廓）、`npLb`（有红色 layout bounds 标记时）。
解析规则与 AAPT 完全一致（含“未标 padding 时从第一个拉伸区推断”等行为）。

### decompile —— 编译图 → 源图

```sh
$ ninepatch decompile btn_compiled.png
decompiled btn_compiled.png -> btn_compiled.9.png (182x122)
```

从 `npTc` 还原 1px 标示线（拉伸区、padding、红色 layout bounds），并移除 `npTc/npOl/npLb`。padding 始终物化为显式标记（原本由推断得到时也如此），保证重复编译结果稳定。

### 通用选项

| 选项 | 说明 |
| --- | --- |
| `-o, --output <path>` | 指定输出文件（仅单文件输入时可用） |
| `--stdout` | 结果写入 stdout（二进制），日志走 stderr |
| `--json` | `detect` / `info` 输出 JSON |

批量：`ninepatch compile assets/*.9.png`。输出名遵循 AAPT 约定：compile 去掉 `.9`（`a.9.png → a.png`），decompile 补上 `.9`（`a.png → a.9.png`）；无法按约定推导时（会覆盖输入）会报错提示用 `-o`。

退出码：`0` 成功，`1` 运行失败，`2` 用法错误。

## 点九图两种形态

```
源图（182×122）                       编译图（180×120）
┌─────────────────────┐               ┌───────────────────┐
│ ▪▪▪ 黑线=横向拉伸区   │               │                   │
│                     │  aapt compile │   内容 + npTc      │
│                □    │  ───────────► │   chunk           │
│ □黑线=纵向拉伸区      │               │                   │
│ ▪▪▪ 黑线=横向 padding│               └───────────────────┘
└─────────────────────┘
   npTc: 拉伸区/padding/区块颜色
   npOl: 自动生成的轮廓 (insets/radius/alpha)
   npLb: 红线标示的 layout bounds（可选）
```

## 编程 API

```ts
import { detectImage, inspectImage, compileNinePatch, decompileNinePatch } from 'ninepatch-cli'
import { readFileSync } from 'node:fs'

const buf = new Uint8Array(readFileSync('btn.9.png'))

detectImage(buf)
// { type: '9patch-source', format: 'png', width: 182, height: 122 }

inspectImage(buf)
// 拉伸区、padding、chunk 表等完整信息

const compiled = compileNinePatch(buf)   // 源图 → 编译图
const source = decompileNinePatch(compiled.data)  // 编译图 → 源图
```

底层 chunk 编解码也可独立使用：`packNpTcChunk` / `parseNpTcChunk`（含旧版 20 字节头布局）、`packNpOlChunk` / `packNpLbChunk` 等。

## 与 AAPT 的兼容性

- npTc 布局（32 字节头：LE 偏移字段 + BE padding/divs/colors）依据 `Res_png_9patch::serialize` + `deviceToFile()` 实现，并与真实 AAPT 编译产物**逐字节比对通过**；npOl 的 float 半径按 C float 语义（`fround`）计算，同样逐字节一致。
- 解析兼容旧版 20 字节头的 npTc（Android 4.1 之前）。
- 编译规则忠实移植 aapt1 `Images.cpp`：`do_9patch` 状态机、padding 推断、区块实色统计（`NO_COLOR` / `TRANSPARENT_COLOR`）、白框模式、区块数 ≤ 127 等。
- 与 aapt1 的两处刻意差异：① 不透明但非黑/红的标示像素：aapt1 静默当作黑线处理，本工具同样接受但会打印 warning；② 输出 PNG 始终为 RGBA8（aapt 会做调色板/灰度压缩优化，不影响语义）。
- 检测说明：`9patch-source` 依据内容启发式判断（边框只含透明/黑/红 + 双轴有拉伸线），与 aapt 依赖 `.9.png` 文件名的方式不同；极端情况下普通图片可能被误判，可用 `info` 核实。

## 生态

- [ninepatch-core](https://github.com/midi-zeng/ninepatch-core) —— 浏览器端点九图解析（npTc 读取/边框计算）
- [ninepatch-react](https://github.com/midi-zeng/ninepatch-react) —— React 点九图渲染组件
- [ninepatch-vue](https://github.com/midi-zeng/ninepatch-vue) —— Vue 点九图渲染组件

## 开发

```sh
pnpm install
pnpm run check   # lint + typecheck + test
pnpm run build   # tsc -> dist/
pnpm run test    # vitest（含真实 AAPT fixture 的字节级对比测试）
```

发布：`pnpm run release`（bumpp + npm publish），或打 `v*` tag 由 GitHub Actions 自动发布（需配置 `NPM_TOKEN` secret）。

## License

[ISC](./LICENSE)
