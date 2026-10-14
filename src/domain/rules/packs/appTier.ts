import type { SizingModelDef } from '../../../contracts/pilot'

/**
 * Stateless app/web tier (02 §7.1 EP-SZ2, SZ1-02). CCU -> RPS by Little's law,
 * then instances from CPU time per request.
 *
 * Assumptions (shown to users through `source` and the trace):
 * - CCU is the peak concurrency, so RPS = CCU / (response + think) is already
 *   a peak figure; `peak_factor` (default 1) only adds an event spike on top.
 * - CPU demand in cores = RPS x CPU-seconds per request (a core does 1 CPU-s
 *   per second). 20 ms/request is a "medium" profile: light ~5-10 ms,
 *   heavy 100 ms+. Measure it when the app exists.
 * - Cores are provisioned at `target_util` (60%) so latency stays flat.
 * - instances = max(CPU-driven count, HA minimum) + N spare (N+1 by default).
 * - RAM per instance is a flat figure; this model does not size RAM by load.
 */
export const appTierModel: SizingModelDef = {
  id: 'app-tier',
  nameVi: 'Tầng ứng dụng / web (stateless)',
  nameEn: 'App / web tier (stateless)',
  componentType: 'app-tier',
  description: 'CCU -> RPS by Little\'s law (RPS = CCU / (response time + think time)), then instance count from CPU time per request at a target utilisation, with an HA minimum and N+1.',
  formulaMode: 'units',
  inputs: [
    { name: 'ccu', labelVi: 'Người dùng đồng thời (CCU)', labelEn: 'Concurrent users (CCU)', unit: 'user', default: 5000, min: 0, source: 'customer' },
    { name: 'response_time', labelVi: 'Thời gian phản hồi', labelEn: 'Response time', unit: 's', default: 1, min: 0.001, source: 'customer / NFR' },
    { name: 'think_time', labelVi: 'Thời gian suy nghĩ giữa 2 thao tác', labelEn: 'Think time between actions', unit: 's', default: 9, min: 0, source: 'assumption' },
    { name: 'peak_factor', labelVi: 'Hệ số đỉnh sự kiện', labelEn: 'Event peak factor', unit: 'x', default: 1, min: 1, max: 20, source: 'assumption' },
    { name: 'cpu_ms_per_req', labelVi: 'CPU mỗi request', labelEn: 'CPU time per request', unit: 'ms/req', default: 20, min: 0, source: 'profile: medium (light 5-10, heavy 100+)' },
    { name: 'vcpu_per_instance', labelVi: 'vCPU mỗi instance', labelEn: 'vCPU per instance', unit: 'vCPU/instance', default: 4, min: 1, source: 'flavor' },
    { name: 'ram_per_instance', labelVi: 'RAM mỗi instance', labelEn: 'RAM per instance', unit: 'GB/instance', default: 8, min: 0, source: 'flavor' },
    { name: 'target_util', labelVi: 'Mức dùng CPU mục tiêu', labelEn: 'Target CPU utilisation', unit: 'ratio', default: 0.6, min: 0.05, max: 1, source: 'best practice' },
    { name: 'min_instances', labelVi: 'Số instance tối thiểu (HA)', labelEn: 'Minimum instances (HA)', unit: 'instance', default: 2, min: 1, source: 'HA policy' },
    { name: 'spare', labelVi: 'Instance dự phòng (N+x)', labelEn: 'Spare instances (N+x)', unit: 'instance', default: 1, min: 0, source: 'HA policy' },
  ],
  params: [],
  calc: [
    { name: 'rps', formula: 'ccu / (response_time + think_time)', unit: 'req/s', description: "Little's law" },
    { name: 'design_rps', formula: 'rps * peak_factor', unit: 'req/s', description: 'RPS including the event peak' },
    { name: 'cpu_demand', formula: 'design_rps * cpu_ms_per_req', unit: 'vCPU', description: 'Cores kept busy at the design RPS' },
    { name: 'vcpu_needed', formula: 'cpu_demand / target_util', unit: 'vCPU', description: 'Cores at the target utilisation' },
    { name: 'instances_cpu', formula: 'ceil(vcpu_needed / vcpu_per_instance)', unit: 'instance', description: 'Instances needed for CPU' },
    { name: 'instances', formula: 'max(instances_cpu, min_instances) + spare', unit: 'instance', description: 'CPU or HA minimum, plus spare' },
    { name: 'total_vcpu', formula: 'instances * vcpu_per_instance', unit: 'vCPU' },
    { name: 'total_ram', formula: 'instances * ram_per_instance', unit: 'GB' },
  ],
  outputs: [
    { name: 'instances', from: 'instances', unit: 'instance', rounding: 'ceil', labelVi: 'Số instance', labelEn: 'Instances' },
    { name: 'rps', from: 'rps', unit: 'req/s', rounding: 'none', labelVi: 'RPS (Little)', labelEn: "RPS (Little's law)" },
    { name: 'total_vcpu', from: 'total_vcpu', unit: 'vCPU', rounding: 'none', labelVi: 'Tổng vCPU', labelEn: 'Total vCPU' },
    { name: 'total_ram', from: 'total_ram', unit: 'GB', rounding: 'none', labelVi: 'Tổng RAM', labelEn: 'Total RAM' },
  ],
  warnings: [
    { condition: 'target_util > 0.8', severity: 'medium', messageVi: 'Mức dùng CPU mục tiêu > 80%: còn rất ít dư địa, độ trễ tăng mạnh khi tải dao động.', messageEn: 'Target CPU utilisation above 80% leaves little headroom; latency climbs quickly under load swings.' },
    { condition: 'min_instances + spare < 2', severity: 'high', messageVi: 'Chỉ có 1 instance: không có HA.', messageEn: 'A single instance has no HA.' },
    { condition: 'think_time == 0', severity: 'info', messageVi: 'Think time = 0: mỗi người dùng gửi request liên tục (trường hợp xấu nhất).', messageEn: 'Think time 0: every user sends requests back to back (worst case).' },
  ],
  lookups: [],
  tests: [
    // US-SZ-01 golden: 5000 / (1 + 9) = 500 req/s.
    // CPU: 500 x 0.020 s = 10 cores busy; / 0.6 = 16.67 vCPU; / 4 = 4.17 -> 5 instances.
    // max(5, 2) + 1 = 6 instances; 6 x 4 = 24 vCPU; 6 x 8 GB = 48 GB.
    { id: 'T1-golden', inputs: {}, expected: { rps: 500, instances: 6, total_vcpu: 24, total_ram: 48 }, tolerance: 0.000001 },
    // 20000 / (0.5 + 4.5) = 4000 req/s; x 1.5 = 6000; x 0.003 s = 18 cores; / 0.6 = 30 vCPU;
    // / 4 = 7.5 -> 8; max(8, 2) + 1 = 9 instances; 36 vCPU; 72 GB.
    { id: 'T2-peak', inputs: { ccu: 20000, response_time: 0.5, think_time: 4.5, peak_factor: 1.5, cpu_ms_per_req: 3 }, expected: { rps: 4000, instances: 9, total_vcpu: 36, total_ram: 72 }, tolerance: 0.000001 },
    // HA floor decides: 100 / 10 = 10 req/s; x 0.02 = 0.2 cores; / 0.6 = 0.33; / 4 -> 1;
    // max(1, 2) + 1 = 3 instances; 12 vCPU; 24 GB.
    { id: 'T3-ha-floor', inputs: { ccu: 100 }, expected: { rps: 10, instances: 3, total_vcpu: 12, total_ram: 24 }, tolerance: 0.000001 },
  ],
}
