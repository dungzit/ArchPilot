import type { SizingModelDef } from '../../../contracts/pilot'

/**
 * Relational database node (02 §7.1 EP-SZ2: PostgreSQL, MySQL, SQL Server,
 * Oracle). Storage, IOPS, vCPU and buffer-pool RAM for one node; every
 * replica/standby is a full copy.
 *
 * Assumptions (planning values, replace with measurements when available):
 * - Data grows by `growth_rate` per year, compounded over `years`; indexes add
 *   `index_overhead` on top of table data.
 * - WAL/redo + archived logs kept on the node: 25% of the database size.
 * - Disks are provisioned to 75% full.
 * - Physical read IOPS = TPS x reads/txn x (1 - buffer hit ratio 0.9);
 *   every logical write reaches disk (WAL + checkpoint, no write combining
 *   credit). Both held at 60% of the disk tier's capability.
 * - vCPU = TPS x CPU time per transaction / 60%, rounded up to an even count.
 * - RAM = working set of the database (buffer pool) + 10 MB per connection
 *   + 8 GB for the OS, rounded up to 16 GB.
 * - Backup repository keeps `backup_fulls` full backups compressed to 50%;
 *   incrementals and log backups are not counted here.
 */
export const rdbmsModel: SizingModelDef = {
  id: 'rdbms',
  nameVi: 'Cơ sở dữ liệu quan hệ (RDBMS)',
  nameEn: 'Relational database (RDBMS)',
  componentType: 'rdbms',
  description: 'Data with index overhead and compound growth, WAL/archive and fill headroom per node, physical IOPS after buffer hits, vCPU from CPU time per transaction, buffer-pool RAM from the working set, backup repository.',
  formulaMode: 'units',
  inputs: [
    { name: 'data_size', labelVi: 'Dữ liệu hiện tại', labelEn: 'Current data size', unit: 'GB', default: 500, min: 0, source: 'customer' },
    { name: 'index_overhead', labelVi: 'Overhead index', labelEn: 'Index overhead', unit: 'ratio', default: 0.3, min: 0, max: 3, source: 'assumption' },
    { name: 'growth_rate', labelVi: 'Tăng trưởng mỗi năm (0.3 = 30%)', labelEn: 'Growth per year (0.3 = 30%)', unit: 'ratio', default: 0.3, min: 0, max: 2, source: 'customer' },
    { name: 'years', labelVi: 'Số năm kế hoạch', labelEn: 'Planning years', unit: 'count', default: 3, min: 0, max: 10, source: 'project' },
    { name: 'tps', labelVi: 'Giao dịch/giây (đỉnh)', labelEn: 'Peak transactions per second', unit: 'TPS', default: 1000, min: 0, source: 'customer' },
    { name: 'reads_per_txn', labelVi: 'Lượt đọc mỗi giao dịch', labelEn: 'Reads per transaction', unit: 'count', default: 8, min: 0, source: 'assumption' },
    { name: 'writes_per_txn', labelVi: 'Lượt ghi mỗi giao dịch', labelEn: 'Writes per transaction', unit: 'count', default: 2, min: 0, source: 'assumption' },
    { name: 'cpu_ms_per_txn', labelVi: 'CPU mỗi giao dịch', labelEn: 'CPU time per transaction', unit: 'ms/txn', default: 4, min: 0, source: 'assumption' },
    { name: 'working_set', labelVi: 'Tỉ lệ dữ liệu nóng (working set)', labelEn: 'Working set (hot fraction)', unit: 'ratio', default: 0.2, min: 0, max: 1, source: 'assumption' },
    { name: 'connections', labelVi: 'Số kết nối', labelEn: 'Connections', unit: 'conn', default: 400, min: 0, source: 'app design' },
    { name: 'replicas', labelVi: 'Số replica/standby', labelEn: 'Replicas / standbys', unit: 'count', default: 1, min: 0, max: 10, source: 'HA policy' },
    { name: 'backup_fulls', labelVi: 'Số bản full backup giữ lại', labelEn: 'Full backups retained', unit: 'count', default: 4, min: 0, source: 'backup policy' },
  ],
  params: [
    { name: 'cache_hit', value: 0.9, unit: 'ratio', source: 'assumption: buffer hit ratio' },
    { name: 'target_util', value: 0.6, unit: 'ratio', source: 'best practice' },
    { name: 'wal_ratio', value: 0.25, unit: 'ratio', source: 'assumption: WAL/redo + archive' },
    { name: 'disk_fill', value: 0.75, unit: 'ratio', source: 'best practice' },
    { name: 'backup_compression', value: 0.5, unit: 'ratio', source: 'assumption' },
    { name: 'ram_per_conn', value: 10, unit: 'MB/conn', source: 'assumption' },
    { name: 'os_ram', value: 8, unit: 'GB', source: 'assumption' },
    { name: 'vcpu_step', value: 2, unit: 'vCPU', source: 'flavor granularity' },
    { name: 'ram_step', value: 16, unit: 'GB', source: 'flavor granularity' },
    { name: 'iops_warn', value: 20_000, unit: 'IOPS', source: 'all-flash tier threshold' },
  ],
  calc: [
    { name: 'data_future', formula: 'data_size * (1 + growth_rate) ^ years', unit: 'GB', description: 'Data at the end of the plan' },
    { name: 'db_size', formula: 'data_future * (1 + index_overhead)', unit: 'GB', description: 'Tables + indexes' },
    { name: 'wal_archive', formula: 'db_size * wal_ratio', unit: 'GB' },
    { name: 'storage_per_node', formula: '(db_size + wal_archive) / disk_fill', unit: 'GB' },
    { name: 'nodes', formula: '1 + replicas', unit: 'node' },
    { name: 'total_storage', formula: 'storage_per_node * nodes', unit: 'GB' },
    { name: 'backup_storage', formula: 'db_size * backup_compression * backup_fulls', unit: 'GB' },
    { name: 'read_iops', formula: 'tps * reads_per_txn * (1 - cache_hit)', unit: 'IOPS', description: 'Physical reads after buffer hits' },
    { name: 'write_iops', formula: 'tps * writes_per_txn', unit: 'IOPS' },
    { name: 'iops', formula: '(read_iops + write_iops) / target_util', unit: 'IOPS' },
    { name: 'vcpu', formula: 'roundup_to(tps * cpu_ms_per_txn / target_util, vcpu_step)', unit: 'vCPU' },
    { name: 'buffer_pool', formula: 'db_size * working_set', unit: 'GB' },
    { name: 'ram_needed', formula: 'buffer_pool + connections * ram_per_conn + os_ram', unit: 'GB' },
    { name: 'ram', formula: 'roundup_to(ram_needed, ram_step)', unit: 'GB' },
  ],
  outputs: [
    { name: 'vcpu', from: 'vcpu', unit: 'vCPU', rounding: 'ceil', labelVi: 'vCPU mỗi node', labelEn: 'vCPU per node' },
    { name: 'ram', from: 'ram', unit: 'GB', rounding: 'none', labelVi: 'RAM mỗi node', labelEn: 'RAM per node' },
    { name: 'iops', from: 'iops', unit: 'IOPS', rounding: 'ceil', labelVi: 'IOPS mỗi node', labelEn: 'IOPS per node' },
    { name: 'storage_per_node', from: 'storage_per_node', unit: 'GB', rounding: 'none', labelVi: 'Dung lượng mỗi node', labelEn: 'Storage per node' },
    { name: 'total_storage', from: 'total_storage', unit: 'GB', rounding: 'none', labelVi: 'Tổng dung lượng', labelEn: 'Total storage' },
    { name: 'backup_storage', from: 'backup_storage', unit: 'GB', rounding: 'none', labelVi: 'Dung lượng backup', labelEn: 'Backup repository' },
    { name: 'nodes', from: 'nodes', unit: 'node', rounding: 'ceil', labelVi: 'Số node', labelEn: 'Nodes' },
    { name: 'buffer_pool', from: 'buffer_pool', unit: 'GB', rounding: 'none', labelVi: 'Buffer pool', labelEn: 'Buffer pool' },
  ],
  warnings: [
    { condition: 'replicas < 1', severity: 'high', messageVi: 'DB chỉ có 1 node: không có failover.', messageEn: 'Single database node: no failover.' },
    { condition: 'iops > iops_warn', severity: 'medium', messageVi: 'IOPS mỗi node {iops} > 20,000: cần tier NVMe/all-flash.', messageEn: 'IOPS per node {iops} above 20,000: needs an NVMe/all-flash tier.' },
  ],
  lookups: [],
  tests: [
    // 500 x 1.3^3 = 1098.5 GB; x 1.3 = 1428.05 GB; WAL 357.0125; (1428.05 + 357.0125) / 0.75 = 2380.0833 GB/node;
    // 2 nodes = 4760.1667 GB; backup 1428.05 x 0.5 x 4 = 2856.1 GB.
    // IOPS: 1000 x 8 x 0.1 = 800 + 1000 x 2 = 2000 -> 2800 / 0.6 = 4666.67 -> 4667.
    // vCPU: 1000 x 0.004 = 4 / 0.6 = 6.67 -> roundup_to 2 = 8. RAM: 1428.05 x 0.2 = 285.61 + 400 x 10 MB (4 GB) + 8 = 297.61 -> 304 GB.
    { id: 'T1-default', inputs: {}, expected: { vcpu: 8, ram: 304, iops: 4667, storage_per_node: 2380.0833333, total_storage: 4760.1666667, backup_storage: 2856.1, nodes: 2, buffer_pool: 285.61 }, tolerance: 0.000001 },
    // 2000 x 1.2^2 = 2880; x 1.5 = 4320; WAL 1080; 5400 / 0.75 = 7200/node; x 3 = 21600; backup 4320 x 0.5 x 2 = 4320.
    // IOPS: 5000 x 10 x 0.1 = 5000 + 5000 x 4 = 20000 -> 25000 / 0.6 = 41666.67 -> 41667.
    // vCPU: 5000 x 0.003 = 15 / 0.6 = 25 -> 26. RAM: 4320 x 0.3 = 1296 + 10 GB + 8 = 1314 -> 1328 GB.
    { id: 'T2-large', inputs: { data_size: 2000, index_overhead: 0.5, growth_rate: 0.2, years: 2, tps: 5000, reads_per_txn: 10, writes_per_txn: 4, cpu_ms_per_txn: 3, working_set: 0.3, connections: 1000, replicas: 2, backup_fulls: 2 }, expected: { vcpu: 26, ram: 1328, iops: 41667, storage_per_node: 7200, total_storage: 21600, backup_storage: 4320, nodes: 3 }, tolerance: 0.000001 },
    // No growth, single node: 100 x 1.2 = 120; WAL 30; 150 / 0.75 = 200; backup 120 x 0.5 x 7 = 420.
    // IOPS: 200 x 5 x 0.1 = 100 + 200 = 300 / 0.6 = 500. vCPU: 200 x 0.01 = 2 / 0.6 = 3.33 -> 4. RAM: 60 + 1 + 8 = 69 -> 80.
    { id: 'T3-small', inputs: { data_size: 100, index_overhead: 0.2, growth_rate: 0, years: 0, tps: 200, reads_per_txn: 5, writes_per_txn: 1, cpu_ms_per_txn: 10, working_set: 0.5, connections: 100, replicas: 0, backup_fulls: 7 }, expected: { vcpu: 4, ram: 80, iops: 500, storage_per_node: 200, total_storage: 200, backup_storage: 420, nodes: 1 }, tolerance: 0.000001 },
  ],
}
