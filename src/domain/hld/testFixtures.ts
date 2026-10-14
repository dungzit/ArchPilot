/**
 * Test-only fixtures for the HLD export (not imported by application code).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReferencePin, SizingRun } from '../../contracts/pilot'
import type { ArchGraphV2 } from '../graph/types'
import type { HldInput, HldMeta } from './types'

export function hybridGraph(): ArchGraphV2 {
  const path = resolve(dirname(fileURLToPath(import.meta.url)),'../../../contracts/fixtures/archgraph.v2-hybrid-orders.valid.json')
  return JSON.parse(readFileSync(path, 'utf-8')) as ArchGraphV2
}

export const KAFKA_RUN: SizingRun = {
  id: 'run_1',
  designId: 'dsg_1',
  componentLabel: 'Kafka cluster (Prod)',
  rulePackId: 'builtin-kafka',
  rulePackVersion: 3,
  modelId: 'kafka-brokers',
  modelName: 'Kafka brokers',
  inputs: [
    { name: 'throughput', value: 1234.5, unit: 'MB/s', source: 'customer RFP' },
    { name: 'retention', value: 7, unit: 'day' },
  ],
  steps: [
    { name: 'storage', formula: 'throughput * retention', substituted: '1234.5 MB/s * 7 day', value: 746625.6, unit: 'GB' },
    { name: 'brokers', formula: 'ceil(storage / disk)', substituted: 'ceil(746625.6 GB / 12000 GB)', value: 63, unit: 'count' },
  ],
  outputs: [
    { name: 'brokers', value: 63, unit: 'count', label: 'Broker count' },
    { name: 'storage', value: 746625.6, unit: 'GB', label: 'Total storage' },
  ],
  binding: 'brokers',
  warnings: [{ severity: 'high', messageVi: 'Số broker vượt 50', messageEn: 'More than 50 brokers' }],
  createdAt: '2026-10-14T08:30:00Z',
}

export const REDIS_RUN: SizingRun = {
  id: 'run_2',
  designId: 'dsg_1',
  componentLabel: null,
  rulePackId: 'builtin-redis',
  rulePackVersion: 1,
  modelId: 'redis-memory',
  modelName: 'Redis memory',
  inputs: [{ name: 'keys', value: 2000000, unit: 'count', source: 'catalog' }],
  steps: [{ name: 'memory', formula: 'keys * 0.0005', substituted: '2000000 * 0.0005', value: 1000, unit: 'MB' }],
  outputs: [{ name: 'memory', value: 1000, unit: 'MB' }],
  binding: null,
  warnings: [],
  createdAt: '2026-10-14T09:00:00Z',
}

export const PIN: ReferencePin = {
  id: 'pin_1',
  designId: 'dsg_1',
  shareId: 'abc123',
  url: 'https://www.sysdesai.com/share/abc123',
  title: 'Design Kafka event pipeline',
  stepPosition: 8,
  stepTitle: 'Storage sizing',
  note: 'Compare broker count',
  createdAt: '2026-10-14T10:00:00Z',
}

export const META: HldMeta = {
  customer: 'Ngân hàng ABC',
  projectName: 'Orders Platform',
  version: '1.2',
  author: 'Nguyễn Văn A',
  reviewer: 'Trần Thị B',
  date: '2026-10-15',
}

export function fullInput(overrides: Partial<HldInput> = {}): HldInput {
  return {
    design: { id: 'dsg_1', name: 'Orders platform', graph: hybridGraph(), revision: 4 },
    runs: [KAFKA_RUN, REDIS_RUN],
    pins: [PIN],
    meta: META,
    manual: { intro: 'Mục đích: kiểm thử.', risks: '- Thiếu dữ liệu tải thực tế\n- Nhà cung cấp chậm giao hàng', questions: 'Tải đỉnh là bao nhiêu? | 1500 rps\nCó cần DR không?' },
    language: 'vi',
    ...overrides,
  }
}

export function emptyInput(overrides: Partial<HldInput> = {}): HldInput {
  return {
    design: { id: 'dsg_empty', name: 'Empty', graph: { schemaVersion: '2.0', settings: { codeName: 'empty', environment: 'dev' }, nodes: [], edges: [] } },
    runs: [],
    pins: [],
    meta: { customer: '', projectName: '', version: '', author: '', reviewer: '', date: '' },
    manual: {},
    language: 'en',
    ...overrides,
  }
}
