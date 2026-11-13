/**
 * Encoding/decoding of the AAPT nine-patch PNG chunks:
 *
 * - `npTc` — Res_png_9patch: flags, array offsets, padding, divs, colors.
 *   On disk the three offset fields are little-endian (they stay in host
 *   order after aapt's `deviceToFile()`), while paddings/divs/colors are
 *   big-endian (`htonl`). Layout verified byte-by-byte against a real
 *   AAPT-compiled fixture and `Res_png_9patch::serialize` in
 *   frameworks/base/libs/androidfw/ResourceTypes.cpp.
 * - `npOl` — auto-generated outline insets/radius/alpha, all little-endian.
 * - `npLb` — layout bounds (left, top, right, bottom), little-endian.
 */

import type { NinePatchDiv, NinePatchLayoutBounds, NinePatchOutline, NinePatchPadding } from './types.js'

/** Size of the npTc header: flags(4) + offsets(8) + padding(16) + colorsOffset(4) */
const NPTC_HEADER_SIZE = 32

export interface NpTcData {
  wasDeserialized: boolean
  numXDivs: number
  numYDivs: number
  numColors: number
  /** Half-open [start, stop) stretch regions in content coordinates */
  xDivs: NinePatchDiv[]
  yDivs: NinePatchDiv[]
  padding: NinePatchPadding
  colors: number[]
}

/**
 * Pack an `npTc` chunk payload exactly like `Res_png_9patch::serialize` +
 * `deviceToFile()` do.
 */
export function packNpTcChunk(
  xDivs: NinePatchDiv[],
  yDivs: NinePatchDiv[],
  padding: NinePatchPadding,
  colors: number[]
): Uint8Array {
  const numXDivs = xDivs.length * 2
  const numYDivs = yDivs.length * 2
  const numColors = colors.length
  if (numXDivs > 255 || numYDivs > 255 || numColors > 255) {
    throw new Error('too many divs or colors for the npTc chunk (uint8 counters)')
  }

  const size =
    NPTC_HEADER_SIZE + (numXDivs + numYDivs + numColors) * 4
  const buf = new Uint8Array(size)
  const view = new DataView(buf.buffer)

  buf[0] = 0 // wasDeserialized: 0 in the file, set to true at runtime
  buf[1] = numXDivs
  buf[2] = numYDivs
  buf[3] = numColors

  view.setUint32(4, NPTC_HEADER_SIZE, true)
  view.setUint32(8, NPTC_HEADER_SIZE + numXDivs * 4, true)
  view.setInt32(12, padding.left, false)
  view.setInt32(16, padding.right, false)
  view.setInt32(20, padding.top, false)
  view.setInt32(24, padding.bottom, false)
  view.setUint32(28, NPTC_HEADER_SIZE + (numXDivs + numYDivs) * 4, true)

  let pos = NPTC_HEADER_SIZE
  for (const div of xDivs) {
    view.setInt32(pos, div.start, false)
    view.setInt32(pos + 4, div.stop, false)
    pos += 8
  }
  for (const div of yDivs) {
    view.setInt32(pos, div.start, false)
    view.setInt32(pos + 4, div.stop, false)
    pos += 8
  }
  for (const color of colors) {
    view.setUint32(pos, color >>> 0, false)
    pos += 4
  }
  return buf
}

function readDivPairs(view: DataView, byteOffset: number, numValues: number, littleEndian: boolean): NinePatchDiv[] {
  const pairs: NinePatchDiv[] = []
  for (let i = 0; i + 1 < numValues; i += 2) {
    pairs.push({
      start: view.getInt32(byteOffset + i * 4, littleEndian),
      stop: view.getInt32(byteOffset + (i + 1) * 4, littleEndian)
    })
  }
  return pairs
}

/**
 * Parse an `npTc` chunk payload. Supports the modern layout (32-byte
 * header with offset fields, used since Android 4.1) and the legacy
 * layout (20-byte header, arrays immediately after, all little-endian).
 *
 * @throws when the chunk is truncated or has an inconsistent length
 */
