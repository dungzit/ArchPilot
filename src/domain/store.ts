/**
 * Workspace store (task 1.4): the server is the source of truth, `localStorage`
 * is only a cache (build-scope D5).
 *
 *  - `loadWorkspace(ownerId)` asks `GET /api/workspaces/current`.
 *      * 200  -> that record; the cache is refreshed.
 *      * 404  -> no workspace yet. If this browser still holds a pre-server
 *               workspace under the legacy key, it is imported ONCE with
 *               `PUT revision 0` (the "first successful login" import).
 *      * unreachable -> the cached copy for THIS user, marked `offline`.
 *    A save that failed while offline is kept in the cache as `pending` and
 *    pushed on the next successful load (or via `retryPendingSave`).
 *  - `saveWorkspace(ownerId, input, baseRevision)` asks `PUT` with the revision
 *    the caller last saw. The server assigns the next one; the client never
 *    increments it.
 *      * 409 (someone saved a newer revision) -> the newer record is reloaded
 *        and returned as `conflict`, nothing is overwritten.
 *      * unreachable -> kept locally as `offline`, never silently dropped.
 *    Any other failure (422, 500, 401) throws the `ApiError`.
 *
 * The cache is scoped by owner id, so a second person signing in on the same
 * browser never sees the first person's cached workspace, and it is cleared on
 * logout. The legacy key is never deleted (it is the user's pre-server data);
 * a marker records that the one-time import decision has been made.
 */
import { getCurrentWorkspace, putCurrentWorkspace } from '../api/workspace'
import { isApiError } from '../api/client'

export interface WorkspaceRecord {
  id: string
  name: string
  projectName: string
  systemName: string
  deploymentTarget: string
  revision: number
  updatedAt: string
}

/** The editable fields. `id`, `revision` and `updatedAt` are server-owned. */
export type WorkspaceInput = Pick<WorkspaceRecord, 'name' | 'projectName' | 'systemName' | 'deploymentTarget'>

/** Where the pre-server prototype kept its workspace. Read once, never written again. */
export const LEGACY_WORKSPACE_KEY = 'archpilot.workspace.v1'
/** Set once the one-time import decision is made, so it is never made twice. */
export const LEGACY_IMPORT_MARKER_KEY = 'archpilot.workspace.v1.importedAt'
/** The write-through cache. v2 because the value shape (owner + pending) differs from v1. */
export const WORKSPACE_CACHE_KEY = 'archpilot.workspace.cache.v2'

/** Mirrors `DeploymentTarget` in model.ts and in backend/app/schemas.py. */
const DEPLOYMENT_TARGETS = ['aws', 'azure', 'gcp', 'vmware', 'kubernetes', 'on_premises', 'bare_metal', 'hybrid']
const DEFAULT_WORKSPACE_NAME = 'Personal workspace'

export type SyncStatus = 'synced' | 'offline' | 'conflict'

export interface LoadResult {
  workspace: WorkspaceRecord | null
  status: SyncStatus
  /** `imported` = the legacy local workspace was just copied to the server. */
  source: 'server' | 'imported' | 'cache' | 'none'
  /** Set when a pending offline edit could not be pushed because the server moved on. */
  conflictDetail?: string
}

export type SaveResult =
  | { status: 'saved'; workspace: WorkspaceRecord }
  | { status: 'conflict'; workspace: WorkspaceRecord | null; detail: string }
  | { status: 'offline'; workspace: WorkspaceRecord }

interface PendingSave {
  input: WorkspaceInput
  baseRevision: number
  savedAt: string
}

interface CacheEntry {
  ownerId: string
  record: WorkspaceRecord | null
  pending?: PendingSave
}

/* ------------------------------------------------------------------ *
 * localStorage helpers. Every access is guarded: storage can be full,
 * disabled, or hold garbage from an older build.
 * ------------------------------------------------------------------ */

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readJson(key: string): unknown {
  const raw = storage()?.getItem(key)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value))
  } catch {
    // Quota or privacy mode: the cache is an optimisation, never a reason to fail a save.
  }
}

function readCache(ownerId: string): CacheEntry | null {
  const entry = readJson(WORKSPACE_CACHE_KEY) as CacheEntry | null
  return entry && typeof entry === 'object' && entry.ownerId === ownerId ? entry : null
}

function writeCache(entry: CacheEntry): void {
  writeJson(WORKSPACE_CACHE_KEY, entry)
}

/** The cached workspace for this user (including an unsaved offline edit), or null. */
export function readCachedWorkspace(ownerId: string): WorkspaceRecord | null {
  const entry = readCache(ownerId)
  if (!entry) return null
  return entry.pending ? optimisticRecord(entry.record, entry.pending) : entry.record
}

export function hasPendingSave(ownerId: string): boolean {
  return Boolean(readCache(ownerId)?.pending)
}

/** Logout (D5). The legacy key and the import marker are deliberately kept. */
export function clearWorkspaceCache(): void {
  try {
    storage()?.removeItem(WORKSPACE_CACHE_KEY)
  } catch {
    // nothing to do
  }
}

function optimisticRecord(base: WorkspaceRecord | null, pending: PendingSave): WorkspaceRecord {
  return {
    id: base?.id ?? 'local-unsaved',
    ...pending.input,
    // Unchanged on purpose: the next PUT must still say which revision the edit was based on.
    revision: pending.baseRevision,
    updatedAt: pending.savedAt,
  }
}

