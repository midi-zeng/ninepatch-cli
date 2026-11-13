import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { encodeRgbaPng } from '../src/index'

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const FIXTURES = fileURLToPath(new URL('./images', import.meta.url))

interface CliRun {
  stdout: string
  stderr: string
  status: number
}

function run(args: string[], cwd: string): CliRun {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8', stderr: 'pipe' })
    return { stdout, stderr: '', status: 0 }
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string }
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', status: err.status ?? -1 }
  }
}

function makeWorkdir(): string {
  return mkdtempSync(join(tmpdir(), 'ninepatch-cli-test-'))
}

describe('cli', () => {
  it('detect prints a table and json', () => {
    const dir = makeWorkdir()
    try {
      const result = run(['detect', join(FIXTURES, 'orgin.png'), join(FIXTURES, 'serialized.png')], dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('9patch-source')
      expect(result.stdout).toContain('9patch-compiled')

      const json = run(['detect', '--json', join(FIXTURES, 'orgin.png')], dir)
      const parsed = JSON.parse(json.stdout) as Array<{ file: string; type: string; width: number }>
      expect(parsed[0]!.type).toBe('9patch-source')
      expect(parsed[0]!.width).toBe(182)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('info prints npTc details and json', () => {
    const dir = makeWorkdir()
    try {
      const result = run(['info', join(FIXTURES, 'serialized.png')], dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('npTc')
      expect(result.stdout).toContain('stretch-x: [14, 29)')

      const json = run(['info', '--json', join(FIXTURES, 'serialized.png')], dir)
      const parsed = JSON.parse(json.stdout) as Array<{
        inspection: { compiled?: { npTc: { padding: { left: number } } } }
      }>
      expect(parsed[0]!.inspection.compiled!.npTc.padding.left).toBe(10)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('compile/decompile round trip via derived file names', () => {
    const dir = makeWorkdir()
    try {
      const source = join(dir, 'btn.9.png')
      copyFileSync(join(FIXTURES, 'orgin.png'), source)

      const compiled = run(['compile', 'btn.9.png'], dir)
      expect(compiled.status).toBe(0)
      expect(compiled.stdout).toContain('btn.9.png -> btn.png')
      expect(existsSync(join(dir, 'btn.png'))).toBe(true)

      const decompiled = run(['decompile', 'btn.png'], dir)
      expect(decompiled.status).toBe(0)
      expect(decompiled.stdout).toContain('btn.png -> btn.9.png')

      // decompiled bytes are identical to the original source (deterministic codec)
      expect(readFileSync(join(dir, 'btn.9.png')).equals(readFileSync(source))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('compile --stdout writes the same bytes as the file output', () => {
    const dir = makeWorkdir()
    try {
      const source = join(FIXTURES, 'orgin.png')
      const toFile = run(['compile', source, '-o', join(dir, 'out.png')], dir)
      expect(toFile.status).toBe(0)
      const piped = execFileSync('node', [CLI, 'compile', source, '--stdout'])
      expect(piped.equals(readFileSync(join(dir, 'out.png')))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails with exit code 1 on invalid nine-patches and missing files', () => {
    const dir = makeWorkdir()
    try {
      const plain = join(dir, 'plain.png')
      writeFileSync(plain, Buffer.from(encodeRgbaPng(10, 10, new Uint8ClampedArray(10 * 10 * 4))))
      expect(run(['compile', 'plain.png'], dir).status).toBe(1)
      expect(run(['compile', 'missing.png'], dir).status).toBe(1)
      expect(run(['decompile', 'plain.png'], dir).status).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects -o with multiple inputs (usage error, exit 2)', () => {
    const dir = makeWorkdir()
    try {
      const result = run(['compile', join(FIXTURES, 'orgin.png'), join(FIXTURES, 'orgin.png'), '-o', 'x.png'], dir)
      expect(result.status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prints version and help', () => {
    const dir = makeWorkdir()
    try {
      const version = run(['--version'], dir)
      expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
      const help = run(['--help'], dir)
      expect(help.stdout).toContain('compile')
      expect(help.stdout).toContain('decompile')
      expect(help.stdout).toContain('detect')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