export function parseNpTcChunk(data: Uint8Array): NpTcData {
  if (data.length < 20) {
    throw new Error(`npTc chunk is truncated (length ${data.length} < 20)`)
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const numXDivs = view.getUint8(1)
  const numYDivs = view.getUint8(2)
  const numColors = view.getUint8(3)

  // Layout selection by total length: the modern layout is exactly the
  // legacy layout plus the 12 bytes of offset fields. Classifying on
  // length (before reading any offset) is what keeps legacy files from
  // being misread through padding bytes that happen to look like offsets.
  const legacySize = 20 + (numXDivs + numYDivs + numColors) * 4
  if (data.length === legacySize) {
    return {
      wasDeserialized: view.getUint8(0) === 1,
      numXDivs,
      numYDivs,
      numColors,
      xDivs: readDivPairs(view, 20, numXDivs, true),
      yDivs: readDivPairs(view, 20 + numXDivs * 4, numYDivs, true),
      padding: {
        left: view.getInt32(4, true),
        right: view.getInt32(8, true),
        top: view.getInt32(12, true),
        bottom: view.getInt32(16, true)
      },
      colors: readColors(view, 20 + (numXDivs + numYDivs) * 4, numColors, true)
    }
  }

  if (data.length < NPTC_HEADER_SIZE) {
    throw new Error(`npTc chunk is truncated (length ${data.length} < ${NPTC_HEADER_SIZE})`)
  }

  const xDivsOffset = view.getUint32(4, true)
  const yDivsOffset = view.getUint32(8, true)
  const colorsOffset = view.getUint32(28, true)
  const isSane = (offset: number, size: number): boolean => offset > 0 && offset + size <= data.length
  if (!isSane(xDivsOffset, numXDivs * 4) || !isSane(yDivsOffset, numYDivs * 4)) {
    throw new Error('npTc chunk has invalid div offsets')
  }
  if (numColors > 0 && !isSane(colorsOffset, numColors * 4)) {
    throw new Error('npTc chunk has invalid colors offset')
  }

  return {
    wasDeserialized: view.getUint8(0) === 1,
    numXDivs,
    numYDivs,
    numColors,
    xDivs: readDivPairs(view, xDivsOffset, numXDivs, false),
    yDivs: readDivPairs(view, yDivsOffset, numYDivs, false),
    padding: {
      left: view.getInt32(12, false),
      right: view.getInt32(16, false),
      top: view.getInt32(20, false),
      bottom: view.getInt32(24, false)
    },
    colors: readColors(view, colorsOffset, numColors, false)
  }
}

function readColors(view: DataView, byteOffset: number, count: number, littleEndian: boolean): number[] {
  if (count <= 0) return []
  const colors: number[] = []
  for (let i = 0; i < count; i++) {
    colors.push(view.getUint32(byteOffset + i * 4, littleEndian))
  }
  return colors
}

/** Serialize the auto-generated outline data (`npOl`, 24 bytes, LE). */
export function packNpOlChunk(outline: NinePatchOutline): Uint8Array {
  const buf = new Uint8Array(24)
  const view = new DataView(buf.buffer)
  const [left, top, right, bottom] = outline.insets
  view.setUint32(0, left, true)
  view.setUint32(4, top, true)
  view.setUint32(8, right, true)
  view.setUint32(12, bottom, true)
  view.setFloat32(16, outline.radius, true)
  view.setUint32(20, outline.alpha, true)
  return buf
}

/** Parse an `npOl` chunk payload. */
export function parseNpOlChunk(data: Uint8Array): NinePatchOutline {
  if (data.length < 24) {
    throw new Error(`npOl chunk is truncated (length ${data.length} < 24)`)
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return {
    insets: [view.getUint32(0, true), view.getUint32(4, true), view.getUint32(8, true), view.getUint32(12, true)],
    radius: view.getFloat32(16, true),
    alpha: view.getUint32(20, true)
  }
}

/** Serialize layout bounds (`npLb`, 16 bytes LE, order: left/top/right/bottom). */
export function packNpLbChunk(bounds: NinePatchLayoutBounds): Uint8Array {
  const buf = new Uint8Array(16)
  const view = new DataView(buf.buffer)
  view.setInt32(0, bounds.left, true)
  view.setInt32(4, bounds.top, true)
  view.setInt32(8, bounds.right, true)
  view.setInt32(12, bounds.bottom, true)
  return buf
}

/** Parse an `npLb` chunk payload. */
export function parseNpLbChunk(data: Uint8Array): NinePatchLayoutBounds {
  if (data.length < 16) {
    throw new Error(`npLb chunk is truncated (length ${data.length} < 16)`)
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return {
    left: view.getInt32(0, true),
    top: view.getInt32(4, true),
    right: view.getInt32(8, true),
    bottom: view.getInt32(12, true)
  }
}
