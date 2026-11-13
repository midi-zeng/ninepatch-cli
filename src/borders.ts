/**
 * AAPT-faithful parsing of raw nine-patch source borders.
 *
 * Ported from `frameworks/base/tools/aapt/Images.cpp` (`do_9patch`,
 * `get_horizontal_ticks`, `get_vertical_ticks`, `*_layout_bounds_ticks`,
 * `get_outline`, `get_color`) so that compiled output matches what AAPT
 * itself would produce.
 *
 * Terminology:
 * - "source coordinates" refer to the image WITH the 1px guide border
 * - "content coordinates" refer to the image after stripping the border
 *   (source x = content x + 1)
 */

import type { NinePatchDiv, NinePatchLayoutBounds, NinePatchOutline, NinePatchPadding } from './types.js'

export const TRANSPARENT_COLOR = 0x00000000
export const NO_COLOR = 0x00000001

/** Pixel classification on a guide border. */
export enum TickType {
  None = 0,
  Tick = 1,
  LayoutBounds = 2
}

export interface TickRead {
  type: TickType
  /** Set when the pixel violates the nine-patch border rules */
  error?: string
}

function isOpaqueRed(r: number, g: number, b: number, a: number): boolean {
  return a === 255 && r === 255 && g === 0 && b === 0
}

function isOpaqueBlack(r: number, g: number, b: number, a: number): boolean {
  return a === 255 && r === 0 && g === 0 && b === 0
}

/**
 * Classify one border pixel. `transparent` mirrors AAPT: the corner pixel
 * (0,0) decides the frame mode (transparent frame vs. legacy white frame).
 *
 * Deviation from aapt1: an opaque pixel that is neither black nor red would
 * still be accepted as a tick by old aapt (its error string was silently
 * dropped); we keep it a tick but surface a warning instead.
 */
export function readTick(pixels: Uint8ClampedArray, pixelIndex: number, transparent: boolean): TickRead {
  const o = pixelIndex * 4
  const r = pixels[o]!
  const g = pixels[o + 1]!
  const b = pixels[o + 2]!
  const a = pixels[o + 3]!

  if (transparent) {
    if (a === 0) return { type: TickType.None }
    if (isOpaqueRed(r, g, b, a)) return { type: TickType.LayoutBounds }
    if (isOpaqueBlack(r, g, b, a)) return { type: TickType.Tick }
    if (a !== 255) {
      return { type: TickType.None, error: 'Frame pixels must be either solid or transparent (not intermediate alphas)' }
    }
    if (r !== 0 || g !== 0 || b !== 0) {
      return { type: TickType.Tick, error: 'Ticks in transparent frame must be black or red' }
    }
    return { type: TickType.Tick }
  }

  if (a !== 255) {
    return { type: TickType.None, error: 'White frame must be a solid color (no alpha)' }
  }
  if (r === 255 && g === 255 && b === 255) return { type: TickType.None }
  if (isOpaqueBlack(r, g, b, a)) return { type: TickType.Tick }
  if (isOpaqueRed(r, g, b, a)) return { type: TickType.LayoutBounds }
  return { type: TickType.Tick, error: 'Ticks in white frame must be black or red' }
}

export interface TickParseResult {
  /** Stretchable regions as [start, stop) in content coordinates */
  pairs: NinePatchDiv[]
  error?: { message: string; pixel: number }
  warnings: string[]
}

const STATE_START = 0
const STATE_INSIDE = 1
const STATE_OUTSIDE = 2

/**
 * Port of `get_horizontal_ticks`: walk one border row (y in source coords)
 * and collect black-marker runs. `multipleAllowed` is true for stretch
 * edges, false for the padding edges (at most one run).
 */
export function getHorizontalTicks(
  pixels: Uint8ClampedArray,
  width: number,
  y: number,
  transparent: boolean,
  options: { required: boolean; multipleAllowed: boolean }
): TickParseResult {
  return walkTicks(width - 2, options, i => readTick(pixels, y * width + i, transparent))
}

/**
 * Port of `get_vertical_ticks`: walk one border column (x in source coords).
 */
