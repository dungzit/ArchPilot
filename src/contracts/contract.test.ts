/**
 * Contract tests - the TypeScript half of the shared contract (build-scope D4 / task 0.6).
 *
 * This file and `ArchPilot/backend/tests/test_contracts.py` read the SAME schema
 * (`contracts/archgraph.schema.json`) and the SAME fixture manifest
 * (`contracts/fixtures/index.json`). Nothing is duplicated except the validator
 * library: ajv here, jsonschema there, both JSON Schema 2020-12, so agreement
 * between the two languages is a property of the standard rather than of our
 * discipline.
 *
 * If you ever find yourself copying a fixture into `src/`, stop - the contract is
 * already broken at that moment.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020'
import type { ErrorObject, ValidateFunction } from 'ajv'
import { describe, expect, it } from 'vitest'
import { migrateGraph } from '../domain/graph/migrate'
import type { ArchGraph } from '../domain/graph/types'
import { INTEGRITY_RULES, validateGraph } from '../domain/graph/validate'
import { neutralityHits } from '../test/neutrality'

interface FixtureCase {
  fixture: string
  schemaRef: string
  expect: 'valid' | 'invalid'
  rule: 'graph-shape' | 'casing' | 'error-shape' | 'timestamp'
  expectKeyword?: string
  why: string
}

const here = dirname(fileURLToPath(import.meta.url))
const contractsDir = resolve(here, '../../contracts')
const fixturesDir = resolve(contractsDir, 'fixtures')

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf-8'))

const contract = readJson(resolve(contractsDir, 'archgraph.schema.json')) as {
  $id: string
  $defs: Record<string, unknown>
}
interface IntegrityCase {
  fixture: string
  schemaRef: string
  expect: 'integrity-error'
  expectRule: string
  why: string
}

interface MigrationPair {
  from: string
  to: string
  input: string
  expected: string
  options: Record<string, string>
}

const manifest = readJson(resolve(fixturesDir, 'index.json')) as {
  contract: string
  cases: FixtureCase[]
  integrityRules: { code: string; appliesTo: string[]; statement: string }[]
  integrityCases: IntegrityCase[]
  migrations: MigrationPair[]
}

// ajv v8 is published as CommonJS; under ESM the class arrives on `.default`
// in some bundler/runtime combinations and directly in others.
const AjvCtor = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ??
  Ajv2020) as typeof Ajv2020

const ajv = new AjvCtor({ strict: false, allErrors: true })
ajv.addSchema(contract)

function validatorFor(schemaRef: string): ValidateFunction {
  const validate = ajv.getSchema(contract.$id + schemaRef)
  if (!validate) throw new Error(`no such pointer in the contract: ${schemaRef}`)
  return validate
}

/**
 * Flatten errors to `keyword|schema/path`, the same shape the Python suite
 * builds, so one `expectKeyword` string in the manifest works for both.
 */
function errorSignature(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? []).map((error) => `${error.keyword}|${error.schemaPath}`).join(' ')
}

const loadFixture = (name: string): unknown => readJson(resolve(fixturesDir, name))

const validCases = manifest.cases.filter((c) => c.expect === 'valid')
const invalidCases = manifest.cases.filter((c) => c.expect === 'invalid')

describe('shared contract: fixtures', () => {
  it.each(validCases.map((c) => [c.fixture, c] as const))(
    'accepts %s',
    (_name, testCase) => {
      const validate = validatorFor(testCase.schemaRef)
      const ok = validate(loadFixture(testCase.fixture))
      expect(errorSignature(validate.errors)).toBe('')
      expect(ok).toBe(true)
    },
  )

  // The half people skip. A deliberately-broken fixture that fails for an
  // accidental reason proves the validator ran, not that the rule is enforced.
  it.each(invalidCases.map((c) => [c.fixture, c] as const))(
    'rejects %s for the intended reason',
    (_name, testCase) => {
      const validate = validatorFor(testCase.schemaRef)
      const ok = validate(loadFixture(testCase.fixture))
      expect(ok, `${testCase.fixture} must NOT validate`).toBe(false)
      expect(errorSignature(validate.errors)).toContain(testCase.expectKeyword)
    },
  )

  it('exercises every fixture file on disk', async () => {
    const { readdirSync } = await import('node:fs')
    const onDisk = readdirSync(fixturesDir)
      .filter((name) => name.endsWith('.json') && name !== 'index.json')
      .sort()
    const listed = [
      ...manifest.cases.map((c) => c.fixture),
      ...manifest.integrityCases.map((c) => c.fixture),
      ...manifest.migrations.flatMap((m) => [m.input, m.expected]),
    ]
    expect([...new Set(listed)].sort()).toEqual(onDisk)
  })

  it('keeps at least one broken fixture per rule', () => {
    const covered = new Set(invalidCases.map((c) => c.rule))
    for (const rule of ['graph-shape', 'casing', 'error-shape', 'timestamp']) {
      expect(covered.has(rule as FixtureCase['rule']), `no broken fixture for ${rule}`).toBe(true)
    }
  })

  it('points at the same contract file the Python suite loads', () => {
    expect(manifest.contract).toBe('../archgraph.schema.json')
    expect(contract.$id).toBe('https://archpilot.internal/contracts/archgraph.schema.json')
  })
})

