#!/usr/bin/env node
/**
 * ninepatch — CLI for Android nine-patch images.
 *
 * Commands:
 *   detect     report the image type (9patch-source / 9patch-compiled / ...)
 *   info       detailed nine-patch information (divs, padding, chunks, ...)
 *   compile    raw .9.png source  ->  AAPT-compiled PNG (npTc/npOl/npLb)
 *   decompile  AAPT-compiled PNG  ->  raw .9.png source
 */

import { Command } from 'commander'
import { readFileSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileNinePatch, decompileNinePatch, detectImage, inspectImage } from './ninepatch.js'
import type { Detection, Inspection } from './types.js'

const CLI_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
})()

const EXIT_USAGE = 2
const EXIT_FAILURE = 1

interface CliError extends Error {
  exitCode?: number
}

function fail(message: string, exitCode = EXIT_FAILURE): never {
  const error = new Error(message) as CliError
  error.name = 'CliError'
  error.exitCode = exitCode
  throw error
}

function readInput(file: string): Uint8Array {
  let buffer: Buffer
  try {
    buffer = readFileSync(file)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    fail(`cannot read ${file}: ${reason}`)
  }
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

function writeOutput(file: string, data: Uint8Array): void {
  writeFileSync(file, Buffer.from(data.buffer, data.byteOffset, data.byteLength))
}

function typeLabel(detection: Detection): string {
  switch (detection.type) {
    case '9patch-source':
      return '9patch-source (raw .9.png)'
    case '9patch-compiled':
      return '9patch-compiled (AAPT, npTc)'
    case 'unknown':
      return 'unknown'
    default:
      return detection.type
  }
}

function formatDims(detection: Detection): string {
  return detection.width > 0 && detection.height > 0 ? `${detection.width}x${detection.height}` : '?'
}

function runDetect(files: string[], json: boolean): void {
  const results = files.map(file => {
    const detection = detectImage(readInput(file))
    return { file, ...detection }
  })
  if (json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
    return
  }
  const width = Math.max(...results.map(result => result.file.length))
  for (const result of results) {
    process.stdout.write(`${result.file.padEnd(width)}  ${typeLabel(result).padEnd(28)} ${formatDims(result)}\n`)
  }
}

function formatDiv(divs: { start: number; stop: number }[]): string {
  return divs.map(div => `[${div.start}, ${div.stop})`).join(' ') || '(none)'
}

function inspectToLines(name: string, inspection: Inspection): string[] {
  const lines: string[] = []
  const detection = inspection.detection
  lines.push(`${name} — ${typeLabel(detection)}, ${formatDims(detection)}`)

  if (detection.format !== 'png') {
    return lines
  }

  lines.push(`  chunks: ${inspection.chunks.map(chunk => `${chunk.name}(${chunk.size})`).join(' ')}`)

  if (inspection.compiled) {
    const npTc = inspection.compiled.npTc
    lines.push(`  npTc: wasDeserialized=${npTc.wasDeserialized ? 1 : 0} numXDivs=${npTc.numXDivs} numYDivs=${npTc.numYDivs} numColors=${npTc.numColors}`)
    lines.push(`  stretch-x: ${formatDiv(npTc.xDivs)}`)
    lines.push(`  stretch-y: ${formatDiv(npTc.yDivs)}`)
    const padding = npTc.padding
    lines.push(`  padding: left=${padding.left} right=${padding.right} top=${padding.top} bottom=${padding.bottom}`)
    const npOl = inspection.compiled.npOl
    if (npOl) {
      lines.push(
        `  npOl: insets [${npOl.insets.join(', ')}] radius=${npOl.radius.toFixed(2)} alpha=${npOl.alpha}`
      )
    }
    const npLb = inspection.compiled.npLb
    if (npLb) {
      lines.push(`  npLb: layout bounds left=${npLb.left} top=${npLb.top} right=${npLb.right} bottom=${npLb.bottom}`)
    }
  }

  if (inspection.source) {
    const source = inspection.source
    lines.push(`  content: ${source.contentWidth}x${source.contentHeight}`)
    lines.push(`  stretch-x: ${formatDiv(source.xDivs)}`)
    lines.push(`  stretch-y: ${formatDiv(source.yDivs)}`)
    const padding = source.padding
    lines.push(`  padding: left=${padding.left} right=${padding.right} top=${padding.top} bottom=${padding.bottom}`)
    if (source.layoutBounds) {
      const bounds = source.layoutBounds
      lines.push(
        `  layout bounds (red markers): left=${bounds.left} top=${bounds.top} right=${bounds.right} bottom=${bounds.bottom}`
      )
    }
    lines.push(
      `  outline (npOl): insets [${source.outline.insets.join(', ')}] radius=${source.outline.radius.toFixed(2)} alpha=${source.outline.alpha}`
    )
    for (const warning of source.warnings) {
      lines.push(`  warning: ${warning}`)
    }
  }

  if (inspection.errors) {
    for (const error of inspection.errors) {
      lines.push(`  error: ${error}`)
    }
  }

  return lines
}

function runInfo(files: string[], json: boolean): void {
  const inspections = files.map(file => ({ file, inspection: inspectImage(readInput(file)) }))
  if (json) {
    process.stdout.write(`${JSON.stringify(inspections, null, 2)}\n`)
    return
  }
  for (const { file, inspection } of inspections) {
    for (const line of inspectToLines(file, inspection)) {
      process.stdout.write(`${line}\n`)
    }
  }
}

function deriveOutput(input: string, mode: 'compile' | 'decompile'): string | undefined {
  const lower = input.toLowerCase()
  if (mode === 'compile') {
    if (lower.endsWith('.9.png')) return input.slice(0, -6) + '.png'
    return undefined
  }
  if (lower.endsWith('.png') && !lower.endsWith('.9.png')) {
    return input.slice(0, -4) + '.9.png'
  }
  return undefined
}

interface ConvertOptions {
  output?: string
  stdout?: boolean
}

function runConvert(mode: 'compile' | 'decompile', files: string[], options: ConvertOptions): void {
  if (options.output && files.length > 1) {
    fail('-o/--output can only be used with a single input file', EXIT_USAGE)
  }
  if (options.stdout && files.length > 1) {
    fail('--stdout can only be used with a single input file', EXIT_USAGE)
  }

  let failed = 0
  for (const file of files) {
    try {
      const input = readInput(file)
      let data: Uint8Array
      let width: number
      let height: number
      let warnings: string[] = []
      if (mode === 'compile') {
        const result = compileNinePatch(input)
        data = result.data
        width = result.width
        height = result.height
        warnings = result.warnings
      } else {
        const result = decompileNinePatch(input)
        data = result.data
        width = result.width
        height = result.height
      }
      for (const warning of warnings) {
        process.stderr.write(`${file}: warning: ${warning}\n`)
      }
      if (options.stdout) {
        writeBinaryToStdout(data)
        return
      }
      const target = options.output ?? deriveOutput(file, mode)
      if (!target) {
        fail(
          mode === 'compile'
            ? `cannot derive an output name for ${file}: sources are conventionally named *.9.png; use -o to set one`
            : `cannot derive an output name for ${file}: input already uses the .9.png suffix; use -o to set one`
        )
      }
      writeOutput(target, data)
      const verb = mode === 'compile' ? 'compiled' : 'decompiled'
      process.stdout.write(`${verb} ${file} -> ${target} (${width}x${height})\n`)
    } catch (error) {
      failed++
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof Error && error.name === 'CliError') throw error
      process.stderr.write(`${file}: error: ${message}\n`)
    }
  }
  if (failed > 0) {
    fail(`${failed} of ${files.length} file(s) failed`)
  }
}