/* ------------------------------------------------------------------ *
 * Legacy import
 * ------------------------------------------------------------------ */

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/**
 * The legacy record, normalised to what the server accepts (name 1–120 chars,
 * other text ≤ 200, a known deployment target), or null when there is none or
 * the import was already decided.
 */
export function readLegacyWorkspace(): WorkspaceInput | null {
  if (storage()?.getItem(LEGACY_IMPORT_MARKER_KEY)) return null
  const legacy = readJson(LEGACY_WORKSPACE_KEY)
  if (!legacy || typeof legacy !== 'object') return null
  const record = legacy as Record<string, unknown>
  const target = text(record.deploymentTarget, 40)
  return {
    name: text(record.name, 120) || DEFAULT_WORKSPACE_NAME,
    projectName: text(record.projectName, 200),
    systemName: text(record.systemName, 200),
    deploymentTarget: DEPLOYMENT_TARGETS.includes(target) ? target : 'on_premises',
  }
}

function markLegacyHandled(ownerId: string, outcome: 'imported' | 'server-already-had-one'): void {
  writeJson(LEGACY_IMPORT_MARKER_KEY, { at: new Date().toISOString(), ownerId, outcome })
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

function isUnreachable(error: unknown): boolean {
  return isApiError(error) && error.kind === 'unreachable'
}

function isConflict(error: unknown): boolean {
  return isApiError(error) && error.status === 409
}

export async function loadWorkspace(ownerId: string, signal?: AbortSignal): Promise<LoadResult> {
  let server: WorkspaceRecord | null
  try {
    server = await getCurrentWorkspace(signal)
  } catch (error) {
    if (!isUnreachable(error)) throw error
    const cached = readCachedWorkspace(ownerId)
    return { workspace: cached, status: 'offline', source: cached ? 'cache' : 'none' }
  }

  // A save made while offline goes first: it is newer than anything we fetched,
  // unless someone else saved in between - which the revision check detects.
  const pending = readCache(ownerId)?.pending
  if (pending) {
    const pushed = await pushPending(ownerId, server, pending, signal)
    if (pushed.status === 'saved') return { workspace: pushed.workspace, status: 'synced', source: 'server' }
    if (pushed.status === 'conflict') {
      return { workspace: pushed.workspace, status: 'conflict', source: 'server', conflictDetail: pushed.detail }
    }
    return { workspace: pushed.workspace, status: 'offline', source: 'cache' }
  }

  if (server) {
    if (readLegacyWorkspace()) markLegacyHandled(ownerId, 'server-already-had-one')
    writeCache({ ownerId, record: server })
    return { workspace: server, status: 'synced', source: 'server' }
  }

  const legacy = readLegacyWorkspace()
  if (!legacy) {
    writeCache({ ownerId, record: null })
    return { workspace: null, status: 'synced', source: 'none' }
  }
  const imported = await saveWorkspace(ownerId, legacy, 0, signal)
  if (imported.status === 'saved') {
    markLegacyHandled(ownerId, 'imported')
    return { workspace: imported.workspace, status: 'synced', source: 'imported' }
  }
  if (imported.status === 'conflict') {
    // Another tab created it between our GET and PUT. The server copy wins.
    markLegacyHandled(ownerId, 'server-already-had-one')
    return { workspace: imported.workspace, status: 'synced', source: 'server' }
  }
  return { workspace: imported.workspace, status: 'offline', source: 'cache' }
}

async function pushPending(ownerId: string, server: WorkspaceRecord | null, pending: PendingSave, signal?: AbortSignal): Promise<SaveResult> {
  const result = await saveWorkspace(ownerId, pending.input, pending.baseRevision, signal)
  if (result.status === 'conflict' && result.workspace === null && server) {
    return { ...result, workspace: server }
  }
  return result
}

export async function saveWorkspace(ownerId: string, input: WorkspaceInput, baseRevision: number, signal?: AbortSignal): Promise<SaveResult> {
  try {
    const saved = await putCurrentWorkspace({ ...input, revision: baseRevision }, signal)
    writeCache({ ownerId, record: saved })
    return { status: 'saved', workspace: saved }
  } catch (error) {
    if (isConflict(error)) {
      const detail = isApiError(error) ? error.detail : 'revision conflict'
      let latest: WorkspaceRecord | null = null
      try {
        latest = await getCurrentWorkspace(signal)
      } catch {
        latest = readCache(ownerId)?.record ?? null
      }
      // The server copy replaces the cache, including any pending edit: the
      // user is told, and re-applies the change on top of the newer revision.
      writeCache({ ownerId, record: latest })
      return { status: 'conflict', workspace: latest, detail }
    }
    if (isUnreachable(error)) {
      const previous = readCache(ownerId)
      const pending: PendingSave = { input, baseRevision, savedAt: new Date().toISOString() }
      writeCache({ ownerId, record: previous?.record ?? null, pending })
      return { status: 'offline', workspace: optimisticRecord(previous?.record ?? null, pending) }
    }
    throw error
  }
}

/** Push an edit that was saved while offline. `null` when there is nothing pending. */
export async function retryPendingSave(ownerId: string, signal?: AbortSignal): Promise<SaveResult | null> {
  const entry = readCache(ownerId)
  if (!entry?.pending) return null
  return pushPending(ownerId, entry.record, entry.pending, signal)
}
