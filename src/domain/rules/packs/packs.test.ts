/**
 * Built-in pack `archpilot-core` (pilot WP-A): every model compiles, every
 * embedded test passes, and the golden figures from docs/v3/02 and 05 are
 * asserted here independently of the pack's own test data, so a pack edit
 * cannot quietly "fix" a golden by changing both sides.
 */
import { describe, expect, test } from 'vitest'
import type { SizingModelDef, SizingRun } from '../../../contracts/pilot'
import { compileModel, evaluateModel, runModelTests } from '../engine'
import { ARCHPILOT_CORE_PACK, BUILT_IN_PACKS } from './index'

const META = { rulePackId: 'archpilot-core', rulePackVersion: 1 }

function model(id: string): SizingModelDef {
  const found = ARCHPILOT_CORE_PACK.models.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`no model ${id}`)
  return found
}

const out = (run: SizingRun, name: string) => run.outputs.find((output) => output.name === name)?.value
const step = (run: SizingRun, name: string) => run.steps.find((candidate) => candidate.name === name)

describe('archpilot-core pack', () => {
  test('is one published built-in pack with the six models', () => {
    expect(BUILT_IN_PACKS).toHaveLength(1)
    expect(ARCHPILOT_CORE_PACK).toMatchObject({ id: 'archpilot-core', version: 1, builtIn: true, status: 'published' })
    expect(ARCHPILOT_CORE_PACK.models.map((candidate) => candidate.id)).toEqual(['app-tier', 'redis', 'vmware-host', 'kafka', 'rdbms', 'san-storage'])
  })

  test.each(ARCHPILOT_CORE_PACK.models.map((candidate) => [candidate.id, candidate] as const))('%s compiles, has tests and every test passes', (_id, candidate) => {
    expect(compileModel(candidate)).toEqual({ ok: true })
    const results = runModelTests(candidate)
    expect(results.length).toBeGreaterThanOrEqual(3)
    for (const result of results) expect(result, `${candidate.id} ${result.testId}`).toMatchObject({ passed: true, failures: [] })
  })

  test('every output of every model is covered by at least one test (05 §7 Testing gate)', () => {
    for (const candidate of ARCHPILOT_CORE_PACK.models) {
      const covered = new Set(candidate.tests.flatMap((t) => Object.keys(t.expected)))
      for (const output of candidate.outputs) expect(covered.has(output.name), `${candidate.id}.${output.name}`).toBe(true)
    }
  })
})

