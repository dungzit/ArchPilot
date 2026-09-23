/**
 * `GET /api/benchmarks` (task 3.3). Read-only shared reference data: one row
 * per metric, each with its citation and confidence tag. The only module that
 * knows this URL. Wire shape = `BenchmarkOut` in backend/app/schemas.py.
 */
import { apiRequest } from './client'
import type { BenchmarkRow } from '../domain/benchmarks'

export interface BenchmarkList {
  items: BenchmarkRow[]
  total: number
}

export function listBenchmarks(signal?: AbortSignal): Promise<BenchmarkList> {
  return apiRequest<BenchmarkList>('/api/benchmarks', { signal })
}
