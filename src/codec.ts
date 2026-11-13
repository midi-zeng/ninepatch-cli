/**
 * Pixel-level PNG codec (built on pngjs) and best-effort dimension
 * sniffing for the other common formats.
 */

import { PNG } from 'pngjs'

export interface DecodedImage {
  width: number
  height: number
  /** 8-bit RGBA, `width * height * 4` bytes */
  pixels: Uint8ClampedArray
}

/**
 * Decode a PNG buffer to 8-bit RGBA pixels.
 *
 * Palette / grayscale / interlaced inputs are converted by pngjs.
 *
 * @throws when the buffer is not a PNG or uses an unsupported layout
 */
export function decodeRgbaPng(buffer: Uint8Array): DecodedImage {
  const png = PNG.sync.read(Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength))
  const pixels = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.width * png.height * 4)
  return { width: png.width, height: png.height, pixels }
}

/**
 * Encode 8-bit RGBA pixels as a PNG (color type 6).
 */
export function encodeRgbaPng(width: number, height: number, pixels: Uint8ClampedArray): Uint8Array {
  const png = new PNG({ width, height })
  png.data = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)
  const out = PNG.sync.write(png)
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
}

/** Best-effort `width x height` extraction from non-PNG image headers. */
export function sniffDimensions(bytes: Uint8Array): { width: number; height: number } {
  try {
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      // GIF: little-endian u16 at 6 and 8
      return { width: le16(bytes, 6), height: le16(bytes, 8) }
    }
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
      // BMP: DIB header width/height (i32, height may be negative for top-down)
      return { width: Math.abs(le32(bytes, 18)), height: Math.abs(le32(bytes, 22)) }
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return sniffJpeg(bytes)
    }
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) {
      return sniffWebp(bytes)
    }
  } catch {
    // fall through: dimension sniffing is best-effort only
  }
  return { width: 0, height: 0 }
}

function le16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function le32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
}

function sniffJpeg(bytes: Uint8Array): { width: number; height: number } {
  let pos = 2
  while (pos + 9 < bytes.length) {
    if (bytes[pos] !== 0xff) return { width: 0, height: 0 }
    const marker = bytes[pos + 1]!
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      pos += 2
      continue
    }
    const length = (bytes[pos + 2]! << 8) | bytes[pos + 3]!
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      return {
        height: (bytes[pos + 5]! << 8) | bytes[pos + 6]!,
        width: (bytes[pos + 7]! << 8) | bytes[pos + 8]!
      }
    }
    pos += 2 + length
  }
  return { width: 0, height: 0 }
}

function sniffWebp(bytes: Uint8Array): { width: number; height: number } {
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!)
  if (chunk === 'VP8X') {
    // canvas size minus one, stored as 24-bit LE integers
    return {
      width: 1 + le24(bytes, 24),
      height: 1 + le24(bytes, 27)
    }
  }
  if (chunk === 'VP8 ') {
    // lossy: 3-byte frame tag, start code 9d 01 2a, then LE u16 width/height (14 bits used)
    return {
      width: le16(bytes, 26) & 0x3fff,
      height: le16(bytes, 28) & 0x3fff
    }
  }
  if (chunk === 'VP8L') {
    // lossless: signature 0x2f then a 28-bit LE bit field
    const bits = le32(bytes, 21)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1
    }
  }
  return { width: 0, height: 0 }
}

function le24(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
}