// ---------------------------------------------------------------------------
// Contract 1.1.0 (task 0.2): the L1 integrity layer and the migration pair,
// from the same manifest backend/tests/test_contracts.py reads.
// ---------------------------------------------------------------------------

describe('shared contract: integrity layer (validateGraph vs graph_integrity.py)', () => {
  it('TypeScript implements exactly the manifest rules, in order', () => {
    expect([...INTEGRITY_RULES]).toEqual(manifest.integrityRules.map((rule) => rule.code))
  })

  it.each(manifest.integrityCases.map((c) => [c.fixture, c] as const))(
    '%s is contract-valid and fails integrity on its named rule',
    (_name, testCase) => {
      const document = loadFixture(testCase.fixture)
      const validate = validatorFor(testCase.schemaRef)
      expect(validate(document), errorSignature(validate.errors)).toBe(true)
      const errors = validateGraph(document as ArchGraph).filter((problem) => problem.severity === 'error')
      expect(errors.map((problem) => problem.ruleId)).toContain(testCase.expectRule)
    },
  )

  it.each(validCases.filter((c) => c.schemaRef === '#/$defs/archGraph').map((c) => [c.fixture, c] as const))(
    '%s is integrity-clean',
    (_name, testCase) => {
      const errors = validateGraph(loadFixture(testCase.fixture) as ArchGraph).filter((problem) => problem.severity === 'error')
      expect(errors).toEqual([])
    },
  )
})

describe('shared contract: migration pairs', () => {
  it.each(manifest.migrations.map((m) => [`${m.from} -> ${m.to}`, m] as const))('%s: migrateGraph(input) is exactly expected', (_name, pair) => {
    const input = loadFixture(pair.input) as ArchGraph
    const expected = loadFixture(pair.expected)
    expect(input.schemaVersion).toBe(pair.from)
    const migrated = migrateGraph(input, pair.options)
    expect(migrated).toEqual(expected)
    expect(JSON.stringify(migrated)).toBe(JSON.stringify(expected))
    expect(validatorFor('#/$defs/archGraph')(migrated)).toBe(true)
  })
})

describe('shared contract: 2.0 documents keep the envelope rules (review B2)', () => {
  const v2Valid = validCases.filter((c) => c.schemaRef === '#/$defs/archGraph' && (loadFixture(c.fixture) as ArchGraph).schemaVersion === '2.0')

  it('there are 2.0 documents to check', () => {
    expect(v2Valid.length).toBeGreaterThanOrEqual(3)
  })

  it.each(v2Valid.map((c) => [c.fixture] as const))('%s is camelCase at every depth', (fixture) => {
    const validate = validatorFor('#/$defs/camelCaseObject')
    expect(validate(loadFixture(fixture)), errorSignature(validate.errors)).toBe(true)
  })

  it.each(v2Valid.map((c) => [c.fixture] as const))('%s is provider-neutral outside deployment (NFR2-NEUT-001)', (fixture) => {
    expect(neutralityHits(loadFixture(fixture), '$', new Set(['$.deployment']))).toEqual([])
  })

  it('the rich fixture really does carry provider data - inside deployment only', () => {
    const rich = loadFixture('archgraph.v2-hybrid-orders.valid.json')
    expect(neutralityHits(rich).length).toBeGreaterThan(0)
    expect(neutralityHits(rich).every(([path]) => path.startsWith('$.deployment'))).toBe(true)
  })
})

describe('shared contract: envelope rules applied to TypeScript-produced values', () => {
  // Python asserts these against live API responses. TypeScript asserts them
  // against the values the SPA itself will produce, so drift is caught on the
  // side that introduces it.
  it('rule (c): a timestamp the SPA generates is contract-legal', () => {
    const iso = new Date(Date.UTC(2026, 8, 23, 6, 26, 52)).toISOString()
    expect(validatorFor('#/$defs/timestamp')(iso)).toBe(true)
  })

  it('rule (c): Date#toString and Date#toLocaleString are not', () => {
    const validate = validatorFor('#/$defs/timestamp')
    expect(validate(new Date(Date.UTC(2026, 8, 23)).toString())).toBe(false)
    expect(validate('2026-09-23T06:26:52')).toBe(false)
  })

  it('rule (a): an empty object is trivially camelCase', () => {
    expect(validatorFor('#/$defs/camelCaseObject')({})).toBe(true)
  })

  it('rule (b): an Error-shaped body is not an error envelope', () => {
    const validate = validatorFor('#/$defs/errorResponse')
    expect(validate({ message: 'boom' })).toBe(false)
    expect(validate({ detail: 'boom' })).toBe(true)
  })
})
