import { describe, expect, it } from 'vitest'
import { compileNinePatch as compile, decodeRgbaPng, encodeRgbaPng, NinePatchError } from '../src/index'
import { buildSourcePng, findChunk, loadFixture, pngChunks } from './helpers'

describe('compileNinePatch', () => {
  it('produces npTc bytes identical to real AAPT output', () => {
    // The real fixture pair: origin.png (raw source) + serialized.png
    // (compiled by AAPT). The compiled npTc must be byte-for-byte equal.
    const result = compile(loadFixture('origin.png'))
    const realNpTc = findChunk(pngChunks(loadFixture('serialized.png')), 'npTc')!
    const myNpTc = findChunk(pngChunks(result.data), 'npTc')!
    expect(myNpTc.equals(realNpTc)).toBe(true)
    expect(result.npTcSize).toBe(84)
  })

  it('produces npOl bytes identical to real AAPT output', () => {
    const result = compile(loadFixture('origin.png'))
    const realNpOl = findChunk(pngChunks(loadFixture('serialized.png')), 'npOl')!
    const myNpOl = findChunk(pngChunks(result.data), 'npOl')!
    expect(myNpOl.equals(realNpOl)).toBe(true)
    expect(result.hasNpOl).toBe(true)
  })

  it('writes chunks in the AAPT order (npOl, npTc right after IHDR)', () => {
    const result = compile(loadFixture('origin.png'))
    const names = pngChunks(result.data).map(chunk => chunk.name)
    expect(names.slice(0, 4)).toEqual(['IHDR', 'npOl', 'npTc', 'IDAT'])
  })

  it('packs a simple nine-patch exactly as specified', () => {
    // 6x6 source (4x4 content), one stretch region [1,3) per axis,
    // no padding markers -> padding inferred from the first div pair.
    const result = compile(
      buildSourcePng({ width: 6, height: 6, topRuns: [[2, 3]], leftRuns: [[2, 3]] })
    )
    const npTc = findChunk(pngChunks(result.data), 'npTc')!
    // hand-written expectation (independent of the implementation):
    // flags(00 02 02 09) + LE offsets(20/28/30) + BE padding(1,1,1,1)
    // + BE divs [1,3)x2 + 9 solid colors 0xC81E1EFF
    const expected = Buffer.from(
      '00020209' +
        '20000000' +
        '28000000' +
        '00000001' +
        '00000001' +
        '00000001' +
        '00000001' +
        '30000000' +
        '00000001' +
        '00000003' +
        '00000001' +
        '00000003' +
        ('ffc81e1e'.repeat(9)),
      'hex'
    )
    expect(npTc.equals(expected)).toBe(true)
    expect(result.width).toBe(4)
    expect(result.height).toBe(4)
  })

  it('supports multiple stretch regions and 1px-wide regions', () => {
    // content width 12 (source 14): regions [1,2) and [4,5) and [7,12)
    const result = compile(
      buildSourcePng({
        width: 14,
        height: 8,
        topRuns: [[2, 2], [5, 5], [8, 13]],
        leftRuns: [[2, 6]],
        bottomRuns: [[2, 4]],
        rightRuns: [[3, 4]]
      })
    )
    const npTc = findChunk(pngChunks(result.data), 'npTc')!
    // numXDivs=6 (3 regions), numYDivs=2, padding from markers:
    // bottom run cols 2..4 -> left = 2-1 = 1, right = 12-4 = 8
    // right run rows 3..4 -> top = 3-1 = 2, bottom = 6-4 = 2
    expect(npTc[1]).toBe(6)
    expect(npTc[2]).toBe(2)
    // padding left = 1 (BE at offset 12)
    expect(npTc.readUInt32BE(12)).toBe(1)
    expect(npTc.readUInt32BE(16)).toBe(8)
    // padding top = 2, bottom = 2
    expect(npTc.readUInt32BE(20)).toBe(2)
    expect(npTc.readUInt32BE(24)).toBe(2)
    // xDivs: [1,2), [4,5), [7,12)
    expect(npTc.readInt32BE(32)).toBe(1)
    expect(npTc.readInt32BE(36)).toBe(2)
    expect(npTc.readInt32BE(40)).toBe(4)
    expect(npTc.readInt32BE(44)).toBe(5)
    expect(npTc.readInt32BE(48)).toBe(7)
    expect(npTc.readInt32BE(52)).toBe(12)
  })

  it('emits npLb when red layout-bound markers exist', () => {
    const result = compile(
      buildSourcePng({
        width: 12,
        height: 10,
        topRuns: [[3, 8]],
        leftRuns: [[3, 7]],
        redBottomRuns: [[1, 2], [10, 10]],
        redRightRuns: [[1, 1], [8, 8]]
      })
    )
    expect(result.hasNpLb).toBe(true)
    const npLb = findChunk(pngChunks(result.data), 'npLb')!
    // left=2 (red at source 1..2), right=1 (source 10), top=1, bottom=1;
    // npLb stores left/top/right/bottom as LE int32s
    expect(npLb.readInt32LE(0)).toBe(2)
    expect(npLb.readInt32LE(4)).toBe(1)
    expect(npLb.readInt32LE(8)).toBe(1)
    expect(npLb.readInt32LE(12)).toBe(1)
  })

  it('compiles white-frame sources', () => {
    const result = compile(
      buildSourcePng({
        width: 6,
        height: 6,
        frame: 'white',
        fill: [40, 80, 120, 255],
        topRuns: [[2, 3]],
        leftRuns: [[2, 3]],
        bottomRuns: [[2, 3]]
      })
    )
    const npTc = findChunk(pngChunks(result.data), 'npTc')!
    expect(npTc.readUInt32BE(12)).toBe(1) // paddingLeft = 1
    expect(npTc.readUInt32BE(16)).toBe(1) // paddingRight = 4-3 = 1
  })

  it('warns but compiles opaque non-black markers (aapt1 compatible)', () => {
    const png = buildSourcePng({ width: 6, height: 6, topRuns: [[2, 3]], leftRuns: [[2, 3]] })
    // repaint the top marker dark gray
    const { pixels } = decodeRgbaPng(png)
    for (const x of [2, 3]) {
      const o = x * 4
      pixels[o] = 64
      pixels[o + 1] = 64
      pixels[o + 2] = 64
    }
    const result = compile(encodeRgbaPng(6, 6, pixels))
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toMatch(/black or red/)
    const npTc = findChunk(pngChunks(result.data), 'npTc')!
    expect(npTc.readInt32BE(32)).toBe(1)
  })

  it('rejects images smaller than 3x3', () => {
    expect(() => compile(buildSourcePng({ width: 2, height: 2, topRuns: [], leftRuns: [] }))).toThrow(NinePatchError)
  })

  it('rejects sources without stretch markers', () => {
    expect(() => compile(buildSourcePng({ width: 6, height: 6 }))).toThrow(/No marked region found along edge/)
  })

  it('rejects more than one padding run per edge', () => {
    expect(() =>
      compile(
        buildSourcePng({
          width: 10,
          height: 8,
          topRuns: [[2, 3]],
          leftRuns: [[2, 3]],
          bottomRuns: [[2, 3], [5, 6]]
        })
      )
    ).toThrow(/more than one marked region/)
  })

  it('rejects semi-transparent border pixels', () => {
    const png = buildSourcePng({ width: 6, height: 6, topRuns: [[2, 3]], leftRuns: [[2, 3]] })
    const { pixels } = decodeRgbaPng(png)
    pixels[2 * 4 + 3] = 128 // top border pixel (2,0) with alpha 128
    expect(() => compile(encodeRgbaPng(6, 6, pixels))).toThrow(/intermediate alphas/)
  })

  it('rejects frames that are neither transparent nor white', () => {
    const png = buildSourcePng({ width: 6, height: 6, topRuns: [[2, 3]], leftRuns: [[2, 3]] })
    const { pixels } = decodeRgbaPng(png)
    pixels[0] = 255 // corner pixel becomes opaque red
    pixels[3] = 255
    expect(() => compile(encodeRgbaPng(6, 6, pixels))).toThrow(/transparent or white/)
  })

  it('rejects too many perimeter sections', () => {
    // 40 single-px x runs + 4 y runs: (41+1... ) x sections * 6 rows > 127
    const topRuns: Array<[number, number]> = []
    for (let i = 0; i < 40; i++) topRuns.push([2 + i * 2, 2 + i * 2])
    const leftRuns: Array<[number, number]> = []
    for (let i = 0; i < 4; i++) leftRuns.push([2 + i * 2, 2 + i * 2])
    expect(() =>
      compile(buildSourcePng({ width: 84, height: 12, topRuns, leftRuns }))
    ).toThrow(/Too many rows and columns/)
  })
})
