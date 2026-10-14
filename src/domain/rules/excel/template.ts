/**
 * Downloadable Excel template (WP-A2): the Kafka example of docs/v3/05 §9 as
 * an excel-mode model, written through the normal exporter.
 *
 * exceljs cannot calculate, so the cached results below are written with each
 * formula; Excel shows them at once and recalculates on open. template.test.ts
 * recomputes them with plain arithmetic so they cannot drift.
 */
import type { SizingModelDef } from '../../../contracts/pilot'
import { exportRulePackToXlsx, type ExportResult, type PackForExcel } from './exporter'

export const KAFKA_TEMPLATE_MODEL: SizingModelDef = {
  id: 'kafka',
  nameVi: 'Cụm Kafka',
  nameEn: 'Kafka cluster',
  componentType: 'kafka',
  description: 'Ví dụ 05 §9: số broker theo throughput và dung lượng lưu trữ. / Example 05 §9: brokers by throughput and storage.',
  formulaMode: 'excel',
  inputs: [
    { name: 'ingress', labelVi: 'Lưu lượng ghi vào', labelEn: 'Ingress throughput', unit: 'MB/s', default: 150, min: 0, source: 'customer' },
    { name: 'rf', labelVi: 'Hệ số nhân bản', labelEn: 'Replication factor', unit: 'count', default: 3, min: 1, max: 7, source: 'customer' },
    { name: 'retention_days', labelVi: 'Số ngày lưu', labelEn: 'Retention', unit: 'day', default: 3, min: 0, source: 'customer' },
    // Lead decision (QA F-03): a numeric 0/1 flag instead of a text `env`, since test inputs are numbers.
    { name: 'is_prod', labelVi: 'Môi trường Prod (1 = có, 0 = không)', labelEn: 'Production environment (1 = yes, 0 = no)', unit: 'flag', default: 1, min: 0, max: 1, source: 'customer' },
  ],
  params: [
    { name: 'broker_write', value: 100, unit: 'MB/s', source: 'catalog:kafka.broker_write_mbps' },
    { name: 'target_util', value: 0.6, unit: 'ratio', source: 'Target utilisation 60%' },
    { name: 'disk_per_broker', value: 12, unit: 'TB', source: 'Broker disk size' },
    { name: 'disk_fill', value: 0.7, unit: 'ratio', source: 'Max disk fill 70%' },
  ],
  calc: [
    {
      name: 'tp_brokers',
      formula: 'ceil(ingress * rf / broker_write / target_util)',
      excelFormula: '=CEILING(ingress*rf/broker_write/target_util,1)',
      unit: 'count',
      description: 'Brokers needed for throughput',
    },
    {
      name: 'storage_tb',
      formula: 'ingress * 86400 * retention_days * rf / 1000000',
      excelFormula: '=ingress*86400*retention_days*rf/1000000',
      unit: 'TB',
      description: 'Retained data incl. replicas (MB -> TB)',
    },
    {
      name: 'storage_brokers',
      formula: 'ceil(storage_tb / (disk_per_broker * disk_fill))',
      excelFormula: '=CEILING(storage_tb/(disk_per_broker*disk_fill),1)',
      unit: 'count',
      description: 'Brokers needed for storage',
    },
    {
      name: 'brokers',
      formula: 'max(tp_brokers, storage_brokers, rf)',
      excelFormula: '=MAX(tp_brokers,storage_brokers,rf)',
      unit: 'count',
      description: 'Binding constraint: max of throughput, storage, rf',
    },
  ],
  outputs: [
    { name: 'brokers', from: 'brokers', unit: 'count', rounding: 'none', labelVi: 'Số broker', labelEn: 'Brokers' },
    { name: 'storage_tb', from: 'storage_tb', unit: 'TB', rounding: 'none', labelVi: 'Dung lượng lưu trữ', labelEn: 'Storage' },
  ],
  warnings: [
    {
      // Excel text in the Warnings sheet: AND(rf<3,is_prod=1)
      condition: '(rf < 3 and is_prod == 1)',
      severity: 'high',
      messageVi: 'Replication factor < 3 ở môi trường Prod: mất một broker có thể làm mất dữ liệu.',
      messageEn: 'Replication factor < 3 in Prod: losing one broker can lose data.',
    },
  ],
  lookups: [],
  tests: [
    // Relative tolerance 1e-6 (lead decision on QA F-05; 05 §9's 0.01 is too loose).
    { id: 'T1', inputs: { ingress: 150, rf: 3, retention_days: 3, is_prod: 1 }, expected: { brokers: 14, storage_tb: 116.64 }, tolerance: 0.000001 },
  ],
}

export const KAFKA_TEMPLATE_PACK: PackForExcel = {
  name: 'Kafka sizing (template)',
  description: 'Template ArchPilot: sửa hoặc thêm model rồi import lại. / ArchPilot template: edit or add models, then import.',
  version: 1,
  models: [KAFKA_TEMPLATE_MODEL],
}

/** Cached results written next to each template formula (see template.test.ts). */
export const KAFKA_TEMPLATE_RESULTS: Record<string, number> = {
  tp_brokers: 8,
  storage_tb: 116.64,
  storage_brokers: 14,
  brokers: 14,
}

export const TEMPLATE_FILE_NAME = 'archpilot-rule-template.xlsx'

/** Build the template workbook (.xlsx bytes). */
export async function buildTemplateWorkbook(): Promise<ExportResult> {
  const result = await exportRulePackToXlsx(KAFKA_TEMPLATE_PACK, {
    cachedResults: (model) => (model.id === KAFKA_TEMPLATE_MODEL.id ? KAFKA_TEMPLATE_RESULTS : null),
  })
  return { ...result, fileName: TEMPLATE_FILE_NAME }
}
