import type { SizingModelDef } from '../../../contracts/pilot'

/**
 * Redis cache (02 §7.1 EP-SZ2, US-SZ-02). Memory per copy from keys x
 * (key + value + per-key overhead) / fill factor; shards from the larger of
 * the memory limit per shard and the ops limit per shard.
 *
 * Assumptions:
 * - 90 B/key overhead covers dictEntry + redisObject + SDS headers for small
 *   strings (catalog planning value); hashes/sets/zsets need their own figure.
 * - `fill_factor` is how full `maxmemory` may get: RDB/AOF rewrite forks need
 *   headroom, so > 0.75 raises a warning (SZ2-03).
 * - 25 GB per shard keeps failover, resharding and fork copy-on-write fast.
 * - 80,000 ops/s per shard is a conservative single-threaded figure for
 *   small GET/SET over the network; pipelining raises it a lot.
 * - Every shard has `replicas` replicas; each node holds one copy of one shard.
 */
export const redisModel: SizingModelDef = {
  id: 'redis',
  nameVi: 'Cache Redis',
  nameEn: 'Redis cache',
  componentType: 'redis',
  description: 'Data = keys x (key + value + overhead); RAM per copy = data / fill factor; total = per copy x (1 + replicas); shards = max(memory-bound, ops-bound).',
  formulaMode: 'units',
  inputs: [
    { name: 'keys', labelVi: 'Số key', labelEn: 'Number of keys', unit: 'key', default: 50_000_000, min: 0, source: 'customer' },
    { name: 'key_size', labelVi: 'Kích thước key', labelEn: 'Key size', unit: 'B', default: 40, min: 0, source: 'customer' },
    { name: 'value_size', labelVi: 'Kích thước value', labelEn: 'Value size', unit: 'B', default: 500, min: 0, source: 'customer' },
    { name: 'fill_factor', labelVi: 'Mức lấp đầy RAM tối đa', labelEn: 'Max memory fill factor', unit: 'ratio', default: 0.7, min: 0.1, max: 1, source: 'best practice' },
    { name: 'replicas', labelVi: 'Số replica mỗi shard', labelEn: 'Replicas per shard', unit: 'count', default: 1, min: 0, max: 5, source: 'HA policy' },
    { name: 'ops', labelVi: 'Thao tác/giây (đỉnh)', labelEn: 'Peak operations per second', unit: 'ops/s', default: 50_000, min: 0, source: 'customer' },
  ],
  params: [
    { name: 'overhead_per_key', value: 90, unit: 'B/key', source: 'catalog: redis per-key overhead (small strings)' },
    { name: 'max_shard_mem', value: 25, unit: 'GB', source: 'best practice: <= 25 GB per shard' },
    { name: 'ops_per_shard', value: 80_000, unit: 'ops/s', source: 'catalog: conservative single-thread GET/SET' },
  ],
  calc: [
    { name: 'bytes_per_key', formula: 'key_size + value_size + overhead_per_key', unit: 'B' },
    { name: 'data', formula: 'keys * bytes_per_key', unit: 'GB', description: 'Raw dataset' },
    { name: 'mem_per_copy', formula: 'data / fill_factor', unit: 'GB', description: 'RAM for one full copy' },
    { name: 'total_mem', formula: 'mem_per_copy * (1 + replicas)', unit: 'GB', description: 'Primary plus replicas' },
    { name: 'shards_mem', formula: 'ceil(mem_per_copy / max_shard_mem)', unit: 'shard', description: 'Shards for memory' },
    { name: 'shards_ops', formula: 'ceil(ops / ops_per_shard)', unit: 'shard', description: 'Shards for throughput' },
    { name: 'shards', formula: 'max(shards_mem, shards_ops)', unit: 'shard' },
    { name: 'nodes', formula: 'shards * (1 + replicas)', unit: 'node' },
    { name: 'mem_per_node', formula: 'mem_per_copy / shards', unit: 'GB', description: 'maxmemory per node' },
  ],
  outputs: [
    { name: 'shards', from: 'shards', unit: 'shard', rounding: 'ceil', labelVi: 'Số shard', labelEn: 'Shards' },
    { name: 'total_mem', from: 'total_mem', unit: 'GB', rounding: 'none', labelVi: 'Tổng RAM (primary + replica)', labelEn: 'Total RAM (primary + replicas)' },
    { name: 'mem_per_copy', from: 'mem_per_copy', unit: 'GB', rounding: 'none', labelVi: 'RAM mỗi bản sao', labelEn: 'RAM per copy' },
    { name: 'data', from: 'data', unit: 'GB', rounding: 'none', labelVi: 'Dữ liệu', labelEn: 'Dataset' },
    { name: 'nodes', from: 'nodes', unit: 'node', rounding: 'ceil', labelVi: 'Số node', labelEn: 'Nodes' },
    { name: 'mem_per_node', from: 'mem_per_node', unit: 'GB', rounding: 'none', labelVi: 'RAM mỗi node', labelEn: 'RAM per node' },
  ],
  warnings: [
    { condition: 'replicas < 1', severity: 'high', messageVi: 'Không có replica: mất node là mất dữ liệu cache và không failover được.', messageEn: 'No replica: losing a node loses its data and there is no failover.' },
    { condition: 'fill_factor > 0.75', severity: 'medium', messageVi: 'Redis dùng > 75% RAM: fork khi ghi RDB/AOF có thể làm hết bộ nhớ.', messageEn: 'Redis above 75% of RAM: the RDB/AOF fork can run out of memory.' },
  ],
  lookups: [],
  tests: [
    // US-SZ-02 golden: 40 + 500 + 90 = 630 B/key; 50,000,000 x 630 B = 31.5 GB;
    // / 0.7 = 45 GB per copy; x (1 + 1) = 90 GB; shards: ceil(45 / 25) = ceil(1.8) = 2,
    // ops: ceil(50,000 / 80,000) = 1; max(2, 1) = 2 shards; 2 x 2 = 4 nodes; 45 / 2 = 22.5 GB/node.
    { id: 'T1-golden', inputs: {}, expected: { data: 31.5, mem_per_copy: 45, total_mem: 90, shards: 2, nodes: 4, mem_per_node: 22.5 }, tolerance: 0.0001 },
    // 50 + 1000 + 90 = 1140 B; 200,000,000 x 1140 = 228 GB; / 0.7 = 325.714 GB; x 3 = 977.143 GB;
    // ceil(325.714 / 25 = 13.03) = 14; ceil(300,000 / 80,000 = 3.75) = 4; 14 shards; 42 nodes; 325.714 / 14 = 23.265 GB.
    { id: 'T2-large', inputs: { keys: 200_000_000, key_size: 50, value_size: 1000, replicas: 2, ops: 300_000 }, expected: { data: 228, mem_per_copy: 325.7142857, total_mem: 977.1428571, shards: 14, nodes: 42, mem_per_node: 23.2653061 }, tolerance: 0.0001 },
    // Ops-bound: 1,000,000 x 630 B = 0.63 GB; / 0.7 = 0.9 GB; ceil(0.036) = 1; ceil(500,000 / 80,000 = 6.25) = 7;
    // 7 shards; 14 nodes; 1.8 GB total; 0.9 / 7 = 0.128571 GB per node.
    { id: 'T3-ops-bound', inputs: { keys: 1_000_000, ops: 500_000 }, expected: { data: 0.63, mem_per_copy: 0.9, total_mem: 1.8, shards: 7, nodes: 14, mem_per_node: 0.1285714 }, tolerance: 0.0001 },
  ],
}
