/**
 * Determinism (NFR2-DET-001..003, REQ-IAC-014, SC-17, TC-DET-TZ; design-v2
 * 4.4.11 "two runs, 5 permutations with position jitter, a label rename,
 * retarget round trip, TZ matrix").
 */
import { afterEach, describe, expect, it } from 'vitest'
import { sha256Hex } from '../graph/hash'
import type { ArchGraphV2 } from '../graph/types'
import { packageZip, type PackageResult } from './core/generate'
import { generateGolden, goldenCases, loadFixture, type GoldenCase } from './testing/goldens'

const originalTz = process.env.TZ
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

function digest(result: PackageResult): string {
  expect(result.ok, JSON.stringify(result.problems.filter((problem) => problem.severity === 'error'))).toBe(true)
  return sha256Hex(Buffer.from(packageZip([result])).toString('base64'))
}

/** Deterministic pseudo-random permutation (no Math.random in the suite either). */
function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items]
  let s = seed
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) % 2147483648
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const cases = goldenCases()

describe.each(cases.map((c) => [c.fixture, c] as const))('%s', (_name, c: GoldenCase) => {
  const baseline = digest(generateGolden(c))

  it('two runs give the same bytes', () => {
    expect(digest(generateGolden(c))).toBe(baseline)
  })

  it('5 permutations of node and edge order, with position jitter, change nothing', () => {
    for (let seed = 1; seed <= 5; seed += 1) {
      const doc = loadFixture(c.fixture)
      doc.nodes = shuffle(doc.nodes, seed).map((node, index) => ({ ...node, position: { x: node.position.x + index * 7 + seed, y: node.position.y - seed } }))
      doc.edges = shuffle(doc.edges, seed * 31)
      expect(digest(generateGolden(c, doc)), `seed ${seed}`).toBe(baseline)
    }
  })

  it('renaming every label (nodes, edges, profiles, scenarios) changes nothing (NFR2-DET-003)', () => {
    const doc = loadFixture(c.fixture)
    doc.nodes = doc.nodes.map((node) => ({ ...node, label: `${node.label} renamed ${'${x}'}`, rationale: 'changed' }))
    doc.edges = doc.edges.map((edge) => ({ ...edge, label: 'renamed' }))
    doc.deployment!.profiles = doc.deployment!.profiles.map((profile) => ({ ...profile, label: 'Renamed' }))
    doc.deployment!.scenarios = doc.deployment!.scenarios.map((scenario) => ({ ...scenario, label: 'Renamed' }))
    expect(digest(generateGolden(c, doc))).toBe(baseline)
  })

  it('retarget away and back gives the original bytes (SC-17, NFR2-DET-002)', () => {
    const doc: ArchGraphV2 = loadFixture(c.fixture)
    const deployment = doc.deployment!
    // Away: a second profile and scenario, bindings for the other target, the other scenario active.
    deployment.profiles.push({ id: 'elsewhere', target: 'bare_metal', label: 'Elsewhere' })
    deployment.scenarios.push({ id: 'away', label: 'Away', defaultProfileId: 'elsewhere' })
    deployment.bindings = [...(deployment.bindings ?? []), ...doc.nodes.slice(0, 2).map((node) => ({ nodeId: node.id, target: 'bare_metal', realisation: 'bare_metal.anything' }))]
    const home = deployment.activeScenarioId ?? deployment.scenarios[0].id
    deployment.activeScenarioId = 'away'
    const away = generateGolden(c, doc)
    expect(away.coverage?.totals.other).toBe(doc.nodes.length)
    // Back.
    deployment.activeScenarioId = home
    expect(digest(generateGolden(c, doc))).toBe(baseline)
  })

  it('TC-DET-TZ: the same bytes under four time zones', () => {
    for (const zone of ['Asia/Ho_Chi_Minh', 'America/Los_Angeles', 'UTC', 'Pacific/Kiritimati']) {
      process.env.TZ = zone
      expect(digest(generateGolden(c)), zone).toBe(baseline)
    }
  })
})