describe('golden figures (docs/v3/02 §7.1, §10 and 05 §9)', () => {
  test("app-tier: CCU 5000, response 1 s, think 9 s -> 500 req/s by Little's law", () => {
    const run = evaluateModel(model('app-tier'), { ccu: 5000, response_time: 1, think_time: 9 }, META)
    expect(out(run, 'rps')).toBeCloseTo(500, 9)
    expect(step(run, 'rps')!.substituted).toBe('5000 user / (1 s + 9 s)')
    expect(out(run, 'instances')).toBe(6)
    expect(run.binding).toBe('instances_cpu')
  })

  test('redis: 50M keys x 630 B = 31.5 GB, 45 GB per copy, 90 GB total, 2 shards', () => {
    const run = evaluateModel(model('redis'), {}, META)
    expect(out(run, 'data')).toBeCloseTo(31.5, 9)
    expect(out(run, 'mem_per_copy')).toBeCloseTo(45, 9)
    expect(out(run, 'total_mem')).toBeCloseTo(90, 9)
    expect(out(run, 'shards')).toBe(2)
    expect(run.binding).toBe('shards_mem')
    expect(step(run, 'data')!.substituted).toBe('50000000 key × 630 B')
    expect(step(run, 'shards_mem')!.substituted).toBe('ceil(45 GB / 25 GB) = ceil(1.8)')
  })

  test('vmware-host: 253.33 pCores, 6 CPU hosts, 3 RAM hosts, 7 hosts, binding CPU', () => {
    const run = evaluateModel(model('vmware-host'), {}, META)
    expect(step(run, 'pcores')!.value).toBeCloseTo(253.333333, 5)
    expect(step(run, 'cores_needed')!.value).toBeCloseTo(361.904762, 5)
    expect(out(run, 'cpu_hosts')).toBe(6)
    expect(step(run, 'ram_needed')!.value).toBeCloseTo(2925.714286, 5)
    expect(out(run, 'ram_hosts')).toBe(3)
    expect(out(run, 'hosts')).toBe(7)
    expect(run.binding).toBe('cpu_hosts')
    expect(step(run, 'hosts')!.substituted).toBe('max(6 host, 3 host) + 1 host')
  })

  test('kafka: tp 8, storage 116.64 TB, storage brokers 14, brokers 14, binding storage', () => {
    const run = evaluateModel(model('kafka'), { ingress: 150, rf: 3, retention: 3 }, META)
    expect(out(run, 'tp_brokers')).toBe(8)
    expect(out(run, 'storage')).toBeCloseTo(116.64, 9)
    expect(out(run, 'storage_brokers')).toBe(14)
    expect(out(run, 'brokers')).toBe(14)
    expect(run.binding).toBe('storage_brokers')
    expect(run.warnings).toEqual([])
    expect(step(run, 'tp_brokers')!.substituted).toBe('ceil(150 MB/s × 3 / 100 MB/s / 0.6) = ceil(7.5)')
    expect(step(run, 'storage')!.substituted).toBe('convert(150 MB/s × 3 day × 3, "TB")')
    expect(step(run, 'storage_brokers')!.substituted).toBe('ceil(116.64 TB / (12 TB × 0.7)) = ceil(13.8857)')
    expect(step(run, 'brokers')!.substituted).toBe('max(8 broker, 14 broker, 3)')
  })

  test('kafka: rf < 3 in Prod raises the high warning; not outside Prod', () => {
    const prod = evaluateModel(model('kafka'), { rf: 2, is_prod: 1 }, META)
    expect(prod.warnings).toEqual([{ severity: 'high', messageVi: 'Replication factor < 3 ở môi trường Prod.', messageEn: 'Replication factor below 3 in Prod.' }])
    expect(evaluateModel(model('kafka'), { rf: 2, is_prod: 0 }, META).warnings).toEqual([])
  })

  test('kafka: throughput-bound case does not round 30.000000000000004 up to 31', () => {
    const run = evaluateModel(model('kafka'), { ingress: 600, retention: 0.5 }, META)
    expect(out(run, 'tp_brokers')).toBe(30)
    expect(run.binding).toBe('tp_brokers')
  })

  test('san-storage: RAID6 lookup, disks from capacity, binding data_disks through roundup_to', () => {
    const run = evaluateModel(model('san-storage'), {}, META)
    expect(step(run, 'raid_factor')!.substituted).toBe('lookup(raid, 6 → factor = 1.25)')
    expect(out(run, 'total_disks')).toBe(21)
    expect(run.binding).toBe('data_disks')
    const iopsBound = evaluateModel(model('san-storage'), { usable: 50, raid_level: 10, snapshot_reserve: 0.1, disk_size: 3.84, host_iops: 200_000, read_ratio: 0.5 }, META)
    expect(iopsBound.binding).toBe('iops_disks')
  })

  test('san-storage: an unknown RAID level fails at run time naming the step', () => {
    expect(() => evaluateModel(model('san-storage'), { raid_level: 7 }, META)).toThrow(/evaluation error at calc\.raid_factor: lookup table "raid" has no row with key 7/)
  })

  test('rdbms: compound growth, IOPS after buffer hits, RAM rounded to 16 GB, warning text interpolated', () => {
    const run = evaluateModel(model('rdbms'), {}, META)
    expect(step(run, 'data_future')!.value).toBeCloseTo(1098.5, 9)
    expect(out(run, 'ram')).toBeCloseTo(304, 9)
    expect(step(run, 'ram')!.substituted).toBe('roundup_to(297.61 GB, 16 GB)')
    expect(run.binding).toBeNull()
    const large = evaluateModel(model('rdbms'), { tps: 5000, reads_per_txn: 10, writes_per_txn: 4 }, META)
    expect(large.warnings.map((w) => w.messageEn)).toEqual(['IOPS per node 41666.7 IOPS above 20,000: needs an NVMe/all-flash tier.'])
  })

  test('a run carries meta, defaults and param provenance', () => {
    const run = evaluateModel(model('kafka'), { ingress: 200 }, { ...META, designId: 'dsg_1', componentLabel: 'Kafka (Prod)' })
    expect(run).toMatchObject({ rulePackId: 'archpilot-core', rulePackVersion: 1, modelId: 'kafka', modelName: 'Kafka cluster', designId: 'dsg_1', componentLabel: 'Kafka (Prod)' })
    expect(run.inputs.find((i) => i.name === 'ingress')).toEqual({ name: 'ingress', value: 200, unit: 'MB/s', source: 'user' })
    expect(run.inputs.find((i) => i.name === 'rf')).toEqual({ name: 'rf', value: 3, unit: 'count', source: 'HA policy' })
    expect(run.inputs.find((i) => i.name === 'broker_write')).toEqual({ name: 'broker_write', value: 100, unit: 'MB/s', source: 'param: catalog: kafka.broker_write_mbps' })
    expect(run.steps.map((s) => s.name)).toEqual(model('kafka').calc.map((c) => c.name))
  })
})
