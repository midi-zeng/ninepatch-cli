/**
 * High-level nine-patch API: type detection, inspection, and the two
 * conversion directions (compile = source -> AAPT format, decompile =
 * AAPT format -> source).
 */

import {
  detectImageFormat,
  extractPngChunks,
  findPngChunk,
  getImageProperty,
  ImageFormat,
  NINE_PATCH_CHUNK_NAME
} from 'ninepatch-core'
import { decodeRgbaPng, encodeRgbaPng, sniffDimensions } from './codec.js'
import { insertChunksAfterIhdr } from './chunks.js'
import { looksLikeSourceNinePatch, parseSourceNinePatch } from './borders.js'
import { packNpLbChunk, packNpOlChunk, packNpTcChunk, parseNpLbChunk, parseNpOlChunk, parseNpTcChunk } from './npchunks.js'
import type {
  CompileResult,
  DecompileResult,
  Detection,
  ImageType,
  Inspection,
  SourceNinePatchInfo
} from './types.js'

const BLACK_PIXEL = [0, 0, 0, 255] as const
const RED_PIXEL = [255, 0, 0, 255] as const

const NP_OL_CHUNK = 'npOl'
const NP_LB_CHUNK = 'npLb'

/** Detect the type of an image buffer (nine-patch source / compiled / other). */
export function detectImage(buffer: Uint8Array): Detection {
  const bytes = new Uint8Array(buffer)
  const format = detectImageFormat(bytes)

  if (format === ImageFormat.PNG) {
    const property = getImageProperty(toArrayBuffer(bytes))
    let type: ImageType = 'png'
    try {
      const chunks = extractPngChunks(bytes)
      if (findPngChunk(chunks, NINE_PATCH_CHUNK_NAME)) {
        type = '9patch-compiled'
      } else if (property.width > 0 && property.height > 0) {
        const decoded = decodeRgbaPng(bytes)
        if (looksLikeSourceNinePatch(decoded.pixels, decoded.width, decoded.height)) {
          type = '9patch-source'
        }
      }
    } catch {
      // unreadable pixel data: fall back to plain `png`
    }
    return { type, format: 'png', width: property.width, height: property.height }
  }

  const dims = sniffDimensions(bytes)
  return {
    type: format === ImageFormat.UNKNOWN ? 'unknown' : format,
    format,
    width: dims.width,
    height: dims.height
  }
}

/** Deep-inspect an image: detection, chunk table and nine-patch details. */
export function inspectImage(buffer: Uint8Array): Inspection {
  const bytes = new Uint8Array(buffer)
  const detection = detectImage(bytes)
  const inspection: Inspection = { detection, chunks: [] }

  if (detection.format !== 'png') {
    return inspection
  }

  let chunks
  try {
    chunks = extractPngChunks(bytes)
  } catch (error) {
    inspection.errors = [error instanceof Error ? error.message : String(error)]
    return inspection
  }
  inspection.chunks = chunks.map(chunk => ({ name: chunk.name, size: chunk.data.length }))

  if (detection.type === '9patch-compiled') {
    const npTc = findPngChunk(chunks, NINE_PATCH_CHUNK_NAME)
    if (npTc) {
      const patch = parseNpTcChunk(npTc.data)
      inspection.compiled = {
        width: detection.width,
        height: detection.height,
        npTc: {
          wasDeserialized: patch.wasDeserialized,
          numXDivs: patch.numXDivs,
          numYDivs: patch.numYDivs,
          numColors: patch.numColors,
          xDivs: patch.xDivs,
          yDivs: patch.yDivs,
          padding: patch.padding
        }
      }
      const npOl = findPngChunk(chunks, NP_OL_CHUNK)
      if (npOl) {
        try {
          inspection.compiled.npOl = parseNpOlChunk(npOl.data)
        } catch {
          // keep info incomplete rather than failing the whole inspection
        }
      }
      const npLb = findPngChunk(chunks, NP_LB_CHUNK)
      if (npLb) {
        try {
          inspection.compiled.npLb = parseNpLbChunk(npLb.data)
        } catch {
          // ditto
        }
      }
    }
    return inspection
  }

  if (detection.type === '9patch-source') {
    try {
      const decoded = decodeRgbaPng(bytes)
      inspection.source = toSourceInfo(parseSourceNinePatch(decoded.pixels, decoded.width, decoded.height))
    } catch (error) {
      inspection.errors =
        error instanceof Error && error.name === 'NinePatchError'
          ? [error.message]
          : [error instanceof Error ? error.message : String(error)]
    }
  }

  return inspection
}

/** Compile a raw nine-patch source into the AAPT-compiled PNG format. */
export function compileNinePatch(buffer: Uint8Array): CompileResult {
  const bytes = new Uint8Array(buffer)
  if (detectImageFormat(bytes) !== ImageFormat.PNG) {
    throw new Error('compile expects a PNG image')
  }
  const decoded = decodeRgbaPng(bytes)
  const parsed = parseSourceNinePatch(decoded.pixels, decoded.width, decoded.height)

  const npTc = packNpTcChunk(parsed.xDivs, parsed.yDivs, parsed.padding, parsed.colors)
  const npOl = packNpOlChunk(parsed.outline)
  const chunks = [{ name: NP_OL_CHUNK, data: npOl }]
  if (parsed.layoutBounds) {
    chunks.push({ name: NP_LB_CHUNK, data: packNpLbChunk(parsed.layoutBounds) })
  }
  chunks.push({ name: NINE_PATCH_CHUNK_NAME, data: npTc })

  const base = encodeRgbaPng(parsed.contentWidth, parsed.contentHeight, parsed.content)
  const data = insertChunksAfterIhdr(base, chunks)

  return {
    data,
    width: parsed.contentWidth,
    height: parsed.contentHeight,
    npTcSize: npTc.length,
    hasNpOl: true,
    hasNpLb: parsed.layoutBounds !== undefined,
    warnings: parsed.warnings
  }
}

