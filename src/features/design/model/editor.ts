/**
 * The workspace editor state (tasks 2.1 / 2.6): one undoable document history
 * plus a selection. Pure reducer; the React hook in `useDesignEditor.ts` wraps
 * it. Every document change is a list of graph commands run through
 * `applyCommands` (all or nothing), so a refused edit leaves state untouched
 * and returns the command layer's VI/EN reason for a toast.
 */
import { applyCommands, type ArchGraphV2, type Command, type CommandError } from '../../../domain/graph'
import { canRedo, canUndo, createHistory, record, redo, undo, type History } from './history'

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null

export interface EditorState {
  history: History<ArchGraphV2>
  selection: Selection
}

export function createEditorState(document: ArchGraphV2): EditorState {
  return { history: createHistory(document), selection: null }
}

export function currentDocument(state: EditorState): ArchGraphV2 {
  return state.history.present
}

/** Drop a selection whose node or edge no longer exists (after undo, delete, reload). */
export function sanitizeSelection(document: ArchGraphV2, selection: Selection): Selection {
  if (!selection) return null
  if (selection.kind === 'node') return document.nodes.some((node) => node.id === selection.id) ? selection : null
  return document.edges.some((edge) => edge.id === selection.id) ? selection : null
}

export interface RunOptions {
  coalesceKey?: string
  now?: number
  /** Selection after a successful run. `undefined` keeps the current one (sanitised). */
  select?: Selection
}

export type RunResult =
  | { ok: true; state: EditorState }
  | { ok: false; error: CommandError; state: EditorState }

/** Apply `commands` as ONE undo step. Refused = state unchanged plus the reason. */
export function runCommands(state: EditorState, commands: Command[], options: RunOptions = {}): RunResult {
  const result = applyCommands(state.history.present, commands)
  if (!result.ok) return { ok: false, error: result.error, state }
  const history = record(state.history, result.document, { coalesceKey: options.coalesceKey, now: options.now })
  const selection = sanitizeSelection(result.document, options.select !== undefined ? options.select : state.selection)
  return { ok: true, state: { history, selection } }
}

export function undoEdit(state: EditorState): EditorState {
  if (!canUndo(state.history)) return state
  const history = undo(state.history)
  return { history, selection: sanitizeSelection(history.present, state.selection) }
}

export function redoEdit(state: EditorState): EditorState {
  if (!canRedo(state.history)) return state
  const history = redo(state.history)
  return { history, selection: sanitizeSelection(history.present, state.selection) }
}

export function select(state: EditorState, selection: Selection): EditorState {
  return { ...state, selection: sanitizeSelection(state.history.present, selection) }
}

/** Replace the document from outside (server reload after a 409): history restarts. */
export function replaceDocument(state: EditorState, document: ArchGraphV2): EditorState {
  return { history: createHistory(document), selection: sanitizeSelection(document, state.selection) }
}
