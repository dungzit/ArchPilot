/**
 * React binding for the pure editor reducer (model/editor.ts). A ref mirrors
 * the latest state so two edits in one event handler both see the newest
 * document (no lost updates), and every refusal is reported through `onError`
 * for the toast.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { ArchGraphV2, Command, CommandError } from '../../domain/graph'
import { canRedo, canUndo, record } from './model/history'
import {
  createEditorState,
  redoEdit,
  replaceDocument,
  runCommands,
  select as selectIn,
  undoEdit,
  type EditorState,
  type RunOptions,
  type Selection,
} from './model/editor'

export interface DesignEditor {
  document: ArchGraphV2
  selection: Selection
  canUndo: boolean
  canRedo: boolean
  /** One undo step. Returns false (and reports the reason) when refused. */
  run: (commands: Command[], options?: RunOptions) => boolean
  undo: () => void
  redo: () => void
  select: (selection: Selection) => void
  /** Replace from the server (history restarts). */
  replace: (document: ArchGraphV2) => void
  /** Adopt a document as one undoable step (restoring a pending local copy). */
  adopt: (document: ArchGraphV2) => void
}

export function useDesignEditor(initial: ArchGraphV2, onError: (error: CommandError) => void): DesignEditor {
  const [state, setState] = useState<EditorState>(() => createEditorState(initial))
  const latest = useRef(state)
  const errorRef = useRef(onError)
  errorRef.current = onError

  const commit = useCallback((next: EditorState) => {
    latest.current = next
    setState(next)
  }, [])

  const run = useCallback((commands: Command[], options: RunOptions = {}) => {
    if (commands.length === 0) return true
    const result = runCommands(latest.current, commands, { now: Date.now(), ...options })
    if (!result.ok) {
      errorRef.current(result.error)
      return false
    }
    commit(result.state)
    return true
  }, [commit])

  const undo = useCallback(() => commit(undoEdit(latest.current)), [commit])
  const redo = useCallback(() => commit(redoEdit(latest.current)), [commit])
  const select = useCallback((selection: Selection) => {
    const next = selectIn(latest.current, selection)
    if (next.selection?.id !== latest.current.selection?.id || next.selection?.kind !== latest.current.selection?.kind) commit(next)
  }, [commit])
  const replace = useCallback((document: ArchGraphV2) => commit(replaceDocument(latest.current, document)), [commit])
  const adopt = useCallback((document: ArchGraphV2) => {
    commit({ ...latest.current, history: record(latest.current.history, document) })
  }, [commit])

  return useMemo(() => ({
    document: state.history.present,
    selection: state.selection,
    canUndo: canUndo(state.history),
    canRedo: canRedo(state.history),
    run, undo, redo, select, replace, adopt,
  }), [state, run, undo, redo, select, replace, adopt])
}