export function getVerticalTicks(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  transparent: boolean,
  options: { required: boolean; multipleAllowed: boolean }
): TickParseResult {
  return walkTicks(height - 2, options, i => readTick(pixels, i * width + x, transparent))
}

function walkTicks(
  count: number,
  options: { required: boolean; multipleAllowed: boolean },
  tickAt: (index: number) => TickRead
): TickParseResult {
  const result: TickParseResult = { pairs: [], warnings: [] }
  let state = STATE_START
  let start = -1
  let stop = -1
  // `i` walks the stripped border (source positions 1..count), so the
  // stored div values (i-1) are already content coordinates.
  for (let i = 1; i <= count; i++) {
    const tick = tickAt(i)
    if (tick.error) {
      if (tick.type === TickType.None) {
        return { pairs: [], error: { message: tick.error, pixel: i }, warnings: result.warnings }
      }
      result.warnings.push(`${tick.error} (border position ${i})`)
    }
    if (tick.type === TickType.Tick) {
      if (state === STATE_START || (state === STATE_OUTSIDE && options.multipleAllowed)) {
        start = i - 1
        stop = count // sentinel, overwritten when the run ends
        state = STATE_INSIDE
      } else if (state === STATE_OUTSIDE) {
        return {
          pairs: [],
          error: { message: "Can't have more than one marked region along edge", pixel: i },
          warnings: result.warnings
        }
      }
    } else if (state === STATE_INSIDE) {
      stop = i - 1
      result.pairs.push({ start, stop })
      state = STATE_OUTSIDE
    }
  }
  if (state === STATE_INSIDE) {
    result.pairs.push({ start, stop })
  }
  if (options.required && result.pairs.length === 0) {
    return { pairs: [], error: { message: 'No marked region found along edge', pixel: -1 }, warnings: result.warnings }
  }
  return result
}

/**
 * Port of `get_horizontal_layout_bounds_ticks`: red markers on the BOTTOM
 * row, counted inward from both ends, define left/right layout bounds.
 */
export function getHorizontalLayoutBoundsTicks(
  pixels: Uint8ClampedArray,
  width: number,
  y: number,
  transparent: boolean
): { left: number; right: number } {
  let left = 0
  if (readTick(pixels, y * width + 1, transparent).type === TickType.LayoutBounds) {
    let i = 1
    while (i < width - 1) {
      left++
      i++
      if (readTick(pixels, y * width + i, transparent).type !== TickType.LayoutBounds) break
    }
  }
  let right = 0
  if (readTick(pixels, y * width + (width - 2), transparent).type === TickType.LayoutBounds) {
    let i = width - 2
    while (i > 1) {
      right++
      i--
      if (readTick(pixels, y * width + i, transparent).type !== TickType.LayoutBounds) break
    }
  }
  return { left, right }
}

/**
 * Port of `get_vertical_layout_bounds_ticks`: red markers on the RIGHT
 * column define top/bottom layout bounds.
 */
export function getVerticalLayoutBoundsTicks(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  transparent: boolean
): { top: number; bottom: number } {
  let top = 0
  if (readTick(pixels, 1 * width + x, transparent).type === TickType.LayoutBounds) {
    let i = 1
    while (i < height - 1) {
      top++
      i++
      if (readTick(pixels, i * width + x, transparent).type !== TickType.LayoutBounds) break
    }
  }
  let bottom = 0
  if (readTick(pixels, (height - 2) * width + x, transparent).type === TickType.LayoutBounds) {
    let i = height - 2
    while (i > 1) {
      bottom++
      i--
      if (readTick(pixels, i * width + x, transparent).type !== TickType.LayoutBounds) break
    }
  }
  return { top, bottom }
}

/**
 * Port of `find_max_opacity`: march from (startX, startY) towards
 * (endX, endY) and report how far in the (first) most-opaque pixel sits.
 * A negative end coordinate acts as "no limit" for that axis; the march
 * stops early at the first fully-opaque pixel.
 */