function writeBinaryToStdout(data: Uint8Array): void {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  let written = 0
  while (written < buffer.length) {
    written += writeSync(1, buffer, written)
  }
}

async function main(): Promise<void> {
  const program = new Command()
  program
    .name('ninepatch')
    .description('Detect, compile and decompile Android nine-patch (.9.png) images.')
    .version(CLI_VERSION, '-V, --version', 'print version')

  program
    .command('detect')
    .description('detect the image type: 9patch-source / 9patch-compiled / png / jpeg / ...')
    .argument('<files...>', 'image files to check')
    .option('--json', 'print JSON instead of a table')
    .action((files: string[], options: { json?: boolean }) => runDetect(files, options.json === true))

  program
    .command('info')
    .description('show nine-patch details (divs, padding, chunks, outline, layout bounds)')
    .argument('<files...>', 'image files to inspect')
    .option('--json', 'print JSON instead of text')
    .action((files: string[], options: { json?: boolean }) => runInfo(files, options.json === true))

  program
    .command('compile')
    .description('compile a raw .9.png source into the AAPT-compiled format (strips the border, adds npTc/npOl/npLb)')
    .argument('<files...>', 'raw nine-patch source files (*.9.png)')
    .option('-o, --output <path>', 'output file (single input only; default: strip the .9 suffix)')
    .option('--stdout', 'write the compiled PNG to stdout (single input only)')
    .action((files: string[], options: ConvertOptions) => runConvert('compile', files, options))

  program
    .command('decompile')
    .description('decompile an AAPT-compiled nine-patch back into a raw .9.png source (rebuilds the guide borders)')
    .argument('<files...>', 'compiled nine-patch files')
    .option('-o, --output <path>', 'output file (single input only; default: insert the .9 suffix)')
    .option('--stdout', 'write the source PNG to stdout (single input only)')
    .action((files: string[], options: ConvertOptions) => runConvert('decompile', files, options))

  await program.parseAsync()
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`ninepatch: ${message}\n`)
  const exitCode = (error as CliError).exitCode ?? EXIT_FAILURE
  process.exit(exitCode)
}
