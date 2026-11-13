/**
 * Synthetic nine-patch builders for the test suite.
 *
 * Runs are expressed in SOURCE coordinates (the 1px guide border included):
 * the stripped border positions 1..(dimension-2) correspond 1:1 to content
 * coordinates.
 */

import { readFileSync } from 'node:fs'
import { encodeRgbaPng } from '../src/index'

export const TRANSPARENT = [0, 0, 0, 0] as const
export const BLACK = [0, 0, 0, 255] as const
export const WHITE = [255, 255, 255, 255] as const
export const RED = [255, 0, 0, 255] as const
export const DEFAULT_FILL = [200, 30, 30, 255] as const

export interface SourceSpec {
  /** Source width including the 1px border (>= 3) */
  width: number
  height: number
  /** Content fill color */
  fill?: readonly number[]
  /** Black marker runs, inclusive source-coordinate ranges */
  topRuns?: Array<[number, number]>
  leftRuns?: Array<[number, number]>
  bottomRuns?: Array<[number, number]>
  rightRuns?: Array<[number, number]>
  /** Red layout-bound runs (bottom row / right column) */
  redBottomRuns?: Array<[number, number]>
  redRightRuns?: Array<[number, number]>
  /** Frame mode; the corner pixel decides which rules AAPT applies */
  frame?: 'transparent' | 'white'
}

export function buildSourcePixels(spec: SourceSpec): Uint8ClampedArray {
  const { width, height } = spec
  const fill = spec.fill ?? DEFAULT_FILL
  const frameColor = spec.frame === 'white' ? WHITE : TRANSPARENT
  const pixels = new Uint8ClampedArray(width * height * 4)

  const set = (x: number, y: number, rgba: readonly number[]): void => {
    const o = (y * width + x) * 4
    pixels[o] = rgba[0]!
    pixels[o + 1] = rgba[1]!
    pixels[o + 2] = rgba[2]!
    pixels[o + 3] = rgba[3]!
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      set(x, y, fill)
    }
  }
  // borders default to the frame color
  for (let x = 0; x < width; x++) {
    set(x, 0, frameColor)
    set(x, height - 1, frameColor)
  }
  for (let y = 0; y < height; y++) {
    set(0, y, frameColor)
    set(width - 1, y, frameColor)
  }

  const drawRuns = (runs: Array<[number, number]> | undefined, color: readonly number[], horizontal: boolean, at: number): void => {
    for (const [from, to] of runs ?? []) {
      for (let p = from; p <= to; p++) {
        if (horizontal) set(p, at, color)
        else set(at, p, color)
      }
    }
  }

  drawRuns(spec.topRuns, BLACK, true, 0)
  drawRuns(spec.leftRuns, BLACK, false, 0)
  drawRuns(spec.bottomRuns, BLACK, true, height - 1)
  drawRuns(spec.rightRuns, BLACK, false, width - 1)
  drawRuns(spec.redBottomRuns, RED, true, height - 1)
  drawRuns(spec.redRightRuns, RED, false, width - 1)

  return pixels
}

export function buildSourcePng(spec: SourceSpec): Uint8Array {
  return encodeRgbaPng(spec.width, spec.height, buildSourcePixels(spec))
}

export interface RawChunkView {
  name: string
  data: Buffer
}

/** Walk the chunks of a PNG buffer (test helper with strict bounds). */
export function pngChunks(png: Uint8Array): RawChunkView[] {
  const buffer = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  const chunks: RawChunkView[] = []
  let pos = 8
  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos)
    const name = buffer.toString('ascii', pos + 4, pos + 8)
    chunks.push({ name, data: buffer.subarray(pos + 8, pos + 8 + length) })
    pos += 12 + length
  }
  return chunks
}

export function findChunk(chunks: RawChunkView[], name: string): Buffer | undefined {
  return chunks.find(chunk => chunk.name === name)?.data
}

/** Load a real fixture from test/images */
export function loadFixture(name: 'orgin.png' | 'serialized.png'): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./images/${name}`, import.meta.url)))
}

/** Count pixel differences, ignoring RGB of fully-transparent pixels. */
export function compareVisiblePixels(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray
): number {
  let diffs = 0
  for (let p = 0; p < a.length; p += 4) {
    if (a[p + 3] === 0 && b[p + 3] === 0) continue
    for (let c = 0; c < 4; c++) {
      if (a[p + c] !== b[p + c]) diffs++
    }
  }
  return diffs
}
