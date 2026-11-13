/**
 * PNG chunk-level helpers: CRC32, chunk serialization, and splicing
 * custom chunks into an existing PNG buffer.
 */

let crcTable: Uint32Array | undefined

function table(): Uint32Array {
  if (crcTable) return crcTable
  crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    crcTable[n] = c >>> 0
  }
  return crcTable
}

/** Standard PNG CRC32 (over chunk type + data) */
export function crc32(bytes: Uint8Array): number {
  const t = table()
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = t[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface RawChunk {
  name: string
  data: Uint8Array
}

/** Serialize a single PNG chunk: length + type + data + CRC */
export function buildPngChunk({ name, data }: RawChunk): Uint8Array {
  if (name.length !== 4) {
    throw new Error(`chunk name must be exactly 4 characters, got: ${JSON.stringify(name)}`)
  }
  const output = new Uint8Array(12 + data.length)
  const view = new DataView(output.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) {
    output[4 + i] = name.charCodeAt(i)
  }
  output.set(data, 8)
  view.setUint32(8 + data.length, crc32(output.subarray(4, 8 + data.length)))
  return output
}

function findIhdrEnd(png: Uint8Array): number {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < signature.length; i++) {
    if (png[i] !== signature[i]) {
      throw new Error('not a valid PNG buffer (signature mismatch)')
    }
  }
  // IHDR data is always 13 bytes: 8 (signature) + 4 (length) + 4 (type) + 13 + 4 (crc)
  return 8 + 4 + 4 + 13 + 4
}

/**
 * Insert custom chunks right after IHDR (AAPT writes npOl/npLb/npTc at
 * `PNG_HAVE_IHDR`, i.e. between IHDR and the first IDAT).
 */
export function insertChunksAfterIhdr(png: Uint8Array, chunks: RawChunk[]): Uint8Array {
  if (chunks.length === 0) return png
  const ihdrEnd = findIhdrEnd(png)
  const inserted = chunks.map(buildPngChunk)
  const total = png.length + inserted.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Uint8Array(total)
  output.set(png.subarray(0, ihdrEnd), 0)
  let pos = ihdrEnd
  for (const chunk of inserted) {
    output.set(chunk, pos)
    pos += chunk.length
  }
  output.set(png.subarray(ihdrEnd), pos)
  return output
}

/**
 * Remove chunks with the given names from a PNG buffer (chunks are dropped
 * without re-compression; the remaining bytes are untouched).
 */
export function removePngChunks(png: Uint8Array, names: string[]): Uint8Array {
  const drop = new Set(names)
  const parts: Uint8Array[] = [png.subarray(0, 8)]
  let pos = 8
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  while (pos + 8 <= png.length) {
    const length = view.getUint32(pos)
    const name = String.fromCharCode(png[pos + 4]!, png[pos + 5]!, png[pos + 6]!, png[pos + 7]!)
    const end = pos + 12 + length
    if (!drop.has(name)) {
      parts.push(png.subarray(pos, Math.min(end, png.length)))
    }
    pos = end
  }
  parts.push(png.subarray(Math.min(pos, png.length)))
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(total)
  parts.reduce((offset, part) => (output.set(part, offset), offset + part.length), 0)
  return output
}
