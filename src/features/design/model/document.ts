/**
 * Document helpers for the workspace: a blank design (REQ-DES-001), opening a
 * stored graph of either schema version, and the ordered Issues list
 * (REQ-DES-011, design-v2 4.2.8).
 */
import {
  CURRENT_SCHEMA_VERSION,
  getRole,
  migrateGraph,
  toCodeName,
  validateGraph,
  type ArchGraph,
  type ArchGraphV2,
  type Problem,
  type Severity,
} from '../../../domain/graph'

export const DESIGN_NAME_MAX = 120

export function blankDesign(name: string): ArchGraphV2 {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: { codeName: toCodeName(name, 'design'), environment: 'dev' },
    nodes: [],
    edges: [],
  }
}

/** A stored graph as a 2.0 document. 1.0 designs are migrated in memory; the next save writes 2.0. */
export function openGraph(graph: unknown, name: string): ArchGraphV2 {
  const document = graph as ArchGraph
  if (!document || typeof document !== 'object' || !Array.isArray((document as { nodes?: unknown }).nodes)) {
    throw new Error('The stored design is not an ArchGraph document.')
  }
  return document.schemaVersion === '2.0' ? document : migrateGraph(document, { name })
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

export interface Issue extends Problem {
  /** codeName of the node (or of the edge's source) for sorting and display. */
  subject: string
}

/** validateGraph() sorted: severity, then rule id, then code name (design-v2 4.2.8). */
export function sortedIssues(document: ArchGraphV2): Issue[] {
  const byId = new Map(document.nodes.map((node) => [node.id, node]))
  const edges = new Map(document.edges.map((edge) => [edge.id, edge]))
  return validateGraph(document)
    .map((problem) => {
      const nodeId = problem.nodeId ?? (problem.edgeId ? edges.get(problem.edgeId)?.source : undefined)
      const node = nodeId ? byId.get(nodeId) : undefined
      const edge = problem.edgeId ? edges.get(problem.edgeId) : undefined
      const subject = edge
        ? `${byId.get(edge.source)?.codeName ?? edge.source} -> ${byId.get(edge.target)?.codeName ?? edge.target}`
        : node?.codeName ?? ''
      return { ...problem, subject }
    })
    .sort((a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0) ||
      (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0),
    )
}

export function issueCounts(issues: Problem[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
  for (const issue of issues) counts[issue.severity] += 1
  return counts
}

/** Accessible name of a node on the canvas and in Layers (design-v2 4.2.19). */
export function describeNode(document: ArchGraphV2, nodeId: string, language: 'vi' | 'en', issues: Problem[]): string {
  const node = document.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return nodeId
  const role = getRole(node.type)?.label[language] ?? node.type
  const parent = node.parentId ? document.nodes.find((candidate) => candidate.id === node.parentId) : undefined
  const connections = document.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId).length
  const count = issues.filter((issue) => issue.nodeId === nodeId).length
  const parts = [`${node.label}, ${role}, ${node.codeName}`]
  if (parent) parts.push(language === 'vi' ? `trong ${parent.label}` : `in ${parent.label}`)
  parts.push(language === 'vi' ? `${connections} kết nối` : `${connections} connection${connections === 1 ? '' : 's'}`)
  if (count > 0) parts.push(language === 'vi' ? `${count} vấn đề` : `${count} issue${count === 1 ? '' : 's'}`)
  return parts.join(', ')
}