/**
 * Decompile an AAPT-compiled nine-patch back into a raw source image
 * (1px guide borders, no npTc/npOl/npLb chunks).
 *
 * Padding is always materialized as explicit bottom/right markers; when
 * the compiled image had none, AAPT's inferred values (from the first
 * stretch region) are written out instead, keeping recompiles stable.
 */
export function decompileNinePatch(buffer: Uint8Array): DecompileResult {
  const bytes = new Uint8Array(buffer)
  if (detectImageFormat(bytes) !== ImageFormat.PNG) {
    throw new Error('decompile expects a PNG image')
  }
  const chunks = extractPngChunks(bytes)
  const npTc = findPngChunk(chunks, NINE_PATCH_CHUNK_NAME)
  if (!npTc) {
    throw new Error('no npTc chunk found; not an AAPT-compiled nine-patch image')
  }
  const patch = parseNpTcChunk(npTc.data)

  const content = decodeRgbaPng(bytes)
  const width = content.width
  const height = content.height
  const outWidth = width + 2
  const outHeight = height + 2
  const pixels = new Uint8ClampedArray(outWidth * outHeight * 4)

  const setPixel = (x: number, y: number, rgba: readonly number[]): void => {
    const o = (y * outWidth + x) * 4
    pixels[o] = rgba[0]!
    pixels[o + 1] = rgba[1]!
    pixels[o + 2] = rgba[2]!
    pixels[o + 3] = rgba[3]!
  }
  const isTransparent = (x: number, y: number): boolean => pixels[(y * outWidth + x) * 4 + 3] === 0

  // Content starts at (1, 1)
  for (let y = 0; y < height; y++) {
    pixels.set(
      content.pixels.subarray(y * width * 4, (y + 1) * width * 4),
      ((y + 1) * outWidth + 1) * 4
    )
  }

  // Stretch markers: black runs on the top row / left column
  const drawRunRow = (row: number, from: number, to: number, rgba: readonly number[], onlyTransparent: boolean): void => {
    for (let x = from; x <= to; x++) {
      if (!onlyTransparent || isTransparent(x, row)) setPixel(x, row, rgba)
    }
  }
  const drawRunColumn = (col: number, from: number, to: number, rgba: readonly number[], onlyTransparent: boolean): void => {
    for (let y = from; y <= to; y++) {
      if (!onlyTransparent || isTransparent(col, y)) setPixel(col, y, rgba)
    }
  }

  for (const div of patch.xDivs) {
    drawRunRow(0, Math.max(1, div.start + 1), Math.min(width, div.stop), BLACK_PIXEL, false)
  }
  for (const div of patch.yDivs) {
    drawRunColumn(0, Math.max(1, div.start + 1), Math.min(height, div.stop), BLACK_PIXEL, false)
  }

  // Padding markers: black runs on the bottom row / right column
  const padFromX = Math.max(1, patch.padding.left + 1)
  const padToX = Math.min(width, width - patch.padding.right)
  if (padFromX <= padToX) {
    drawRunRow(outHeight - 1, padFromX, padToX, BLACK_PIXEL, false)
  }
  const padFromY = Math.max(1, patch.padding.top + 1)
  const padToY = Math.min(height, height - patch.padding.bottom)
  if (padFromY <= padToY) {
    drawRunColumn(outWidth - 1, padFromY, padToY, BLACK_PIXEL, false)
  }

  // Layout bounds: red markers at the ends of the bottom row / right column
  try {
    const npLb = findPngChunk(chunks, NP_LB_CHUNK)
    if (npLb) {
      const bounds = parseNpLbChunk(npLb.data)
      if (bounds.left > 0) drawRunRow(outHeight - 1, 1, Math.min(width, bounds.left), RED_PIXEL, true)
      if (bounds.right > 0) drawRunRow(outHeight - 1, Math.max(1, width - bounds.right + 1), width, RED_PIXEL, true)
      if (bounds.top > 0) drawRunColumn(outWidth - 1, 1, Math.min(height, bounds.top), RED_PIXEL, true)
      if (bounds.bottom > 0) drawRunColumn(outWidth - 1, Math.max(1, height - bounds.bottom + 1), height, RED_PIXEL, true)
    }
  } catch {
    // unparsable npLb: skip the red markers, the stretch/padding data stays intact
  }

  return { data: encodeRgbaPng(outWidth, outHeight, pixels), width: outWidth, height: outHeight }
}

function toSourceInfo(parsed: ReturnType<typeof parseSourceNinePatch>): SourceNinePatchInfo {
  return {
    width: parsed.width,
    height: parsed.height,
    contentWidth: parsed.contentWidth,
    contentHeight: parsed.contentHeight,
    xDivs: parsed.xDivs,
    yDivs: parsed.yDivs,
    padding: parsed.padding,
    layoutBounds: parsed.layoutBounds,
    outline: parsed.outline,
    colors: parsed.colors,
    warnings: parsed.warnings
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer
}
