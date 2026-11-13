# ninepatch-cli

[![CI](https://github.com/midi-zeng/ninepatch-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/midi-zeng/ninepatch-cli/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ninepatch-cli.svg)](https://www.npmjs.com/package/ninepatch-cli)
[![license](https://img.shields.io/npm/l/ninepatch-cli.svg)](./LICENSE)

**CLI for Android nine-patch (`.9.png`) images** — detect image types and convert
nine-patches between their two flavors:

- **Raw source** — the designer format with 1px black guide borders
- **AAPT-compiled** — what actually ships inside APKs: the borders are stripped
  and the information is packed into the `npTc` / `npOl` / `npLb` PNG chunks

The compiled output is **byte-for-byte identical to real AAPT** (both `npTc` and
`npOl` are verified against real AAPT fixtures in CI), and decompiling fully
restores the guide borders. 简体中文文档见 [README.zh-CN.md](./README.zh-CN.md)。

```sh
$ ninepatch detect btn.9.png btn.png photo.jpg
btn.9.png   9patch-source (raw .9.png)   182x122
btn.png     9patch-compiled (AAPT, npTc) 180x120
photo.jpg   jpeg                         800x600
```

## Table of contents

- [Installation](#installation)
- [CLI reference](#cli-reference)
  - [`detect`](#detect)
  - [`info`](#info)
  - [`compile`](#compile)
  - [`decompile`](#decompile)
  - [Options, naming and exit codes](#options-naming-and-exit-codes)
- [The two nine-patch flavors](#the-two-nine-patch-flavors)
- [Binary format reference](#binary-format-reference)
- [Detection heuristics](#detection-heuristics)
- [AAPT compatibility notes](#aapt-compatibility-notes)
- [Programmatic API](#programmatic-api)
- [FAQ](#faq)
- [Ecosystem](#ecosystem)
- [Development](#development)

## Installation

```sh
npm install -g ninepatch-cli      # global CLI
npm install -D ninepatch-cli      # dev dependency / CI
npx ninepatch detect a.png        # one-off
```

Requires Node.js >= 18.

## CLI reference

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

### `detect`

```sh
ninepatch detect <files...> [--json]
```

Reports one type per file: `9patch-source`, `9patch-compiled`, `png`, `jpeg`,
`gif`, `bmp`, `webp` or `unknown` (see [Detection heuristics](#detection-heuristics)).

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

### `info`

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

For a raw source, the same fields are computed from the guide borders; invalid
borders are listed as `error:` lines and non-fatal observations as `warning:`
lines. Stretch regions are half-open `[start, stop)` intervals in content
coordinates — the same values AAPT stores in `npTc`.

### `compile`

```sh
ninepatch compile <files...> [-o <path>] [--stdout]
```

Strips the 1px guide border and writes:

- `npTc` — stretch regions, padding and per-section solid-color hints
- `npOl` — round-rect outline (insets / radius / alpha), auto-computed like AAPT
- `npLb` — layout bounds, only when red markers are present

```sh
$ ninepatch compile btn_normal.9.png
compiled btn_normal.9.png -> btn_normal.png (180x120)
```

Parsing follows AAPT exactly, including padding inference from the first
stretch region when the bottom/right borders carry no markers.

### `decompile`

```sh
ninepatch decompile <files...> [-o <path>] [--stdout]
```

Rebuilds the 1px guide borders from `npTc` (stretch + padding markers) and
`npLb` (red layout-bound markers), then drops the `npTc`/`npOl`/`npLb` chunks.
Padding is always materialized as explicit markers (even when the compiled
image had inferred ones), so decompile → compile is byte-stable.

```sh
$ ninepatch decompile btn_compiled.png
decompiled btn_compiled.png -> btn_compiled.9.png (182x122)

# pipe instead of writing a file
ninepatch compile btn.9.png --stdout > out.png
```

### Options, naming and exit codes

| Option | Applies to | Description |
| --- | --- | --- |
| `-o, --output <path>` | `compile`, `decompile` | Output file (single input only) |
| `--stdout` | `compile`, `decompile` | Write the PNG binary to stdout; logs go to stderr |
| `--json` | `detect`, `info` | Machine-readable output |

Output names follow the AAPT convention:

| Command | Input | Output |
| --- | --- | --- |
| `compile` | `a.9.png` | `a.png` (`.9` stripped) |
| `decompile` | `a.png` | `a.9.png` (`.9` inserted) |

When the conventional name would overwrite the input (e.g. compiling `a.png`),
the command fails and asks for `-o`. Multiple inputs are processed one by one;
a failing file does not stop the others. Exit codes: `0` success, `1` failure,
`2` usage error.

## The two nine-patch flavors

```
Raw source (182×122)                     AAPT-compiled (180×120)
┌─────────────────────────┐              ┌───────────────────┐
│ ■■■ black = x-stretch    │              │                   │
│                         │    aapt      │   content pixels  │
│                    □    │  ─────────►  │   + npTc chunk    │
│ □ black = y-stretch     │  ninepatch   │   + npOl chunk    │
│                         │   compile    │   (+ npLb)        │
│ ■■■ black = x-padding   │              └───────────────────┘
└─────────────────────────┘
   red markers on bottom/right = layout bounds (npLb)
```

- The source image is exactly 1px wider and taller than the content; the top
  and left borders mark stretchable regions, the bottom and right borders mark
  the padding box, and red runs on the bottom/right mark layout bounds.
- Compiling removes the border and stores everything in binary chunks;
  decompiling restores it. Both directions are provided by this CLI.

## Binary format reference

All details below were verified byte-by-byte against real AAPT output and the
AOSP sources (`frameworks/base/tools/aapt/Images.cpp`,
`libs/androidfw/ResourceTypes.{h,cpp}`).

### npTc — `Res_png_9patch` (32-byte header + arrays)

| Offset | Size | Field | Endianness |
| --- | --- | --- | --- |
| 0 | 1 | `wasDeserialized` | — (0 on disk; set at runtime) |
| 1 | 1 | `numXDivs` | — (count of int32 values, pairs × 2) |
| 2 | 1 | `numYDivs` | — |
| 3 | 1 | `numColors` | — |
| 4 | 4 | `xDivsOffset` (= 32) | **little** |
| 8 | 4 | `yDivsOffset` | **little** |
| 12 | 16 | `paddingLeft/Right/Top/Bottom` | **big** |
| 28 | 4 | `colorsOffset` | **little** |
| 32… | 4·n | `xDivs`, `yDivs`, `colors` | **big** |

- Divs are stored as `(start, stop)` pairs — **half-open** `[start, stop)`
  intervals in **content coordinates** (the border already stripped). A black
  run at source border positions `a..b` becomes the div `[a-1, b)`.
- `colors` holds one entry per grid section (`(numXDivs/2+1) × (numYDivs/2+1)`,
  adjusted for edge-anchored regions, max 127): the section's solid color as
  `0xAARRGGBB`, `0x00000000` when fully transparent, `0x00000001` (`NO_COLOR`)
  when mixed.
- The unusual endianness comes from AAPT: offsets are written in host order and
  survive `deviceToFile()`, while paddings/divs/colors go through `htonl`.
- Pre-Android-4.1 files use a 20-byte header (no offset fields, all
  little-endian); `parseNpTcChunk` accepts both.

### npOl — auto-generated outline (24 bytes, all little-endian)

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 4×4 | outline insets left/top/right/bottom (uint32) |
| 16 | 4 | corner radius (float32, computed as `fround(fround(3.4142)·inset)`) |
| 20 | 4 | outline alpha (uint32, 0–255) |

### npLb — layout bounds (16 bytes, little-endian int32)

Order: `left, top, right, bottom` (in content coordinates). Present only when
the source had red markers on the bottom row / right column.

### Chunk order

`IHDR → npOl → npLb (optional) → npTc → IDAT… → IEND` — the nine-patch chunks
sit right after IHDR ("older platforms depend on the base 9 patch data being
last", as the aapt comment puts it).

## Detection heuristics

`9patch-compiled` is precise: a PNG with an `npTc` chunk. `9patch-source` is a
content-based heuristic (AAPT itself relies on the `.9.png` filename):

- the corner pixel is fully transparent (or, for the legacy white-frame mode,
  opaque white)
- every border pixel is transparent, opaque black, opaque red, or another
  opaque color (treated as a marker, same as aapt1)
- the top row and the left column each carry at least one black run

A photo with a black top/left border can therefore be misdetected — use
`info` to verify. Semi-transparent border pixels (typical antialiasing
artifacts on ordinary images) disqualify the heuristic. Non-PNG types are
detected by magic bytes, with best-effort dimension sniffing for
JPEG/GIF/BMP/WebP.

## AAPT compatibility notes

- `npTc` and `npOl` output is byte-identical to real AAPT fixtures (tested in
  CI with the fixture pair `orgin.png` ↔ `serialized.png`).
- The border parser is a faithful port of aapt1's `do_9patch`: the tick state
  machine, padding inference, section color analysis, the white-frame mode and
  the 127-section limit all behave the same.
- Two deliberate deviations: ① opaque markers that are neither black nor red
  are accepted with a warning (aapt1 accepted them silently); ② output PNGs are
  always RGBA8 — aapt additionally compacts to palette/gray when possible,
  which changes file size but not semantics.

## Programmatic API

```ts
import { detectImage, inspectImage, compileNinePatch, decompileNinePatch } from 'ninepatch-cli'
```

| Function | Description |
| --- | --- |
| `detectImage(buffer)` | → `{ type, format, width, height }` |
| `inspectImage(buffer)` | → detection + chunk table + parsed source/compiled details + validation errors |
| `compileNinePatch(buffer)` | raw source → compiled PNG; throws `NinePatchError` on invalid borders |
| `decompileNinePatch(buffer)` | compiled PNG → raw source; throws when `npTc` is missing |

Lower-level helpers are exported as well:

- `decodeRgbaPng` / `encodeRgbaPng` / `sniffDimensions` — pixel codec (pngjs)
- `crc32`, `buildPngChunk`, `insertChunksAfterIhdr`, `removePngChunks` — chunk plumbing
- `packNpTcChunk` / `parseNpTcChunk` (modern + legacy), `packNpOlChunk` /
  `parseNpOlChunk`, `packNpLbChunk` / `parseNpLbChunk`
- `parseSourceNinePatch`, `looksLikeSourceNinePatch`, `getOutline`,
  `sectionColor`, `readTick`, `getHorizontalTicks`, `getVerticalTicks`,
  `getHorizontalLayoutBoundsTicks`, `getVerticalLayoutBoundsTicks` — the AAPT
  border algorithms
- `NinePatchError`, `TickType`, `NO_COLOR`, `TRANSPARENT_COLOR`

## FAQ

**Why is the compiled PNG larger than what aapt produces?**
Output is always RGBA8; aapt additionally picks palette/gray color types when
possible. Pixels are identical, only the container differs.

**Why does the decompiled image have padding markers even though the original
didn't?**
Padding is always materialized explicitly (using AAPT's inferred values when
there were none), so recompiling the decompiled image reproduces the exact
same `npTc`.

**Why do fully-transparent pixels have different RGB values than AAPT's
output?**
RGB under alpha=0 is invisible; AAPT may store zeros there. Pixel comparison
should be alpha-aware (as this repo's tests are).

**Can I use this in CI?**
Yes — `--json` plus exit codes (`0/1/2`) are designed for scripts, e.g. to
verify that every `*.9.png` in `res/` is a valid source before a build.

## Ecosystem

- [ninepatch-core](https://github.com/midi-zeng/ninepatch-core) — browser-side
  nine-patch parsing (npTc reading / border computation)
- [ninepatch-react](https://github.com/midi-zeng/ninepatch-react) — React
  nine-patch rendering component
- [ninepatch-vue](https://github.com/midi-zeng/ninepatch-vue) — Vue 3 nine-patch
  rendering component

## Development

```sh
pnpm install
pnpm run check   # oxlint + tsc --noEmit + vitest
pnpm run build   # tsc -> dist/
pnpm run test    # vitest (includes byte-level fixture comparisons)
```

Release: `pnpm run release` (bumpp + npm publish), or push a `v*` tag to let
GitHub Actions publish with provenance (requires the `NPM_TOKEN` secret).

## License

[ISC](./LICENSE)
