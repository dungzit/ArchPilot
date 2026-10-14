/**
 * Test-only helpers shared by the golden, determinism and security suites.
 * Reads fixtures from disk (Node), so the application never imports it.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ArchGraphV2 } from '../../graph/types'
import { generatePackage, type PackageResult } from '../core/generate'
import { createDefaultRegistry } from '../index'

export const IAC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
export const FIXTURES_DIR = join(IAC_DIR, '__fixtures__')
export const GOLDEN_DIR = join(IAC_DIR, '__golden__')

export const goldenRegistry = createDefaultRegistry()

export function loadFixture(name: string): ArchGraphV2 {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf-8')) as ArchGraphV2
}

export interface GoldenCase { fixture: string; adapterId: string; adapterVersion: string; profileId: string }

export function goldenCases(): GoldenCase[] {
  return goldenRegistry.list().flatMap(({ adapter }) => adapter.goldenFixtures.map((fixture) => {
    const doc = loadFixture(fixture)
    const profile = (doc.deployment?.profiles ?? []).find((candidate) => adapter.targetKinds.includes(candidate.target))
    if (!profile) throw new Error(`${fixture}: no profile for ${adapter.id}`)
    return { fixture, adapterId: adapter.id, adapterVersion: adapter.version, profileId: profile.id }
  }))
}

export function generateGolden(c: GoldenCase, doc: ArchGraphV2 = loadFixture(c.fixture)): PackageResult {
  return generatePackage(doc, { profileId: c.profileId, adapterId: c.adapterId, options: { pipeline: 'none' }, allowTestAdapters: true }, goldenRegistry)
}
