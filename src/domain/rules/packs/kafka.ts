import type { SizingModelDef } from '../../../contracts/pilot'

/**
 * Kafka brokers (05 §9, 02 §10). Brokers = max(throughput-bound,
 * storage-bound, RF); the trace in 02 §10 is this model's output.
 *
 * Assumptions:
 * - 100 MB/s sustained write per broker counts leader + follower writes
 *   (hence `ingress x rf`), held at 60% so a broker loss can be absorbed.
 * - Disk per broker 12 TB filled to 70% (catalog tech card).
 * - Storage = ingress x retention x RF; no compression credit (conservative).
 * - ~10 MB/s per partition for planning; never fewer partitions than brokers.
 * - Egress = consumers reading the full stream (`fanout`) + follower fetches
 *   (rf - 1), for NIC sizing.
 */
export const kafkaModel: SizingModelDef = {
  id: 'kafka',
  nameVi: 'Cụm Kafka',
  nameEn: 'Kafka cluster',
  componentType: 'kafka',
  description: 'Brokers = max(ceil(ingress x RF / broker write / util), ceil(storage / (disk x fill)), RF); storage = ingress x retention x RF.',
  formulaMode: 'units',
  inputs: [
    { name: 'ingress', labelVi: 'Lưu lượng ghi vào', labelEn: 'Ingress (producer) rate', unit: 'MB/s', default: 150, min: 0, source: 'customer (RFP)' },
    { name: 'rf', labelVi: 'Replication factor', labelEn: 'Replication factor', unit: 'count', default: 3, min: 1, max: 5, source: 'HA policy' },
    { name: 'retention', labelVi: 'Thời gian lưu', labelEn: 'Retention', unit: 'day', default: 3, min: 0, source: 'customer (RFP)' },
    { name: 'fanout', labelVi: 'Số consumer group đọc toàn bộ', labelEn: 'Consumer groups reading everything', unit: 'count', default: 2, min: 0, source: 'design' },
    { name: 'is_prod', labelVi: 'Môi trường Prod (1 = có, 0 = không)', labelEn: 'Production (1 = yes, 0 = no)', unit: 'count', default: 1, min: 0, max: 1, source: 'design' },
  ],
  params: [
    { name: 'broker_write', value: 100, unit: 'MB/s', source: 'catalog: kafka.broker_write_mbps' },
    { name: 'target_util', value: 0.6, unit: 'ratio', source: 'catalog: kafka tech card' },
    { name: 'disk_per_broker', value: 12, unit: 'TB', source: 'catalog: kafka tech card' },
    { name: 'disk_fill', value: 0.7, unit: 'ratio', source: 'catalog: kafka tech card' },
    { name: 'partition_write', value: 10, unit: 'MB/s', source: 'planning rule of thumb' },
  ],
  calc: [
    { name: 'tp_brokers', formula: 'ceil(ingress * rf / broker_write / target_util)', unit: 'broker', description: 'Throughput' },
    { name: 'storage', formula: 'convert(ingress * retention * rf, "TB")', unit: 'TB', description: 'Retained data incl. replicas' },
    { name: 'storage_brokers', formula: 'ceil(storage / (disk_per_broker * disk_fill))', unit: 'broker', description: 'Storage' },
    { name: 'brokers', formula: 'max(tp_brokers, storage_brokers, rf)', unit: 'broker', description: 'Binding constraint' },
    { name: 'disk_used_per_broker', formula: 'storage / brokers', unit: 'TB' },
    { name: 'partitions', formula: 'max(ceil(ingress / partition_write), brokers)', unit: 'partition' },
    { name: 'egress', formula: 'ingress * (fanout + rf - 1)', unit: 'MB/s', description: 'Consumers plus follower fetches' },
  ],
  outputs: [
    { name: 'brokers', from: 'brokers', unit: 'broker', rounding: 'ceil', labelVi: 'Số broker', labelEn: 'Brokers' },
    { name: 'storage', from: 'storage', unit: 'TB', rounding: 'none', labelVi: 'Dung lượng lưu trữ', labelEn: 'Storage' },
    { name: 'tp_brokers', from: 'tp_brokers', unit: 'broker', rounding: 'ceil', labelVi: 'Broker theo throughput', labelEn: 'Brokers for throughput' },
    { name: 'storage_brokers', from: 'storage_brokers', unit: 'broker', rounding: 'ceil', labelVi: 'Broker theo storage', labelEn: 'Brokers for storage' },
    { name: 'disk_used_per_broker', from: 'disk_used_per_broker', unit: 'TB', rounding: 'none', labelVi: 'Dữ liệu mỗi broker', labelEn: 'Data per broker' },
    { name: 'partitions', from: 'partitions', unit: 'partition', rounding: 'ceil', labelVi: 'Số partition gợi ý', labelEn: 'Suggested partitions' },
    { name: 'egress', from: 'egress', unit: 'MB/s', rounding: 'none', labelVi: 'Lưu lượng đọc ra', labelEn: 'Egress' },
  ],
  warnings: [
    { condition: 'rf < 3 and is_prod == 1', severity: 'high', messageVi: 'Replication factor < 3 ở môi trường Prod.', messageEn: 'Replication factor below 3 in Prod.' },
  ],
  lookups: [],
  tests: [
    // 05 §9 / 02 §10 golden: ceil(150 x 3 / 100 / 0.6) = ceil(7.5) = 8.
    // 150 MB/s x 259,200 s x 3 = 1.1664e14 B = 116.64 TB; / (12 x 0.7 = 8.4) = 13.89 -> 14.
    // max(8, 14, 3) = 14 (binding: storage). Partitions max(ceil(150 / 10) = 15, 14) = 15.
    // Egress 150 x (2 + 3 - 1) = 600 MB/s. 116.64 / 14 = 8.3314 TB per broker.
    { id: 'T1-golden', inputs: { ingress: 150, rf: 3, retention: 3 }, expected: { brokers: 14, storage: 116.64, tp_brokers: 8, storage_brokers: 14, partitions: 15, egress: 600, disk_used_per_broker: 8.3314286 }, tolerance: 0.0001 },
    // Throughput-bound: 600 x 3 / 100 / 0.6 = 30 (30.000000000000004 in doubles; must stay 30).
    // 600 MB/s x 43,200 s x 3 = 77.76 TB; / 8.4 = 9.26 -> 10. max(30, 10, 3) = 30. Partitions max(60, 30) = 60.
    { id: 'T2-throughput', inputs: { ingress: 600, retention: 0.5 }, expected: { brokers: 30, storage: 77.76, tp_brokers: 30, storage_brokers: 10, partitions: 60 }, tolerance: 0.0001 },
    // Dev: 5 x 1 / 100 / 0.6 = 0.083 -> 1; 5 MB/s x 86,400 s x 1 = 0.432 TB -> 1; max(1, 1, 1) = 1.
    { id: 'T3-dev', inputs: { ingress: 5, rf: 1, retention: 1, is_prod: 0 }, expected: { brokers: 1, storage: 0.432, partitions: 1 }, tolerance: 0.0001 },
  ],
}
