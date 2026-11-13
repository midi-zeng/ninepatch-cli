import { describe, expect, it } from 'vitest'
import {
  compileNinePatch as compile,
  decompileNinePatch as decompile,
  decodeRgbaPng,
  detectImage
} from '../src/index'
import { buildSourcePng, compareVisiblePixels, findChunk, loadFixture, pngChunks } from './helpers'

describe('round trips', () => {
  it('compile(decompile(compiled)) reproduces the real AAPT npTc byte-for-byte', () => {
    const compiled = loadFixture('serialized.png')
    const source = decompile(compiled)
    const recompiled = compile(source.data)
    const realNpTc = findChunk(pngChunks(compiled), 'npTc')!
    expect(findChunk(pngChunks(recompiled.data), 'npTc')!.equals(realNpTc)).toBe(true)
    const realNpOl = findChunk(pngChunks(compiled), 'npOl')!
    expect(findChunk(pngChunks(recompiled.data), 'npOl')!.equals(realNpOl)).toBe(true)
  })

  it('decompile(compiled) matches the real source fixture pixel-for-pixel', () => {
    const source = decompile(loadFixture('serialized.png'))
    const a = decodeRgbaPng(loadFixture('orgin.png'))
    const b = decodeRgbaPng(source.data)
    expect(b.width).toBe(a.width)
    expect(b.height).toBe(a.height)
    // transparent pixels may carry arbitrary RGB, so compare visible pixels
    expect(compareVisiblePixels(a.pixels, b.pixels)).toBe(0)
  })

  it('compile -> decompile -> compile is stable for synthetic sources', () => {
    const spec = {
      width: 16,
      height: 12,
      topRuns: [[2, 3], [6, 6], [10, 14]] as Array<[number, number]>,
      leftRuns: [[2, 5], [8, 9]] as Array<[number, number]>,
      bottomRuns: [[3, 12]] as Array<[number, number]>,
      rightRuns: [[4, 9]] as Array<[number, number]>
    }
    const first = compile(buildSourcePng(spec))
    const second = compile(decompile(first.data).data)
    expect(findChunk(pngChunks(second.data), 'npTc')!.equals(findChunk(pngChunks(first.data), 'npTc')!)).toBe(true)
    expect(findChunk(pngChunks(second.data), 'npOl')!.equals(findChunk(pngChunks(first.data), 'npOl')!)).toBe(true)
  })

  it('source -> decompile-style border round trip preserves marker pixels', () => {
    const spec = {
      width: 14,
      height: 10,
      topRuns: [[2, 4], [8, 8]] as Array<[number, number]>,
      leftRuns: [[2, 2], [5, 7]] as Array<[number, number]>,
      bottomRuns: [[2, 11]] as Array<[number, number]>,
      rightRuns: [[2, 7]] as Array<[number, number]>
    }
    const original = decodeRgbaPng(buildSourcePng(spec))
    const rebuilt = decodeRgbaPng(decompile(compile(buildSourcePng(spec)).data).data)
    expect(rebuilt.width).toBe(original.width)
    expect(rebuilt.height).toBe(original.height)
    expect(compareVisiblePixels(original.pixels, rebuilt.pixels)).toBe(0)
  })

  it('decompiled output is detected as a raw nine-patch source', () => {
    const source = decompile(loadFixture('serialized.png'))
    expect(detectImage(source.data).type).toBe('9patch-source')
    expect(detectImage(source.data).width).toBe(182)
  })
})