function findMaxOpacity(
  pixels: Uint8ClampedArray,
  width: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  dX: number,
  dY: number
): number {
  let maxOpacity = 0
  let inset = 0
  let result = 0
  for (let x = startX, y = startY; x !== endX && y !== endY; x += dX, y += dY, inset++) {
    const opacity = pixels[(y * width + x) * 4 + 3]!
    if (opacity > maxOpacity) {
      maxOpacity = opacity
      result = inset
    }
    if (opacity === 0xff) break
  }
  return result
}

function maxAlphaOverRow(pixels: Uint8ClampedArray, width: number, y: number, startX: number, endX: number): number {
  let maxAlpha = 0
  for (let x = startX; x < endX; x++) {
    const alpha = pixels[(y * width + x) * 4 + 3]!
    if (alpha > maxAlpha) maxAlpha = alpha
  }
  return maxAlpha
}

/**
 * Port of `get_outline`: estimate the round-rect outline (insets, radius,
 * alpha) used by the framework to draw shadows/outlines. Must be computed
 * on the FULL image; the scans skip the 1px frame themselves.
 */
export function getOutline(pixels: Uint8ClampedArray, width: number, height: number): NinePatchOutline {
  const midX = Math.floor(width / 2)
  const midY = Math.floor(height / 2)
  const endX = width - 2
  const endY = height - 2

  let insetsLeft = 0
  let insetsRight = 0
  let insetsTop = 0
  let insetsBottom = 0

  if (width > 4) {
    insetsLeft = findMaxOpacity(pixels, width, 1, midY, midX, -1, 1, 0)
    insetsRight = findMaxOpacity(pixels, width, endX, midY, midX, -1, -1, 0)
  }
  if (height > 4) {
    insetsTop = findMaxOpacity(pixels, width, midX, 1, -1, midY, 0, 1)
    insetsBottom = findMaxOpacity(pixels, width, midX, endY, -1, midY, 0, -1)
  }

  const innerStartX = 1 + insetsLeft
  const innerStartY = 1 + insetsTop
  const innerEndX = endX - insetsRight
  const innerEndY = endY - insetsBottom
  const innerMidX = Math.floor((innerEndX + innerStartX) / 2)
  const innerMidY = Math.floor((innerEndY + innerStartY) / 2)

  // aapt1 passes innerStartY twice to the column scan (degenerating it to
  // zero rows), so the alpha effectively comes from the mid row only.
  const alpha = maxAlphaOverRow(pixels, width, innerMidY, innerStartX, innerEndX)

  const diagonalInset = findMaxOpacity(pixels, width, innerStartX, innerStartY, innerMidX, innerMidY, 1, 1)
  // aapt computes this in C `float` arithmetic; emulate it with fround so
  // the packed npOl radius matches AAPT byte-for-byte (verified against a
  // real AAPT fixture).
  const radius = Math.fround(Math.fround(3.4142) * diagonalInset)

  return { insets: [insetsLeft, insetsTop, insetsRight, insetsBottom], radius, alpha }
}

/**
 * Port of `get_color`: solid-color hint for one section of the patch grid.
 * Returns the section color as 0xAARRGGBB, `TRANSPARENT_COLOR` (0) when the
 * section is fully transparent, or `NO_COLOR` (1) when it is mixed.
 */
export function sectionColor(
  pixels: Uint8ClampedArray,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number
): number {
  if (left > right || top > bottom) {
    return TRANSPARENT_COLOR
  }
  const ref = (top * width + left) * 4
  const refR = pixels[ref]!
  const refG = pixels[ref + 1]!
  const refB = pixels[ref + 2]!
  const refA = pixels[ref + 3]!
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const o = (y * width + x) * 4
      if (refA === 0) {
        if (pixels[o + 3] !== 0) return NO_COLOR
      } else if (pixels[o] !== refR || pixels[o + 1] !== refG || pixels[o + 2] !== refB || pixels[o + 3] !== refA) {
        return NO_COLOR
      }
    }
  }
  if (refA === 0) return TRANSPARENT_COLOR
  return ((refA << 24) | (refR << 16) | (refG << 8) | refB) >>> 0
}

