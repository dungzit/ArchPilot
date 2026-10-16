/**
 * Deterministic zip (design-v2 4.4.11; REQ-IAC-009; review M2).
 *
 * - fflate 0.8.3, pinned exactly: deflate output can change between versions,
 *   so a bump is a reviewed golden diff (the zip SHA-256 is golden-tested).
 * - fflate writes DOS times from LOCAL-time getters. The mtime is therefore
 *   built with the LOCAL constructor, `new Date(2000, 0, 1, 0, 0, 0)`: every
 *   time zone reads back 2000-01-01 00:00:00, so the bytes never depend on
 *   TZ and the export never throws west of UTC (a UTC 1980 date would be
 *   1979 there, fflate error 10). Tested under two TZ values.
 * - Entries are inserted in sorted path order, Unix regular-file mode 0644.
 * - Path guard: only the adapter's declared files, a strict character set,
 *   no `..`, no leading `/`, no `\`, at most 200 characters.
 */
import { strToU8, zipSync, type ZipAttributes, type Zippable } from 'fflate'
import { byCodeUnit } from './text'
import type { GeneratedFile } from './types'

/**
 * Local-time constructor on purpose (see above), built at call time so it is
 * read in the time zone in force when the zip is written. The only
 * clock-shaped value in src/domain/iac.
 */
export function zipMtime(): Date {
  return new Date(2000, 0, 1, 0, 0, 0)
}

const SAFE_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/
const SAFE_ROOT = /^[a-z0-9][a-z0-9-]{0,99}$/
const MAX_PATH = 200

export class ZipPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipPathError'
  }
}

export function assertSafePath(path: string, allowed: ReadonlySet<string>): void {
  if (path.length === 0 || path.length > MAX_PATH) throw new ZipPathError(`path length ${path.length} is out of range: ${JSON.stringify(path)}`)
  if (!SAFE_PATH.test(path)) throw new ZipPathError(`path ${JSON.stringify(path)} has characters outside [A-Za-z0-9._-/]`)
  if (path.split('/').some((segment) => segment === '..' || segment === '.')) throw new ZipPathError(`path ${JSON.stringify(path)} has a relative segment`)
  if (!allowed.has(path)) throw new ZipPathError(`path ${JSON.stringify(path)} is not in the adapter's emitted-file list`)
}

export interface ZipRoot {
  /** One root folder per target profile. */
  root: string
  files: GeneratedFile[]
  /** The adapter's `emittedFiles`. */
  allowed: readonly string[]
}

export function buildZip(roots: ZipRoot[]): Uint8Array {
  const entries: { path: string; data: Uint8Array }[] = []
  const rootNames = new Set<string>()
  for (const { root, files, allowed } of roots) {
    if (!SAFE_ROOT.test(root)) throw new ZipPathError(`root folder ${JSON.stringify(root)} is not a safe name`)
    if (rootNames.has(root)) throw new ZipPathError(`root folder ${root} appears twice`)
    rootNames.add(root)
    const allowedSet = new Set(allowed)
    const seen = new Set<string>()
    for (const file of files) {
      assertSafePath(file.path, allowedSet)
      if (seen.has(file.path)) throw new ZipPathError(`path ${file.path} appears twice`)
      seen.add(file.path)
      const full = `${root}/${file.path}`
      if (full.length > MAX_PATH) throw new ZipPathError(`path ${full} is longer than ${MAX_PATH}`)
      entries.push({ path: full, data: strToU8(file.content) })
    }
  }
  entries.sort((a, b) => byCodeUnit(a.path, b.path))
  const mtime = zipMtime()
  const attributes: ZipAttributes = { mtime, os: 3, attrs: (0o100644 << 16) >>> 0 }
  const zippable: Zippable = {}
  for (const entry of entries) zippable[entry.path] = [entry.data, { ...attributes, level: 6 }]
  return zipSync(zippable, { level: 6, mtime })
}
