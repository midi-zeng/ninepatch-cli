import { describe, expect, it } from 'vitest'
import { decodeRgbaPng, detectImage, encodeRgbaPng } from '../src/index'
import { buildSourcePng, loadFixture } from './helpers'

describe('detectImage', () => {
  it('detects a raw nine-patch source (real fixture)', () => {
    const detection = detectImage(loadFixture('origin.png'))
    expect(detection.type).toBe('9patch-source')
    expect(detection.format).toBe('png')
    expect(detection.width).toBe(182)
    expect(detection.height).toBe(122)
  })

  it('detects an AAPT-compiled nine-patch (real fixture)', () => {
    const detection = detectImage(loadFixture('serialized.png'))
    expect(detection.type).toBe('9patch-compiled')
    expect(detection.width).toBe(180)
    expect(detection.height).toBe(120)
  })

  it('detects a synthetic raw nine-patch source', () => {
    const png = buildSourcePng({ width: 8, height: 7, topRuns: [[3, 5]], leftRuns: [[3, 4]] })
    expect(detectImage(png).type).toBe('9patch-source')
  })

  it('detects a white-frame nine-patch source', () => {
    const png = buildSourcePng({
      width: 8,
      height: 7,
      frame: 'white',
      fill: [40, 80, 120, 255],
      topRuns: [[3, 5]],
      leftRuns: [[3, 4]]
    })
    expect(detectImage(png).type).toBe('9patch-source')
  })

  it('reports a plain png without nine-patch borders', () => {
    const png = buildSourcePng({ width: 9, height: 9 })
    expect(detectImage(png).type).toBe('png')
  })

  it('requires markers on both stretch axes', () => {
    // only the top row carries a black run -> not a valid nine-patch source
    const png = buildSourcePng({ width: 8, height: 7, topRuns: [[3, 5]] })
    expect(detectImage(png).type).toBe('png')
  })

  it('rejects images with non-solid border pixels as nine-patch sources', () => {
    const png = buildSourcePng({ width: 8, height: 7, topRuns: [[3, 5]], leftRuns: [[3, 4]] })
    expect(detectImage(png).type).toBe('9patch-source')
    // a semi-transparent bottom-border pixel (as produced by antialiasing on
    // ordinary images) disqualifies the nine-patch heuristics
    const decoded = decodeRgbaPng(png)
    decoded.pixels[(6 * 8 + 4) * 4 + 3] = 128
    const mutated = encodeRgbaPng(decoded.width, decoded.height, decoded.pixels)
    expect(detectImage(mutated).type).toBe('png')
  })

  it('classifies by npTc presence even when borders look source-like', () => {
    const compiled = loadFixture('serialized.png')
    expect(detectImage(compiled).type).toBe('9patch-compiled')
  })

  it('sniffs jpeg dimensions', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x78, 0x00, 0xb4, 0x03, 0x01, 0x11, 0x00, 0x02,
      0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9
    ])
    const detection = detectImage(jpeg)
    expect(detection.type).toBe('jpeg')
    expect(detection.width).toBe(180)
    expect(detection.height).toBe(120)
  })

  it('sniffs gif dimensions', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x00, 0x3c, 0x00, 0x00, 0x00])
    const detection = detectImage(gif)
    expect(detection.type).toBe('gif')
    expect(detection.width).toBe(32)
    expect(detection.height).toBe(60)
  })

  it('sniffs bmp dimensions', () => {
    const bmp = new Uint8Array(40)
    bmp[0] = 0x42
    bmp[1] = 0x4d
    const view = new DataView(bmp.buffer)
    view.setInt32(18, 300, true)
    view.setInt32(22, 150, true)
    const detection = detectImage(bmp)
    expect(detection.type).toBe('bmp')
    expect(detection.width).toBe(300)
    expect(detection.height).toBe(150)
  })

  it('sniffs lossless webp dimensions', () => {
    const webp = new Uint8Array(40)
    webp.set([0x52, 0x49, 0x46, 0x46], 0)
    webp.set([0x57, 0x45, 0x42, 0x50], 8)
    webp.set([0x56, 0x50, 0x38, 0x4c], 12) // VP8L
    webp[20] = 0x2f
    const view = new DataView(webp.buffer)
    // width-1 = 99 (7 bits..), height-1 = 199 packed into 28 bits LE
    view.setUint32(21, 99 | (199 << 14), true)
    const detection = detectImage(webp)
    expect(detection.type).toBe('webp')
    expect(detection.width).toBe(100)
    expect(detection.height).toBe(200)
  })

  it('reports unknown for unrecognized magic bytes', () => {
    expect(detectImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).type).toBe('unknown')
  })
})