export interface SourcePatchParse {
  width: number
  height: number
  contentWidth: number
  contentHeight: number
  xDivs: NinePatchDiv[]
  yDivs: NinePatchDiv[]
  padding: NinePatchPadding
  layoutBounds?: NinePatchLayoutBounds
  outline: NinePatchOutline
  colors: number[]
  warnings: string[]
  /** Content pixels (border stripped), `contentWidth * contentHeight * 4` */
  content: Uint8ClampedArray
}

export class NinePatchError extends Error {
  constructor(
    message: string,
    readonly details: string[] = []
  ) {
    super(details.length > 0 ? `${message}: ${details.join('; ')}` : message)
    this.name = 'NinePatchError'
  }
}

/**
 * Full AAPT-equivalent parse of a raw nine-patch source image. Validation
 * failures throw `NinePatchError` with aapt-style messages.
 */
export function parseSourceNinePatch(pixels: Uint8ClampedArray, width: number, height: number): SourcePatchParse {
  const details: string[] = []
  const warnings: string[] = []
  const fail = (message: string, pixel?: number, edge?: string): never => {
    const at = edge
      ? pixel !== undefined && pixel >= 0
        ? ` Found at pixel #${pixel} along ${edge} edge.`
        : ` Found along ${edge} edge.`
      : ''
    details.push(`${message}.${at}`)
    throw new NinePatchError('9-patch image is malformed', details)
  }

  if (width < 3 || height < 3) {
    fail('Image must be at least 3x3 (1x1 without frame) pixels')
  }

  const corner = 0
  const transparent = pixels[corner * 4 + 3] === 0
  if (
    !transparent &&
    !(pixels[0] === 255 && pixels[1] === 255 && pixels[2] === 255 && pixels[3] === 255)
  ) {
    fail('Must have one-pixel frame that is either transparent or white')
  }

  // Stretch regions (top row / left column; at least one required per axis)
  const xResult = getHorizontalTicks(pixels, width, 0, transparent, { required: true, multipleAllowed: true })
  if (xResult.error) fail(xResult.error.message, xResult.error.pixel, 'top')
  warnings.push(...xResult.warnings)
  const xDivs = xResult.pairs

  const yResult = getVerticalTicks(pixels, width, height, 0, transparent, { required: true, multipleAllowed: true })
  if (yResult.error) fail(yResult.error.message, yResult.error.pixel, 'left')
  warnings.push(...yResult.warnings)
  const yDivs = yResult.pairs

  // Padding (bottom row / right column; at most one run each)
  const padXResult = getHorizontalTicks(pixels, width, height - 1, transparent, { required: false, multipleAllowed: false })
  if (padXResult.error) fail(padXResult.error.message, padXResult.error.pixel, 'bottom')
  warnings.push(...padXResult.warnings)
  const padYResult = getVerticalTicks(pixels, width, height, width - 1, transparent, { required: false, multipleAllowed: false })
  if (padYResult.error) fail(padYResult.error.message, padYResult.error.pixel, 'right')
  warnings.push(...padYResult.warnings)

  // Layout bounds (red markers on the bottom row / right column)
  const boundsX = getHorizontalLayoutBoundsTicks(pixels, width, height - 1, transparent)
  const boundsY = getVerticalLayoutBoundsTicks(pixels, width, height, width - 1, transparent)
  const layoutBounds: NinePatchLayoutBounds | undefined =
    boundsX.left !== 0 || boundsX.right !== 0 || boundsY.top !== 0 || boundsY.bottom !== 0
      ? { left: boundsX.left, top: boundsY.top, right: boundsX.right, bottom: boundsY.bottom }
      : undefined

  // Outline estimation happens on the full image, before cropping
  const outline = getOutline(pixels, width, height)

  // Padding: explicit markers, or inferred from the first stretch region
  const xRun = padXResult.pairs[0] ?? xDivs[0]!
  const yRun = padYResult.pairs[0] ?? yDivs[0]!
  const padding: NinePatchPadding = {
    left: xRun.start,
    right: width - 2 - xRun.stop,
    top: yRun.start,
    bottom: height - 2 - yRun.stop
  }

  // Strip the 1px frame
  const contentWidth = width - 2
  const contentHeight = height - 2
  const content = new Uint8ClampedArray(contentWidth * contentHeight * 4)
  for (let y = 0; y < contentHeight; y++) {
    const from = ((y + 1) * width + 1) * 4
    content.set(pixels.subarray(from, from + contentWidth * 4), y * contentWidth * 4)
  }

  // Section solid-color hints (content coordinates).
  // Column boundaries mirror aapt1's flat-div walk: every div value is a
  // boundary, except the leading zero of an edge-anchored first region.
  const columnBounds = segmentBounds(xDivs, contentWidth)
  const rowBounds = segmentBounds(yDivs, contentHeight)

  if (columnBounds.length * rowBounds.length > 0x7f) {
    fail('Too many rows and columns in 9-patch perimeter')
  }

  const colors: number[] = []
  for (const [top, bottom] of rowBounds) {
    for (const [left, right] of columnBounds) {
      colors.push(sectionColor(content, contentWidth, left, top, right - 1, bottom - 1))
    }
  }

  return {
    width,
    height,
    contentWidth,
    contentHeight,
    xDivs,
    yDivs,
    padding,
    layoutBounds,
    outline,
    colors,
    warnings,
    content
  }
}

