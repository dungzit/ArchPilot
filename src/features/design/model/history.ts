/**
 * Snapshot undo/redo (task 2.6; REQ-DES-010, design-v2 4.2.19).
 *
 * The command layer never mutates a document, so a history step is just the
 * previous document object: structural sharing keeps 100 snapshots cheap.
 * Pure: no clock is read here; callers pass `now` for coalescing.
 *
 * Rules:
 * - at most HISTORY_LIMIT steps back (requirement: at least 50);
 * - a new edit clears the redo stack;
 * - edits with the same `coalesceKey` within COALESCE_MS merge into one step
 *   (typing in one inspector field is one undo step, not one per key);
 * - selection, viewport and panel sizes are never in history.
 */
export const HISTORY_LIMIT = 100
export const COALESCE_MS = 1000

export interface History<T> {
  past: T[]
  present: T
  future: T[]
  /** Coalescing state of the newest step. */
  lastKey?: string
  lastAt?: number
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

export interface RecordOptions {
  coalesceKey?: string
  now?: number
}

export function record<T>(history: History<T>, next: T, options: RecordOptions = {}): History<T> {
  if (next === history.present) return history
  const { coalesceKey, now } = options
  const coalesce =
    coalesceKey !== undefined &&
    coalesceKey === history.lastKey &&
    now !== undefined &&
    history.lastAt !== undefined &&
    now - history.lastAt <= COALESCE_MS &&
    history.future.length === 0 &&
    history.past.length > 0
  if (coalesce) {
    return { past: history.past, present: next, future: [], lastKey: coalesceKey, lastAt: now }
  }
  const past = [...history.past, history.present]
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present: next,
    future: [],
    ...(coalesceKey !== undefined ? { lastKey: coalesceKey, lastAt: now } : {}),
  }
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0
}

export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history
  const previous = history.past[history.past.length - 1]
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] }
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history
  const [next, ...rest] = history.future
  return { past: [...history.past, history.present], present: next, future: rest }
}
