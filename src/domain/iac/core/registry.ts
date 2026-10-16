/**
 * Adapter registry (design-v2 4.4.3; REQ-ADP-005, REQ-ADP-006).
 *
 * - Registering as `shipped` fails unless the adapter declares golden
 *   fixtures and CI validation commands. `registry.test.ts` additionally
 *   checks that the declared fixtures and goldens exist on disk.
 * - The UI adapter list comes from `list()`; nothing else enumerates adapters.
 * - A registry is a value (`createRegistry()`), so tests register stubs
 *   without touching the default one.
 */
import type { AdapterStatus, IacAdapter } from './adapter'

export interface RegisteredAdapter {
  adapter: IacAdapter
  status: AdapterStatus
}

export interface AdapterRegistry {
  register(adapter: IacAdapter, status: AdapterStatus): void
  get(id: string): RegisteredAdapter | undefined
  /** Sorted by id (code-unit order), so every caller sees the same order. */
  list(): RegisteredAdapter[]
  /** Adapters serving a target kind; `includeTest` adds adapters registered as `test`. */
  forTarget(kind: string, includeTest?: boolean): RegisteredAdapter[]
}

export class AdapterRegistrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdapterRegistrationError'
  }
}

const ADAPTER_ID = /^[a-z][a-z0-9-]{1,39}$/
const SEMVER = /^\d+\.\d+\.\d+$/

export function createRegistry(): AdapterRegistry {
  const byId = new Map<string, RegisteredAdapter>()
  const byCodeUnit = (a: RegisteredAdapter, b: RegisteredAdapter) => (a.adapter.id < b.adapter.id ? -1 : a.adapter.id > b.adapter.id ? 1 : 0)
  return {
    register(adapter, status) {
      if (!ADAPTER_ID.test(adapter.id)) throw new AdapterRegistrationError(`adapter id ${JSON.stringify(adapter.id)} is not valid`)
      if (!SEMVER.test(adapter.version)) throw new AdapterRegistrationError(`${adapter.id}: version ${JSON.stringify(adapter.version)} is not semver`)
      if (!adapter.tool) throw new AdapterRegistrationError(`${adapter.id}: tool is required`)
      if (adapter.targetKinds.length === 0) throw new AdapterRegistrationError(`${adapter.id}: serves no target kind`)
      if (byId.has(adapter.id)) throw new AdapterRegistrationError(`${adapter.id} is already registered`)
      if (status === 'shipped') {
        if (adapter.goldenFixtures.length === 0) throw new AdapterRegistrationError(`${adapter.id}: a shipped adapter needs golden fixtures (REQ-ADP-006)`)
        if (adapter.validationCommands.length === 0) throw new AdapterRegistrationError(`${adapter.id}: a shipped adapter needs CI validation commands (REQ-ADP-006)`)
      }
      byId.set(adapter.id, { adapter, status })
    },
    get(id) {
      return byId.get(id)
    },
    list() {
      return [...byId.values()].sort(byCodeUnit)
    },
    forTarget(kind, includeTest = false) {
      return [...byId.values()]
        .filter((entry) => entry.adapter.targetKinds.includes(kind) && (includeTest || entry.status === 'shipped'))
        .sort(byCodeUnit)
    },
  }
}
