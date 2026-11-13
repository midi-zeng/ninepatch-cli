/**
 * Shared types for ninepatch-cli.
 */

/** A stretchable region, half-open interval `[start, stop)` in content
 * coordinates (the image without the 1px guide border). This is the exact
 * representation AAPT stores in the `npTc` chunk. */
export interface NinePatchDiv {
  start: number
  stop: number
}

export interface NinePatchPadding {
  left: number
  right: number
  top: number
  bottom: number
}

/** Layout bounds carried in the optional `npLb` chunk. */
export interface NinePatchLayoutBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/** Round-rect outline data carried in the auto-generated `npOl` chunk. */
export interface NinePatchOutline {
  /** Inset of the opaque outline, `[left, top, right, bottom]` in pixels */
  insets: [number, number, number, number]
  /** Estimated corner radius in pixels (float) */
  radius: number
  /** Max alpha (0-255) of the outline */
  alpha: number
}

/**
 * Image type as reported by `detectImage`.
 *
 * - `9patch-compiled`: PNG containing an `npTc` chunk (AAPT-compiled)
 * - `9patch-source`: PNG whose 1px border contains valid nine-patch markers
 * - `png` / `jpeg` / `gif` / `bmp` / `webp`: ordinary images of that format
 * - `unknown`: unrecognized magic bytes
 */
export type ImageType =
  | '9patch-source'
  | '9patch-compiled'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'bmp'
  | 'webp'
  | 'unknown'

export interface Detection {
  type: ImageType
  /** Container format (`png` for both nine-patch flavors) */
  format: string
  width: number
  height: number
}

/** A single PNG chunk as stored in the file. */
export interface ChunkInfo {
  name: string
  size: number
}

export interface SourceNinePatchInfo {
  /** Dimensions of the source image (with the 1px guide border) */
  width: number
  height: number
  /** Dimensions after stripping the border */
  contentWidth: number
  contentHeight: number
  xDivs: NinePatchDiv[]
  yDivs: NinePatchDiv[]
  padding: NinePatchPadding
  /** Present when red layout-bound markers were found on the border */
  layoutBounds?: NinePatchLayoutBounds
  outline: NinePatchOutline
  /** Solid-color hints for each section (see `Res_png_9patch::colors`) */
  colors: number[]
  /** Non-fatal border observations (e.g. non-black opaque markers) */
  warnings: string[]
}

export interface CompiledNinePatchInfo {
  width: number
  height: number
  npTc: {
    wasDeserialized: boolean
    numXDivs: number
    numYDivs: number
    numColors: number
    xDivs: NinePatchDiv[]
    yDivs: NinePatchDiv[]
    padding: NinePatchPadding
  }
  npOl?: NinePatchOutline
  npLb?: NinePatchLayoutBounds
}

export interface Inspection {
  detection: Detection
  /** Chunk table (PNG images only) */
  chunks: ChunkInfo[]
  /** Filled when the image is a raw nine-patch source */
  source?: SourceNinePatchInfo
  /** Filled when the image is AAPT-compiled */
  compiled?: CompiledNinePatchInfo
  /** Strict nine-patch validation problems (raw sources only) */
  errors?: string[]
}

export interface CompileResult {
  data: Uint8Array
  /** Content (compiled) dimensions */
  width: number
  height: number
  /** Byte size of the written `npTc` chunk */
  npTcSize: number
  hasNpOl: boolean
  hasNpLb: boolean
  warnings: string[]
}

export interface DecompileResult {
  data: Uint8Array
  /** Source (bordered) dimensions */
  width: number
  height: number
}
