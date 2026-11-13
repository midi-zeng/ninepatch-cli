import { describe, expect, it } from 'vitest'
import {
  decodeRgbaPng,
  decompileNinePatch as decompile,
  detectImage,
  encodeRgbaPng,
  insertChunksAfterIhdr,
  parseNpTcChunk
} from '../src/index'
import { buildSourcePng, loadFixture } from './helpers'

const BLACK = [0, 0, 0, 255]
const TRANSPARENT = [0, 0, 0, 0]

function pixelOf(pixels: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const o = (y * width + x) * 4
  return [pixels[o]!, pixels[o + 1]!, pixels[o + 2]!, pixels[o + 3]!]
}

describe('decompileNinePatch', () => {
  it('rebuilds the guide borders of the real fixture', () => {
    const result = decompile(loadFixture('serialized.png'))
    expect(result.width).toBe(182)
    expect(result.height).toBe(122)
    expect(detectImage(result.data).type).toBe('9patch-source')

    const { pixels, width, height } = decodeRgbaPng(result.data)
    // stretch-x divs [14,29) -> black at source columns 15..29 of the top row
    expect(pixelOf(pixels, width, 15, 0)).toEqual(BLACK)
    expect(pixelOf(pixels, width, 29, 0)).toEqual(BLACK)
    expect(pixelOf(pixels, width, 14, 0)).toEqual(TRANSPARENT)
    expect(pixelOf(pixels, width, 30, 0)).toEqual(TRANSPARENT)
    // stretch-y divs [14,29) -> black at source rows 15..29 of the left column
    expect(pixelOf(pixels, width, 0, 15)).toEqual(BLACK)
    expect(pixelOf(pixels, width, 0, 29)).toEqual(BLACK)
    expect(pixelOf(pixels, width, 0, 14)).toEqual(TRANSPARENT)
    // padding left=10 right=20 on content width 180 -> bottom row cols 11..160
    expect(pixelOf(pixels, width, 11, height - 1)).toEqual(BLACK)
    expect(pixelOf(pixels, width, 160, height - 1)).toEqual(BLACK)
    expect(pixelOf(pixels, width, 10, height - 1)).toEqual(TRANSPARENT)
    expect(pixelOf(pixels, width, 161, height - 1)).toEqual(TRANSPARENT)
    // padding top=10 bottom=20 on content height 120 -> right col rows 11..100
    expect(pixelOf(pixels, width, width - 1, 11)).toEqual(BLACK)
    expect(pixelOf(pixels, width, width - 1, 100)).toEqual(BLACK)
    expect(pixelOf(pixels, width, width - 1, 10)).toEqual(TRANSPARENT)
    expect(pixelOf(pixels, width, width - 1, 101)).toEqual(TRANSPARENT)
    // corners stay transparent
    expect(pixelOf(pixels, width, 0, 0)).toEqual(TRANSPARENT)
    expect(pixelOf(pixels, width, width - 1, 0)).toEqual(TRANSPARENT)
  })

  it('reconstructs red layout-bound markers from npLb', () => {
    // hand-built compiled image: 6x6 content, npTc with padding (1,1,1,1)
    // and divs [1,3) on both axes, plus an npLb of (2,1,1,2)
    const content = new Uint8ClampedArray(6 * 6 * 4).fill(0)
    for (let i = 0; i < content.length; i += 4) {
      content[i] = 20
      content[i + 1] = 40
      content[i + 2] = 60
      content[i + 3] = 255
    }
    const npTc = packNpTcForTest()
    const npLb = new Uint8Array(16)
    const view = new DataView(npLb.buffer)
    view.setInt32(0, 2, true)
    view.setInt32(4, 1, true)
    view.setInt32(8, 1, true)
    view.setInt32(12, 2, true)
    const base = encodeRgbaPng(6, 6, content)
    const compiled = insertChunksAfterIhdr(base, [
      { name: 'npTc', data: npTc },
      { name: 'npLb', data: npLb }
    ])

    const result = decompile(compiled)
    expect(result.width).toBe(8)
    expect(result.height).toBe(8)
    const { pixels, width, height } = decodeRgbaPng(result.data)
    // stretch markers: source cols/rows 2..3
    expect(pixelOf(pixels, width, 2, 0)).toEqual(BLACK)
    expect(pixelOf(pixels, width, 3, 0)).toEqual(BLACK)
    // padding markers: bottom row cols 2..3, right col rows 2..3
    expect(pixelOf(pixels, width, 2, height - 1)).toEqual(BLACK)
    expect(pixelOf(pixels, width, width - 1, 2)).toEqual(BLACK)
    // layout bounds: bottom row red at cols 1..2 (black wins at the shared
    // col 2), right col red at rows 1 and 5..6 (top=1, bottom=2)
    expect(pixelOf(pixels, width, 1, height - 1)).toEqual([255, 0, 0, 255])
    expect(pixelOf(pixels, width, 2, height - 1)).toEqual(BLACK)
    expect(pixelOf(pixels, width, width - 1, 1)).toEqual([255, 0, 0, 255])
    expect(pixelOf(pixels, width, width - 1, 6)).toEqual([255, 0, 0, 255])
  })

  it('parses legacy 20-byte-header npTc chunks', () => {
    // pre-Android-4.1 layout: no offset fields, all little-endian
    const npTc = new Uint8Array([
      0x01, 0x02, 0x02, 0x00, // wasDeserialized=1, numXDivs=2, numYDivs=2, numColors=0
      0x01, 0x00, 0x00, 0x00, // padding.left = 1 (LE)
      0x01, 0x00, 0x00, 0x00, // padding.right = 1
      0x01, 0x00, 0x00, 0x00, // padding.top = 1
      0x01, 0x00, 0x00, 0x00, // padding.bottom = 1
      0x01, 0x00, 0x00, 0x00, // xDivs[0] = 1
      0x03, 0x00, 0x00, 0x00, // xDivs[1] = 3
      0x01, 0x00, 0x00, 0x00, // yDivs[0] = 1
      0x03, 0x00, 0x00, 0x00 // yDivs[1] = 3
    ])
    const parsed = parseNpTcChunk(npTc)
    expect(parsed.padding).toEqual({ left: 1, right: 1, top: 1, bottom: 1 })
    expect(parsed.xDivs).toEqual([{ start: 1, stop: 3 }])
    expect(parsed.yDivs).toEqual([{ start: 1, stop: 3 }])

    const content = new Uint8ClampedArray(6 * 6 * 4).fill(0)
    for (let i = 0; i < content.length; i += 4) content[i + 3] = 255
    const compiled = insertChunksAfterIhdr(encodeRgbaPng(6, 6, content), [{ name: 'npTc', data: npTc }])
    const result = decompile(compiled)
    expect(result.width).toBe(8)
    const { pixels, width, height } = decodeRgbaPng(result.data)
    expect(pixelOf(pixels, width, 2, 0)).toEqual(BLACK)
    expect(pixelOf(pixels, width, 2, height - 1)).toEqual(BLACK)
  })

  it('rejects non-nine-patch pngs', () => {
    const plain = buildSourcePng({ width: 8, height: 8 })
    expect(() => decompile(plain)).toThrow(/no npTc chunk/)
  })
})

/** npTc payload for the hand-built 6x6 fixture (modern layout). */
function packNpTcForTest(): Uint8Array {
  const buf = new Uint8Array(32 + 16)
  const view = new DataView(buf.buffer)
  buf[1] = 2 // numXDivs (values)
  buf[2] = 2
  buf[3] = 0 // numColors
  view.setUint32(4, 32, true)
  view.setUint32(8, 40, true)
  view.setInt32(12, 1, false) // padding BE
  view.setInt32(16, 1, false)
  view.setInt32(20, 1, false)
  view.setInt32(24, 1, false)
  view.setUint32(28, 48, true)
  view.setInt32(32, 1, false) // xDivs
  view.setInt32(36, 3, false)
  view.setInt32(40, 1, false) // yDivs
  view.setInt32(44, 3, false)
  return buf
}
