/**
 * Golden-file harness (design-v2 4.4.13; NFR2-COR-002, REQ-ADP-006, task 1.6).
 *
 * For every golden fixture declared by a registered adapter:
 * - the fixture is a real design document: contract-valid (ajv, the shared
 *   schema), integrity-clean, and neutral outside `deployment`;
 * - the generated package must equal `__golden__/<fixture>/<root>/` byte for
 *   byte, and the zip SHA-256 must equal `__golden__/<fixture>/zip.sha256`;
 * - `__golden__/index.json` lists every golden folder with its adapter's
 *   validation commands; CI (`iac-validate`) runs them with real Terraform.
 * - `__golden__/VERSION` records the generator and adapter versions and a hash
 *   of every golden byte. A golden change without a version bump is refused
 *   (set GOLDEN_BUMP_WAIVER=1 only for an unreleased version).
 *
 * UPDATE_GOLDEN=1 rewrites the goldens instead of comparing.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../graph/hash'
import { integrityErrors } from '../graph/validate'
import { neutralityHits } from '../../test/neutrality'
import { packageZip } from './core/generate'
import { stableJson } from './core/manifest'
import { GOLDEN_DIR, IAC_DIR, generateGolden, goldenCases, goldenRegistry, loadFixture } from './testing/goldens'
import { GENERATOR_VERSION } from './versions'
import { bytesToHex } from '@noble/hashes/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'

const goldenDir = GOLDEN_DIR
const UPDATE = process.env.UPDATE_GOLDEN === '1'
const registry = goldenRegistry
const here = IAC_DIR

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? listFiles(full) : [full]
  })
}

const contract = JSON.parse(readFileSync(resolve(here, '../../../contracts/archgraph.schema.json'), 'utf-8')) as { $id: string }
const AjvCtor = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020) as typeof Ajv2020
const ajv = new AjvCtor({ strict: false, allErrors: true })
ajv.addSchema(contract)
const validateArchGraph = ajv.getSchema(`${contract.$id}#/$defs/archGraph`)!

const cases = goldenCases()
const index: { fixture: string; adapter: string; version: string; dir: string; validationCommands: string[][] }[] = []
const allBytes: string[] = []

describe('golden fixtures are real, neutral design documents', () => {
  it.each(cases.map((c) => [c.fixture, c] as const))('%s is contract-valid, integrity-clean and neutral outside deployment', (_name, c) => {
    const doc = loadFixture(c.fixture)
    const ok = validateArchGraph(doc)
    expect(validateArchGraph.errors ?? []).toEqual([])
    expect(ok).toBe(true)
    expect(integrityErrors(doc)).toEqual([])
    expect(neutralityHits(doc, '$', new Set(['$.deployment']))).toEqual([])
  })
})

describe('golden packages (byte for byte)', () => {
  it.each(cases.map((c) => [`${c.fixture} / ${c.adapterId}`, c] as const))('%s', (_name, c) => {
    const result = generateGolden(c)
    expect(result.problems.filter((problem) => problem.severity === 'error')).toEqual([])
    expect(result.ok).toBe(true)
    const root = join(goldenDir, c.fixture, result.rootFolder!)
    const zip = packageZip([result])
    const zipSha = `${bytesToHex(sha256(zip))}\n`
    if (UPDATE) {
      rmSync(join(goldenDir, c.fixture), { recursive: true, force: true })
      for (const file of result.files) {
        mkdirSync(dirname(join(root, file.path)), { recursive: true })
        writeFileSync(join(root, file.path), file.content)
      }
      writeFileSync(join(goldenDir, c.fixture, 'zip.sha256'), zipSha)
    }
    const onDisk = listFiles(root).map((full) => relative(root, full).split('\\').join('/')).sort()
    expect(onDisk).toEqual(result.files.map((file) => file.path))
    for (const file of result.files) {
      expect(readFileSync(join(root, file.path), 'utf-8'), `${c.fixture}/${file.path}`).toBe(file.content)
      allBytes.push(`${c.fixture}/${file.path}:${sha256Hex(file.content)}`)
    }
    expect(readFileSync(join(goldenDir, c.fixture, 'zip.sha256'), 'utf-8')).toBe(zipSha)
    index.push({ fixture: c.fixture, adapter: c.adapterId, version: c.adapterVersion, dir: `${c.fixture}/${result.rootFolder}`, validationCommands: registry.get(c.adapterId)!.adapter.validationCommands })
  })

  it('index.json lists every golden folder with its validation commands (read by CI)', () => {
    const sorted = [...index].sort((a, b) => (a.dir < b.dir ? -1 : 1))
    const text = stableJson({ goldens: sorted })
    if (UPDATE) writeFileSync(join(goldenDir, 'index.json'), text)
    expect(readFileSync(join(goldenDir, 'index.json'), 'utf-8')).toBe(text)
    const folders = readdirSync(goldenDir).filter((name) => statSync(join(goldenDir, name)).isDirectory()).sort()
    expect(folders).toEqual([...new Set(sorted.map((entry) => entry.fixture))].sort())
  })

  it('VERSION: a golden change needs a generator or adapter version bump', () => {
    const versions = [`generator ${GENERATOR_VERSION}`, ...registry.list().map(({ adapter }) => `${adapter.id} ${adapter.version}`)]
    const contentHash = sha256Hex([...allBytes].sort().join('\n'))
    const text = `${versions.join('\n')}\ngoldens ${contentHash}\n`
    const path = join(goldenDir, 'VERSION')
    if (UPDATE) {
      const previous = existsSync(path) ? readFileSync(path, 'utf-8') : ''
      const sameVersions = previous.split('\n').slice(0, versions.length).join('\n') === versions.join('\n')
      if (previous && previous !== text && sameVersions && process.env.GOLDEN_BUMP_WAIVER !== '1') {
        throw new Error('Goldens changed but no generator or adapter version was bumped (design-v2 4.3.5).')
      }
      writeFileSync(path, text)
    }
    expect(readFileSync(path, 'utf-8')).toBe(text)
  })
})
