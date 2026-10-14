/**
 * Autosave with revisions (task 2.6; REQ-DES-009, design-v2 4.2.19).
 *
 * - Debounce 1.5 s after the last change; at most 10 s between saves while
 *   the user keeps editing; `flush()` (Ctrl+S) saves at once.
 * - PUT `{name, graph, revision}`; an identical canonical document is never
 *   re-sent. One request in flight at a time; changes made meanwhile are
 *   saved right after, on the new revision.
 * - 409: state `conflict`, autosave stops. There is no silent overwrite; the
 *   workspace offers "Load theirs" or "Save mine as a copy".
 * - Unreachable: state `offline`; the pending document stays in memory and in
 *   localStorage (`archpilot.design.pending.<ownerId>.<designId>`) so a crash
 *   or reload does not lose it; the next change, Retry or `online` retries.
 * - Any other error (422 integrity, 404): state `error` with the server detail.
 *
 * No React here; the hook wires `onChange` to state. Timers are the global
 * ones so tests drive them with fake timers.
 */
import { isApiError } from '../../../api/client'
import type { DesignPut, DesignRecord } from '../../../api/designs'
import { canonicalJson, type ArchGraphV2 } from '../../../domain/graph'

export const DEBOUNCE_MS = 1500
export const MAX_WAIT_MS = 10000

export type SaveState = 'saved' | 'dirty' | 'saving' | 'offline' | 'conflict' | 'error'

export interface SaveSnapshot {
  name: string
  graph: ArchGraphV2
}

export interface AutosaveStatus {
  state: SaveState
  /** The revision the server last confirmed. */
  revision: number
  /** Server detail for `error` / `conflict`. */
  detail?: string
}

export interface PendingRecord {
  designId: string
  baseRevision: number
  name: string
  graph: ArchGraphV2
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface AutosaveOptions {
  designId: string
  revision: number
  initial: SaveSnapshot
  put: (designId: string, body: DesignPut) => Promise<DesignRecord>
  onChange: (status: AutosaveStatus) => void
  onSaved?: (record: DesignRecord) => void
  storage?: StorageLike | null
  storageKey?: string
  debounceMs?: number
  maxWaitMs?: number
}

export function pendingStorageKey(ownerId: string, designId: string): string {
  return `archpilot.design.pending.${ownerId}.${designId}`
}

export function readPending(storage: StorageLike | null | undefined, key: string): PendingRecord | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PendingRecord>
    if (typeof value.baseRevision !== 'number' || typeof value.name !== 'string' || !value.graph || typeof value.graph !== 'object') return null
    return value as PendingRecord
  } catch {
    return null
  }
}

function keyOf(snapshot: SaveSnapshot): string {
  try {
    return canonicalJson(snapshot)
  } catch {
    return JSON.stringify(snapshot)
  }
}

export class DesignAutosaver {
  private readonly options: AutosaveOptions
  private status: AutosaveStatus
  private pending: SaveSnapshot
  private savedKey: string
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> | null = null
  private disposed = false

  constructor(options: AutosaveOptions) {
    this.options = options
    this.pending = options.initial
    this.savedKey = keyOf(options.initial)
    this.status = { state: 'saved', revision: options.revision }
  }

  get current(): AutosaveStatus {
    return this.status
  }

  /** True when there is something the server does not have yet. */
  get hasUnsavedChanges(): boolean {
    return keyOf(this.pending) !== this.savedKey
  }

  /** Report the latest document. Schedules a save unless it equals the saved one. */
  update(snapshot: SaveSnapshot): void {
    if (this.disposed) return
    this.pending = snapshot
    if (keyOf(snapshot) === this.savedKey) {
      this.clearTimers()
      this.forgetPending()
      if (!this.inFlight && this.status.state !== 'conflict') this.setStatus({ state: 'saved', revision: this.status.revision })
      return
    }
    this.rememberPending()
    if (this.status.state === 'conflict') return
    if (this.status.state !== 'offline' && this.status.state !== 'saving') this.setStatus({ state: 'dirty', revision: this.status.revision })
    this.schedule()
  }

  /** Save now (Ctrl+S, Retry). Resolves when the attempt (and any follow-up) finishes. */
  async flush(): Promise<void> {
    if (this.disposed) return
    this.clearTimers()
    if (this.inFlight) {
      await this.inFlight
      if (this.hasUnsavedChanges && this.status.state !== 'conflict') return this.flush()
      return
    }
    if (!this.hasUnsavedChanges) {
      if (this.status.state !== 'conflict') this.setStatus({ state: 'saved', revision: this.status.revision })
      return
    }
    this.inFlight = this.save()
    try {
      await this.inFlight
    } finally {
      this.inFlight = null
    }
    if (this.hasUnsavedChanges && (this.status.state === 'saved' || this.status.state === 'dirty')) {
      this.setStatus({ state: 'dirty', revision: this.status.revision })
      this.schedule()
    }
  }

  /**
   * After a 409 the user chose "Load theirs": adopt the server copy as the
   * new baseline and resume autosaving.
   */
  rebase(revision: number, snapshot: SaveSnapshot): void {
    this.clearTimers()
    this.pending = snapshot
    this.savedKey = keyOf(snapshot)
    this.forgetPending()
    this.setStatus({ state: 'saved', revision })
  }

  dispose(): void {
    this.disposed = true
    this.clearTimers()
  }

  private async save(): Promise<void> {
    const snapshot = this.pending
    const key = keyOf(snapshot)
    this.setStatus({ state: 'saving', revision: this.status.revision })
    try {
      const record = await this.options.put(this.options.designId, { name: snapshot.name, graph: snapshot.graph, revision: this.status.revision })
      if (this.disposed) return
      this.savedKey = key
      if (keyOf(this.pending) === key) this.forgetPending()
      this.setStatus({ state: 'saved', revision: record.revision })
      this.options.onSaved?.(record)
    } catch (error) {
      if (this.disposed) return
      this.rememberPending()
      if (isApiError(error) && error.status === 409) {
        this.setStatus({ state: 'conflict', revision: this.status.revision, detail: error.detail })
      } else if (isApiError(error) && error.kind === 'unreachable') {
        this.setStatus({ state: 'offline', revision: this.status.revision })
      } else {
        const detail = isApiError(error) ? error.detail : error instanceof Error ? error.message : String(error)
        this.setStatus({ state: 'error', revision: this.status.revision, detail })
      }
    }
  }

  private schedule(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    const debounce = this.options.debounceMs ?? DEBOUNCE_MS
    this.debounceTimer = setTimeout(() => { void this.flush() }, debounce)
    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => { void this.flush() }, this.options.maxWaitMs ?? MAX_WAIT_MS)
    }
  }

  private clearTimers(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer)
    this.debounceTimer = null
    this.maxWaitTimer = null
  }

  private rememberPending(): void {
    const { storage, storageKey, designId } = this.options
    if (!storage || !storageKey) return
    try {
      const record: PendingRecord = { designId, baseRevision: this.status.revision, name: this.pending.name, graph: this.pending.graph }
      storage.setItem(storageKey, JSON.stringify(record))
    } catch {
      // Quota or private mode: the in-memory copy still exists.
    }
  }

  private forgetPending(): void {
    const { storage, storageKey } = this.options
    if (!storage || !storageKey) return
    try {
      storage.removeItem(storageKey)
    } catch {
      // ignore
    }
  }

  private setStatus(status: AutosaveStatus): void {
    const same = status.state === this.status.state && status.revision === this.status.revision && status.detail === this.status.detail
    this.status = status
    if (!same) this.options.onChange(status)
  }
}
