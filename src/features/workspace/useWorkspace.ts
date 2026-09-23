import { useCallback, useEffect, useRef, useState } from 'react'
import {
  hasPendingSave,
  loadWorkspace,
  retryPendingSave,
  saveWorkspace,
  type SaveResult,
  type WorkspaceInput,
  type WorkspaceRecord,
} from '../../domain/store'

/**
 * What the shell shows about the workspace's server state.
 *  - `loading`  first GET in flight
 *  - `synced`   the server has what the user sees
 *  - `unsaved`  an edit is only in this browser (server unreachable when saving)
 *  - `offline`  the server was unreachable on load; showing the cached copy
 *  - `conflict` someone saved a newer revision; it was reloaded, the edit was not applied
 */
export type WorkspaceSync = 'loading' | 'synced' | 'unsaved' | 'offline' | 'conflict'

export interface WorkspaceState {
  workspace: WorkspaceRecord | null
  sync: WorkspaceSync
  /** One-shot notices worth telling the user about. */
  imported: boolean
  conflictDetail: string | null
}

/** Task 1.4: replaces `useState(() => loadWorkspace())` now that loading is async. */
export function useWorkspace(ownerId: string) {
  const [state, setState] = useState<WorkspaceState>({ workspace: null, sync: 'loading', imported: false, conflictDetail: null })
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    loadWorkspace(ownerId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        const sync: WorkspaceSync =
          result.status === 'offline' ? (hasPendingSave(ownerId) ? 'unsaved' : 'offline') : result.status
        setState({ workspace: result.workspace, sync, imported: result.source === 'imported', conflictDetail: result.conflictDetail ?? null })
      })
      .catch(() => {
        // 401 is handled by client.ts (back to login); anything else leaves the
        // shell usable with no workspace rather than blank.
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, sync: 'offline' }))
      })
    return () => {
      mounted.current = false
      controller.abort()
    }
  }, [ownerId])

  const apply = useCallback((result: SaveResult) => {
    if (!mounted.current) return
    setState((previous) => ({
      workspace: result.workspace ?? previous.workspace,
      sync: result.status === 'saved' ? 'synced' : result.status === 'offline' ? 'unsaved' : 'conflict',
      imported: false,
      conflictDetail: result.status === 'conflict' ? result.detail : null,
    }))
  }, [])

  const save = useCallback(async (input: WorkspaceInput): Promise<SaveResult> => {
    const result = await saveWorkspace(ownerId, input, state.workspace?.revision ?? 0)
    apply(result)
    return result
  }, [apply, ownerId, state.workspace?.revision])

  const retry = useCallback(async () => {
    const result = await retryPendingSave(ownerId)
    if (result) apply(result)
  }, [apply, ownerId])

  return { ...state, save, retry }
}