/**
 * Reproduce aapt1's section-boundary walk: the flat div values act as
 * boundaries, except a leading zero (first region touching the edge), and
 * the far edge terminates the last segment.
 */
function segmentBounds(divs: NinePatchDiv[], extent: number): Array<[number, number]> {
  const bounds: number[] = []
  for (let k = 0; k < divs.length; k++) {
    const pair = divs[k]!
    if (!(k === 0 && pair.start === 0)) bounds.push(pair.start)
    bounds.push(pair.stop)
  }
  bounds.push(extent)

  const segments: Array<[number, number]> = []
  let pos = 0
  for (const bound of bounds) {
    if (pos >= extent) break
    segments.push([pos, bound])
    pos = bound
  }
  return segments
}

/**
 * Cheap heuristic used by `detectImage`: does this PNG look like a raw
 * nine-patch source? Requires a transparent-or-white frame, border pixels
 * limited to transparent/black/red, and at least one stretch marker on
 * both the top row and the left column.
 */
export function looksLikeSourceNinePatch(pixels: Uint8ClampedArray, width: number, height: number): boolean {
  if (width < 3 || height < 3) return false
  const transparent = pixels[3] === 0
  const white = pixels[0] === 255 && pixels[1] === 255 && pixels[2] === 255 && pixels[3] === 255
  if (!transparent && !white) return false

  const hasBlackRow = (y: number): boolean => {
    let hasBlack = false
    for (let x = 1; x <= width - 2; x++) {
      const tick = readTick(pixels, y * width + x, transparent)
      if (tick.error && tick.type === TickType.None) return false
      if (tick.type === TickType.Tick) hasBlack = true
    }
    return hasBlack
  }
  const hasBlackColumn = (x: number): boolean => {
    let hasBlack = false
    for (let y = 1; y <= height - 2; y++) {
      const tick = readTick(pixels, y * width + x, transparent)
      if (tick.error && tick.type === TickType.None) return false
      if (tick.type === TickType.Tick) hasBlack = true
    }
    return hasBlack
  }

  // All four borders must be marker-clean; top and left must carry stretches.
  const cleanBottom = (() => {
    for (let x = 1; x <= width - 2; x++) {
      const tick = readTick(pixels, (height - 1) * width + x, transparent)
      if (tick.error && tick.type === TickType.None) return false
    }
    return true
  })()
  const cleanRight = (() => {
    for (let y = 1; y <= height - 2; y++) {
      const tick = readTick(pixels, y * width + (width - 1), transparent)
      if (tick.error && tick.type === TickType.None) return false
    }
    return true
  })()

  return hasBlackRow(0) && hasBlackColumn(0) && cleanBottom && cleanRight
}
