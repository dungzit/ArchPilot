/**
 * Task 1.2 / SC-18: the adapter interface admits non-Terraform tools, and the
 * registry enforces REQ-ADP-006. The stubs run through the UNCHANGED core
 * (coverage, gate runner, Markdown files, manifest, zip).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { ArchGraphV2 } from '../../graph/types'
import { createDefaultRegistry } from '../index'
import { acmeTerraformStub, ansibleStubAdapter, leakyStubAdapter } from '../testing/stubAdapters'
import { FIXTURES_DIR, GOLDEN_DIR } from '../testing/goldens'
import { generatePackage, packageZip } from './generate'
import { AdapterRegistrationError, createRegistry } from './registry'

function hostsDesign(target: string): ArchGraphV2 {
  return {
    schemaVersion: '2.0',
    settings: { codeName: 'farm', environment: 'lab' },
    nodes: [
      { id: 'h1', type: 'bare_metal_host', label: 'Host one', codeName: 'host_one', position: { x: 0, y: 0 } },
      { id: 'h2', type: 'bare_metal_host', label: 'Host two', codeName: 'host_two', position: { x: 100, y: 0 } },
      { id: 's1', type: 'san', label: 'Array', codeName: 'array', position: { x: 200, y: 0 } },
      { id: 'n1', type: 'note', label: 'Note', codeName: 'note_1', position: { x: 300, y: 0 } },
    ],
    edges: [{ id: 'e1', source: 'h1', target: 'h2', label: '', direction: 'forward', kind: 'access', mode: 'connect' }],
    deployment: { profiles: [{ id: 'lab', target, label: 'Lab' }], scenarios: [{ id: 'main', label: 'Main', defaultProfileId: 'lab' }] },
  }
}

describe('registry (REQ-ADP-005, REQ-ADP-006)', () => {
  it('refuses a shipped adapter without goldens or CI validation commands', () => {
    const registry = createRegistry()
    expect(() => registry.register(ansibleStubAdapter, 'shipped')).toThrow(/golden fixtures/)
    expect(() => registry.register({ ...ansibleStubAdapter, goldenFixtures: ['x'], validationCommands: [] }, 'shipped')).toThrow(/validation commands/)
    registry.register(ansibleStubAdapter, 'test')
    expect(() => registry.register(ansibleStubAdapter, 'test')).toThrow(AdapterRegistrationError)
    expect(() => registry.register({ ...ansibleStubAdapter, id: 'Bad Id' }, 'test')).toThrow(/not valid/)
    expect(() => registry.register({ ...ansibleStubAdapter, id: 'x-y', version: '1.0' }, 'test')).toThrow(/semver/)
  })

  it('lists adapters in a stable order; test adapters are hidden unless asked for', () => {
    const registry = createRegistry()
    registry.register(acmeTerraformStub, 'test')
    registry.register(ansibleStubAdapter, 'test')
    expect(registry.list().map((entry) => entry.adapter.id)).toEqual(['acme-terraform', 'ansible-stub'])
    expect(registry.forTarget('bare_metal')).toEqual([])
    expect(registry.forTarget('bare_metal', true).map((entry) => entry.adapter.id)).toEqual(['ansible-stub'])
  })

  it('the application registry: aws-terraform shipped with goldens on disk, vsphere-terraform a test spike', () => {
    const registry = createDefaultRegistry()
    expect(registry.list().map((entry) => [entry.adapter.id, entry.adapter.tool, entry.status])).toEqual([
      ['aws-terraform', 'terraform', 'shipped'], ['vsphere-terraform', 'terraform', 'test'],
    ])
    const index = JSON.parse(readFileSync(join(GOLDEN_DIR, 'index.json'), 'utf-8')) as { goldens: { fixture: string; adapter: string }[] }
    for (const { adapter } of registry.list()) {
      expect(adapter.goldenFixtures.length).toBeGreaterThan(0)
      for (const fixture of adapter.goldenFixtures) {
        expect(existsSync(join(FIXTURES_DIR, `${fixture}.json`)), fixture).toBe(true)
        expect(index.goldens.some((golden) => golden.fixture === fixture && golden.adapter === adapter.id), fixture).toBe(true)
      }
    }
  })
})

describe('non-Terraform and second-Terraform stubs run through the unchanged core (SC-18)', () => {
  const registry = createRegistry()
  registry.register(ansibleStubAdapter, 'test')
  registry.register(acmeTerraformStub, 'test')
  registry.register(leakyStubAdapter, 'test')

  it('ansible stub: YAML files, coverage, Markdown, manifest and zip', () => {
    const result = generatePackage(hostsDesign('bare_metal'), { profileId: 'lab', options: { pipeline: 'none' }, allowTestAdapters: true }, registry)
    expect(result.problems.filter((problem) => problem.severity === 'error')).toEqual([])
    expect(result.adapter).toEqual({ id: 'ansible-stub', version: '0.0.1', tool: 'ansible' })
    expect(result.files.map((file) => file.path)).toEqual(['COVERAGE.md', 'MANUAL-STEPS.md', 'README.md', 'archpilot-manifest.json', 'inventory.yml', 'site.yml'])
    expect(result.files.find((file) => file.path === 'inventory.yml')!.content).toBe('all:\n  hosts:\n    host_one: {}\n    host_two: {}\n')
    expect(result.coverage!.totals).toEqual({ generatable: 2, manual: 0, unsupported: 1, annotation: 1, other: 0 })
    expect(result.coverage!.edges).toEqual([{ edgeId: 'e1', source: 'h1', target: 'h2', kind: 'access', mode: 'connect', class: 'manual', note: 'Firewall request: see MANUAL-STEPS.md.' }])
    const manifest = JSON.parse(result.files.find((file) => file.path === 'archpilot-manifest.json')!.content)
    expect(manifest.adapter.tool).toBe('ansible')
    const entries = unzipSync(packageZip([result]))
    expect(Object.keys(entries)).toEqual(result.files.map((file) => `farm-lab/${file.path}`))
    expect(strFromU8(entries['farm-lab/site.yml'])).toContain('ansible.builtin.ping')
  })

  it('a test adapter is not used unless tests are allowed; the UI path then reports no adapter', () => {
    const result = generatePackage(hostsDesign('bare_metal'), { profileId: 'lab', options: { pipeline: 'none' } }, registry)
    expect(result.ok).toBe(false)
    expect(result.problems.map((problem) => problem.ruleId)).toEqual(['IAC-E08'])
  })

  it('acme terraform stub reuses the shared printer', () => {
    const result = generatePackage(hostsDesign('acme'), { profileId: 'lab', options: { pipeline: 'none' }, allowTestAdapters: true }, registry)
    expect(result.ok).toBe(true)
    expect(result.files.find((file) => file.path === 'main.tf')!.content).toContain('resource "terraform_data" "host_one" {\n  input = "host_one"\n')
  })

  it('IAC-E12: a secret in any emitted file blocks the package and names the file and line', () => {
    const result = generatePackage(hostsDesign('leaky'), { profileId: 'lab', options: { pipeline: 'none' }, allowTestAdapters: true }, registry)
    expect(result.ok).toBe(false)
    expect(result.files).toEqual([])
    expect(result.problems.filter((problem) => problem.ruleId === 'IAC-E12').map((problem) => problem.path)).toEqual(['inventory.yml:3'])
  })

  it('a pipeline the adapter does not ship is refused (IAC-E07)', () => {
    const result = generatePackage(hostsDesign('bare_metal'), { profileId: 'lab', options: { pipeline: 'github' }, allowTestAdapters: true }, registry)
    expect(result.problems.map((problem) => problem.ruleId)).toEqual(['IAC-E07'])
  })
})
