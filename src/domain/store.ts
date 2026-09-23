export interface WorkspaceRecord {
  id: string
  name: string
  projectName: string
  systemName: string
  deploymentTarget: string
  revision: number
  updatedAt: string
}

const STORAGE_KEY = 'archpilot.workspace.v1'

export function loadWorkspace(): WorkspaceRecord | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as WorkspaceRecord
  } catch {
    return null
  }
}

export function saveWorkspace(input: Omit<WorkspaceRecord, 'revision' | 'updatedAt'>): WorkspaceRecord {
  const previous = loadWorkspace()
  const record: WorkspaceRecord = {
    ...input,
    revision: (previous?.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  return record
}
