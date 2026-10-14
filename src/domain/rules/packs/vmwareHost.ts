import type { SizingModelDef } from '../../../contracts/pilot'

/**
 * VMware ESXi hosts (02 §7.1 SZ3-03, US-SZ-03). Physical cores from vCPU at a
 * per-tier overcommit ratio, RAM without overcommit, both at a target
 * utilisation, then N+x hosts for HA admission control.
 *
 * Assumptions:
 * - RAM is never overcommitted (SZ3-03 default); target utilisation applies
 *   to RAM as well as CPU, as in the US-SZ-03 worked example.
 * - Hypervisor overhead is a fraction of each host's cores and RAM
 *   (ESXi + vSAN/agents); 0 in the golden test.
 * - Host cores are physical cores (no hyper-threading credit).
 * - hosts = max(CPU-bound, RAM-bound) + spare; the binding note says which.
 */
export const vmwareHostModel: SizingModelDef = {
  id: 'vmware-host',
  nameVi: 'Host VMware ESXi',
  nameEn: 'VMware ESXi hosts',
  componentType: 'vmware-host',
  description: 'pCores = app vCPU / app ratio + DB vCPU / DB ratio; CPU hosts and RAM hosts at a target utilisation; hosts = max(CPU, RAM) + N spare.',
  formulaMode: 'units',
  inputs: [
    { name: 'app_vcpu', labelVi: 'vCPU tầng ứng dụng', labelEn: 'App-tier vCPU', unit: 'vCPU', default: 400, min: 0, source: 'VM inventory' },
    { name: 'app_ratio', labelVi: 'Tỉ lệ vCPU:pCore cho app', labelEn: 'App vCPU:pCore ratio', unit: 'x', default: 3, min: 1, max: 10, source: 'policy (3:1)' },
    { name: 'db_vcpu', labelVi: 'vCPU tầng database', labelEn: 'Database vCPU', unit: 'vCPU', default: 120, min: 0, source: 'VM inventory' },
    { name: 'db_ratio', labelVi: 'Tỉ lệ vCPU:pCore cho DB', labelEn: 'Database vCPU:pCore ratio', unit: 'x', default: 1, min: 1, max: 10, source: 'policy (1:1)' },
    { name: 'ram', labelVi: 'Tổng RAM của VM', labelEn: 'Total VM RAM', unit: 'GB', default: 2048, min: 0, source: 'VM inventory' },
    { name: 'host_cores', labelVi: 'Số core vật lý mỗi host', labelEn: 'Physical cores per host', unit: 'core', default: 64, min: 1, source: 'hardware catalog (2 x 32 core)' },
    { name: 'host_ram', labelVi: 'RAM mỗi host', labelEn: 'RAM per host', unit: 'GB', default: 1024, min: 1, source: 'hardware catalog' },
    { name: 'target_util', labelVi: 'Mức dùng mục tiêu', labelEn: 'Target utilisation', unit: 'ratio', default: 0.7, min: 0.1, max: 1, source: 'best practice' },
    { name: 'spare_hosts', labelVi: 'Host dự phòng (N+x)', labelEn: 'Spare hosts (N+x)', unit: 'host', default: 1, min: 0, source: 'HA admission control' },
    { name: 'hypervisor_overhead', labelVi: 'Overhead hypervisor', labelEn: 'Hypervisor overhead', unit: 'ratio', default: 0, min: 0, max: 0.5, source: 'assumption' },
  ],
  params: [],
  calc: [
    { name: 'pcores', formula: 'app_vcpu / app_ratio + db_vcpu / db_ratio', unit: 'core', description: 'Physical cores at the overcommit ratios' },
    { name: 'cores_needed', formula: 'pcores / target_util', unit: 'core' },
    { name: 'usable_cores', formula: 'host_cores * (1 - hypervisor_overhead)', unit: 'core' },
    { name: 'cpu_hosts', formula: 'ceil(cores_needed / usable_cores)', unit: 'host', description: 'Hosts for CPU' },
    { name: 'ram_needed', formula: 'ram / target_util', unit: 'GB' },
    { name: 'usable_ram', formula: 'host_ram * (1 - hypervisor_overhead)', unit: 'GB' },
    { name: 'ram_hosts', formula: 'ceil(ram_needed / usable_ram)', unit: 'host', description: 'Hosts for RAM' },
    { name: 'hosts', formula: 'max(cpu_hosts, ram_hosts) + spare_hosts', unit: 'host', description: 'Binding constraint plus N+x' },
    { name: 'total_cores', formula: 'hosts * host_cores', unit: 'core', description: 'Physical cores to license' },
    { name: 'total_ram', formula: 'hosts * host_ram', unit: 'GB' },
  ],
  outputs: [
    { name: 'hosts', from: 'hosts', unit: 'host', rounding: 'ceil', labelVi: 'Số host', labelEn: 'Hosts' },
    { name: 'cpu_hosts', from: 'cpu_hosts', unit: 'host', rounding: 'ceil', labelVi: 'Host theo CPU', labelEn: 'Hosts for CPU' },
    { name: 'ram_hosts', from: 'ram_hosts', unit: 'host', rounding: 'ceil', labelVi: 'Host theo RAM', labelEn: 'Hosts for RAM' },
    { name: 'pcores', from: 'pcores', unit: 'core', rounding: 'none', labelVi: 'pCore cần', labelEn: 'Physical cores needed' },
    { name: 'cores_needed', from: 'cores_needed', unit: 'core', rounding: 'none', labelVi: 'Core cần (theo mức dùng)', labelEn: 'Cores at target utilisation' },
    { name: 'ram_needed', from: 'ram_needed', unit: 'GB', rounding: 'none', labelVi: 'RAM cần (theo mức dùng)', labelEn: 'RAM at target utilisation' },
    { name: 'total_cores', from: 'total_cores', unit: 'core', rounding: 'none', labelVi: 'Tổng core (license)', labelEn: 'Total cores (licensing)' },
  ],
  warnings: [
    { condition: 'spare_hosts < 1', severity: 'high', messageVi: 'Không có host dự phòng (N+1): hỏng 1 host là thiếu tài nguyên cho VM.', messageEn: 'No spare host (N+1): one host failure leaves VMs without capacity.' },
    { condition: 'app_ratio > 4', severity: 'medium', messageVi: 'Tỉ lệ vCPU:pCore cho app > 4:1, nguy cơ CPU ready cao.', messageEn: 'App vCPU:pCore above 4:1 risks high CPU ready time.' },
    { condition: 'db_ratio > 1', severity: 'medium', messageVi: 'VM database đang overcommit CPU (> 1:1); nên giữ 1:1.', messageEn: 'Database VMs are CPU-overcommitted (> 1:1); keep them at 1:1.' },
    { condition: 'hosts > 96', severity: 'info', messageVi: 'Hơn 96 host: vượt giới hạn 1 cluster vSphere 7/8, cần chia nhiều cluster.', messageEn: 'More than 96 hosts exceeds one vSphere 7/8 cluster; split into several clusters.' },
  ],
  lookups: [],
  tests: [
    // US-SZ-03 golden: 400 / 3 + 120 / 1 = 253.333 pCore; / 0.7 = 361.905; / 64 = 5.65 -> 6 CPU hosts.
    // RAM 2048 / 0.7 = 2925.714 GB; / 1024 = 2.857 -> 3 RAM hosts. max(6, 3) + 1 = 7 hosts (binding: CPU).
    { id: 'T1-golden', inputs: {}, expected: { hosts: 7, cpu_hosts: 6, ram_hosts: 3, pcores: 253.3333333, cores_needed: 361.9047619, ram_needed: 2925.7142857, total_cores: 448 }, tolerance: 0.000001 },
    // RAM-bound: 100 / 3 = 33.33 pCore; / 0.7 = 47.6 -> 1 CPU host. 4096 / 0.7 = 5851.43 GB; / 1024 = 5.71 -> 6.
    // max(1, 6) + 1 = 7 hosts (binding: RAM).
    { id: 'T2-ram-bound', inputs: { app_vcpu: 100, db_vcpu: 0, ram: 4096 }, expected: { hosts: 7, cpu_hosts: 1, ram_hosts: 6 }, tolerance: 0.000001 },
    // 10% hypervisor overhead: 64 x 0.9 = 57.6 usable cores; 361.905 / 57.6 = 6.28 -> 7.
    // 1024 x 0.9 = 921.6 GB; 2925.714 / 921.6 = 3.17 -> 4. max(7, 4) + 1 = 8 hosts.
    // QA G-VMW-02, exact multiple: 300 / 3 + 124 = 224 pCore; / 0.7 = 320; / 64 = 5 exactly -> 5 (not 6).
    // RAM 3 hosts. max(5, 3) + 1 = 6 hosts (binding: CPU).
    { id: 'V2-exact-multiple', inputs: { app_vcpu: 300, db_vcpu: 124 }, expected: { hosts: 6, cpu_hosts: 5, ram_hosts: 3, pcores: 224, cores_needed: 320 }, tolerance: 0.000001 },
    // QA G-VMW-03, RAM-bound: 300 / 3 + 40 = 140; / 0.7 = 200; / 64 = 3.125 -> 4. RAM 6144 / 0.7 = 8777.143; / 1024 = 8.57 -> 9.
    // max(4, 9) + 1 = 10 hosts (binding: RAM).
    { id: 'V3-ram-bound', inputs: { app_vcpu: 300, db_vcpu: 40, ram: 6144 }, expected: { hosts: 10, cpu_hosts: 4, ram_hosts: 9, ram_needed: 8777.1428571 }, tolerance: 0.000001 },
    { id: 'T3-overhead', inputs: { hypervisor_overhead: 0.1 }, expected: { hosts: 8, cpu_hosts: 7, ram_hosts: 4 }, tolerance: 0.000001 },
  ],
}
