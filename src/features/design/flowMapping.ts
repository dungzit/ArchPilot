/**
 * ArchGraph 2.0 -> React Flow nodes and edges (task 2.1). Pure apart from
 * type imports: parents first (React Flow requires it), positions relative to
 * the parent (same convention as the contract), containers sized from the
 * document, selection and drop feedback folded into node data, and an
 * accessible name on every node and edge.
 */
import { MarkerType } from '@xyflow/react'
import { getRole, type ArchGraphV2, type Problem } from '../../domain/graph'
import type { TextFn } from '../../ui/copy'
import { copy } from '../../ui/copy'
import type { DesignFlowEdge, DesignFlowNode, DropHint } from './canvasParts'
import type { Selection } from './model/editor'
import { describeNode } from './model/document'
import { modeLabel } from './model/edgeDefaults'
import { isContainerRole, minContainerSize, nodeSize, parentFirstOrder } from './model/geometry'

export interface FlowInput {
  document: ArchGraphV2
  selection: Selection
  issues: Problem[]
  language: 'vi' | 'en'
  text: TextFn
  /** Drop feedback for one container during a drag. */
  drop?: { containerId: string; hint: DropHint } | null
  onResizeEnd?: (id: string, box: { x: number; y: number; width: number; height: number }) => void
}

export function toFlowNodes({ document, selection, issues, language, text, drop, onResizeEnd }: FlowInput): DesignFlowNode[] {
  const byId = new Map(document.nodes.map((node) => [node.id, node]))
  return parentFirstOrder(document).map((node) => {
    const role = getRole(node.type)
    const container = isContainerRole(node.type)
    const size = nodeSize(node)
    const issueCount = issues.filter((issue) => issue.nodeId === node.id).length
    const parent = node.parentId !== undefined ? byId.get(node.parentId) : undefined
    let tag: string | undefined
    if (node.type === 'network_segment' && parent?.type === 'site') tag = text(copy('trải rộng', 'stretched'))
    if (node.type === 'network_segment' && parent?.type === 'zone') tag = text(copy('cục bộ zone', 'zone-local'))
    const min = container ? minContainerSize(document, node.id) : undefined
    const base = {
      id: node.id,
      position: { x: node.position.x, y: node.position.y },
      ...(parent ? { parentId: parent.id } : {}),
      selected: selection?.kind === 'node' && selection.id === node.id,
      width: size.width,
      height: size.height,
      ariaLabel: describeNode(document, node.id, language, issues),
      data: {
        label: node.label,
        codeName: node.codeName,
        roleLabel: role ? text(role.label) : node.type,
        layer: role?.layer ?? 'unknown',
        issueCount,
        issueWord: text(copy(`${issueCount} vấn đề`, `${issueCount} issue${issueCount === 1 ? '' : 's'}`)),
        ...(tag ? { tag } : {}),
        ...(drop && drop.containerId === node.id ? { drop: drop.hint } : {}),
        ...(min ? { minWidth: min.width, minHeight: min.height } : {}),
        ...(onResizeEnd ? { onResizeEnd } : {}),
      },
    }
    return container
      ? { ...base, type: 'container' as const, className: 'dw-flow-container', zIndex: 0 }
      : { ...base, type: 'component' as const }
  })
}

export function toFlowEdges({ document, selection, language, text }: FlowInput): DesignFlowEdge[] {
  const byId = new Map(document.nodes.map((node) => [node.id, node]))
  return document.edges
    .filter((edge) => byId.has(edge.source) && byId.has(edge.target))
    .map((edge) => {
      const kindWord = edge.kind === 'access' ? text(copy('truy cập', 'access')) : text(copy('luồng', 'flow'))
      const shown = edge.label || (edge.mode ? modeLabel(edge.mode)[language] : kindWord)
      const port = edge.port !== undefined ? ` ${edge.protocol ?? ''}/${edge.port}` : ''
      const marker = { type: MarkerType.ArrowClosed, width: 18, height: 18 }
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'arch' as const,
        selected: selection?.kind === 'edge' && selection.id === edge.id,
        markerEnd: marker,
        ...(edge.direction === 'bidirectional' ? { markerStart: marker } : {}),
        ariaLabel: `${byId.get(edge.source)!.label} → ${byId.get(edge.target)!.label}, ${kindWord}, ${shown}${port}`,
        data: { kind: edge.kind, text: `${shown}${port}` },
      }
    })
}
