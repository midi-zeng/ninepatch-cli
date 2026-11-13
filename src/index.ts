/**
 * ninepatch-cli — public API.
 *
 * Programmatic access to the same engine that powers the `ninepatch`
 * command line tool: detect image types, compile raw nine-patch sources
 * into the AAPT format (npTc/npOl/npLb chunks) and decompile them back.
 */

export { detectImage, inspectImage, compileNinePatch, decompileNinePatch } from './ninepatch.js'
export { decodeRgbaPng, encodeRgbaPng, sniffDimensions } from './codec.js'
export { crc32, buildPngChunk, insertChunksAfterIhdr, removePngChunks } from './chunks.js'
export {
  packNpTcChunk,
  parseNpTcChunk,
  packNpOlChunk,
  parseNpOlChunk,
  packNpLbChunk,
  parseNpLbChunk
} from './npchunks.js'
export {
  parseSourceNinePatch,
  looksLikeSourceNinePatch,
  getOutline,
  sectionColor,
  readTick,
  getHorizontalTicks,
  getVerticalTicks,
  getHorizontalLayoutBoundsTicks,
  getVerticalLayoutBoundsTicks,
  NinePatchError,
  NO_COLOR,
  TRANSPARENT_COLOR,
  TickType
} from './borders.js'
export type {
  NinePatchDiv,
  NinePatchPadding,
  NinePatchLayoutBounds,
  NinePatchOutline,
  ImageType,
  Detection,
  ChunkInfo,
  SourceNinePatchInfo,
  CompiledNinePatchInfo,
  Inspection,
  CompileResult,
  DecompileResult
} from './types.js'
