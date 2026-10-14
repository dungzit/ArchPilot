import type { SizingModelDef } from '../../../contracts/pilot'

/**
 * SAN / block storage array (02 §7.1 SZ3-05). Usable -> raw by RAID level via
 * a lookup table, plus snapshot reserve and hot spares; disk count is the
 * larger of capacity-bound and IOPS-bound, rounded up to whole RAID groups.
 *
 * Assumptions:
 * - RAID level is entered as a number: 10, 6 (8+2), 5 (4+1) or 1.
 *   Raw/usable factors: RAID10 x2.0, RAID6 8+2 x1.25, RAID5 4+1 x1.25, RAID1 x2.0.
 * - Back-end IOPS = reads + writes x write penalty (RAID10/1: 2, RAID5: 4, RAID6: 6).
 * - Per-disk IOPS is the planning figure for the drive class (SSD ~10,000
 *   after array overhead; 10k SAS HDD ~150).
 * - Snapshot reserve is added on top of usable capacity.
 * - One hot spare per `spare_every` disks, at least one.
 * - Thin provisioning, dedup and compression credits are NOT applied.
 */
export const sanStorageModel: SizingModelDef = {
  id: 'san-storage',
  nameVi: 'Lưu trữ SAN (block)',
  nameEn: 'SAN block storage',
  componentType: 'san-storage',
  description: 'Raw = usable x (1 + snapshot reserve) x RAID factor; disks = whole RAID groups covering max(capacity, IOPS); hot spares on top.',
  formulaMode: 'units',
  inputs: [
    { name: 'usable', labelVi: 'Dung lượng usable cần', labelEn: 'Required usable capacity', unit: 'TB', default: 100, min: 0, source: 'sizing of workloads' },
    { name: 'raid_level', labelVi: 'Mức RAID (10, 6, 5, 1)', labelEn: 'RAID level (10, 6, 5, 1)', unit: 'count', default: 6, min: 1, max: 10, source: 'design' },
    { name: 'snapshot_reserve', labelVi: 'Dự phòng snapshot', labelEn: 'Snapshot reserve', unit: 'ratio', default: 0.2, min: 0, max: 2, source: 'backup/snapshot policy' },
    { name: 'disk_size', labelVi: 'Dung lượng mỗi đĩa', labelEn: 'Disk size', unit: 'TB', default: 7.68, min: 0.1, source: 'hardware catalog' },
    { name: 'disk_iops', labelVi: 'IOPS mỗi đĩa', labelEn: 'IOPS per disk', unit: 'IOPS', default: 10_000, min: 1, source: 'hardware catalog (SSD, planning)' },
    { name: 'host_iops', labelVi: 'IOPS front-end cần', labelEn: 'Required front-end IOPS', unit: 'IOPS', default: 50_000, min: 0, source: 'sizing of workloads' },
    { name: 'read_ratio', labelVi: 'Tỉ lệ đọc', labelEn: 'Read ratio', unit: 'ratio', default: 0.7, min: 0, max: 1, source: 'workload profile' },
    { name: 'spare_every', labelVi: '1 hot spare cho mỗi N đĩa', labelEn: 'One hot spare per N disks', unit: 'disk', default: 24, min: 1, source: 'vendor practice' },
  ],
  params: [
    { name: 'large_disk', value: 4, unit: 'TB', source: 'RAID5 rebuild-risk threshold' },
  ],
  calc: [
    { name: 'raid_factor', formula: 'lookup(raid, raid_level, "factor")', unit: 'ratio', description: 'Raw / usable for the RAID level' },
    { name: 'write_penalty', formula: 'lookup(raid, raid_level, "write_penalty")', unit: 'count' },
    { name: 'raid_group', formula: 'lookup(raid, raid_level, "group")', unit: 'disk', description: 'Disks per RAID group' },
    { name: 'capacity_needed', formula: 'usable * (1 + snapshot_reserve)', unit: 'TB' },
    { name: 'raw', formula: 'capacity_needed * raid_factor', unit: 'TB' },
    { name: 'data_disks', formula: 'ceil(raw / disk_size)', unit: 'disk', description: 'Capacity' },
    { name: 'backend_iops', formula: 'host_iops * read_ratio + host_iops * (1 - read_ratio) * write_penalty', unit: 'IOPS' },
    { name: 'iops_disks', formula: 'ceil(backend_iops / disk_iops)', unit: 'disk', description: 'IOPS' },
    { name: 'disks_needed', formula: 'roundup_to(max(data_disks, iops_disks), raid_group)', unit: 'disk', description: 'Whole RAID groups' },
    { name: 'hot_spares', formula: 'ceil(disks_needed / spare_every)', unit: 'disk' },
    { name: 'total_disks', formula: 'disks_needed + hot_spares', unit: 'disk' },
    { name: 'raw_installed', formula: 'total_disks * disk_size', unit: 'TB' },
    { name: 'iops_capacity', formula: 'disks_needed * disk_iops / (read_ratio + (1 - read_ratio) * write_penalty)', unit: 'IOPS', description: 'Front-end IOPS the disks can deliver' },
  ],
  outputs: [
    { name: 'total_disks', from: 'total_disks', unit: 'disk', rounding: 'ceil', labelVi: 'Tổng số đĩa', labelEn: 'Total disks' },
    { name: 'raw_installed', from: 'raw_installed', unit: 'TB', rounding: 'none', labelVi: 'Dung lượng raw lắp đặt', labelEn: 'Raw capacity installed' },
    { name: 'raw', from: 'raw', unit: 'TB', rounding: 'none', labelVi: 'Raw cần theo RAID', labelEn: 'Raw needed for RAID' },
    { name: 'disks_needed', from: 'disks_needed', unit: 'disk', rounding: 'ceil', labelVi: 'Đĩa dữ liệu', labelEn: 'Data disks' },
    { name: 'hot_spares', from: 'hot_spares', unit: 'disk', rounding: 'ceil', labelVi: 'Hot spare', labelEn: 'Hot spares' },
    { name: 'backend_iops', from: 'backend_iops', unit: 'IOPS', rounding: 'ceil', labelVi: 'IOPS back-end', labelEn: 'Back-end IOPS' },
    { name: 'iops_capacity', from: 'iops_capacity', unit: 'IOPS', rounding: 'floor', labelVi: 'IOPS front-end đáp ứng được', labelEn: 'Deliverable front-end IOPS' },
  ],
  warnings: [
    { condition: 'raid_level == 5 and disk_size >= large_disk', severity: 'high', messageVi: 'RAID5 với đĩa lớn ({disk_size}): rebuild lâu, nguy cơ hỏng đĩa thứ hai. Nên dùng RAID6.', messageEn: 'RAID5 with large disks ({disk_size}): long rebuilds risk a second failure. Prefer RAID6.' },
    { condition: 'iops_disks > data_disks', severity: 'info', messageVi: 'IOPS quyết định số đĩa, không phải dung lượng: cân nhắc đĩa nhanh hơn.', messageEn: 'IOPS, not capacity, decides the disk count: consider a faster drive class.' },
    { condition: 'snapshot_reserve < 0.1', severity: 'low', messageVi: 'Dự phòng snapshot < 10%.', messageEn: 'Snapshot reserve below 10%.' },
  ],
  lookups: [
    {
      name: 'raid',
      columns: ['level', 'factor', 'write_penalty', 'group'],
      rows: [
        [10, 2.0, 2, 2],
        [6, 1.25, 6, 10],
        [5, 1.25, 4, 5],
        [1, 2.0, 2, 2],
      ],
    },
  ],
  tests: [
    // RAID6 8+2: 100 x 1.2 = 120 TB; x 1.25 = 150 TB raw; 150 / 7.68 = 19.53 -> 20 disks.
    // Back-end IOPS: 50,000 x 0.7 + 50,000 x 0.3 x 6 = 35,000 + 90,000 = 125,000; / 10,000 -> 13 disks.
    // roundup_to(max(20, 13), 10) = 20; spares ceil(20 / 24) = 1; total 21; 21 x 7.68 = 161.28 TB.
    // Deliverable: 20 x 10,000 / (0.7 + 0.3 x 6 = 2.5) = 80,000 IOPS.
    { id: 'T1-raid6', inputs: {}, expected: { total_disks: 21, raw_installed: 161.28, raw: 150, disks_needed: 20, hot_spares: 1, backend_iops: 125000, iops_capacity: 80000 }, tolerance: 0.0001 },
    // RAID10, IOPS-bound: 50 x 1.1 = 55; x 2 = 110 TB; / 3.84 = 28.6 -> 29. IOPS 200,000 x 0.5 + 200,000 x 0.5 x 2 = 300,000 -> 30.
    // roundup_to(30, 2) = 30; spares ceil(30 / 24) = 2; total 32; 32 x 3.84 = 122.88 TB; 30 x 10,000 / 1.5 = 200,000.
    { id: 'T2-raid10-iops', inputs: { usable: 50, raid_level: 10, snapshot_reserve: 0.1, disk_size: 3.84, host_iops: 200_000, read_ratio: 0.5 }, expected: { total_disks: 32, raw_installed: 122.88, raw: 110, disks_needed: 30, hot_spares: 2, backend_iops: 300000, iops_capacity: 200000 }, tolerance: 0.0001 },
    // RAID5 4+1: 20 x 1.2 = 24; x 1.25 = 30 TB; / 7.68 = 3.9 -> 4. IOPS 5,000 x 0.7 + 5,000 x 0.3 x 4 = 9,500 -> 1.
    // roundup_to(4, 5) = 5; spares 1; total 6; 46.08 TB; 5 x 10,000 / (0.7 + 1.2 = 1.9) = 26,315.79 -> 26,315.
    { id: 'T3-raid5', inputs: { usable: 20, raid_level: 5, host_iops: 5000 }, expected: { total_disks: 6, raw_installed: 46.08, raw: 30, disks_needed: 5, hot_spares: 1, backend_iops: 9500, iops_capacity: 26315 }, tolerance: 0.0001 },
  ],
}
