/**
 * React Flow renderers for the design canvas (tasks 2.2-2.4):
 * - ComponentNode: a catalogue role as a card (role, label, code name, issue
 *   count as glyph + number + word in the accessible name);
 * - ContainerNode: site / zone / network segment / hypervisor cluster /
 *   container platform, resizable, with drop-target feedback that uses a
 *   border style + glyph + text, never colour alone (design-v2 4.2.3);
 * - ArchEdge: access = solid line + key glyph, flow = dashed; the label is
 *   always visible (design-v2 4.2.6).
 */
import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  NodeResizer,
  Position,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'

export interface DropHint {
  ok: boolean
  /** Text shown inside the container: "Drop into Room A" or "NEST-05: ...". */
  message: string
}

export interface DesignNodeData extends Record<string, unknown> {
  label: string
  codeName: string
  roleLabel: string
  layer: string
  issueCount: number
  issueWord: string
  /** Container only. */
  tag?: string
  drop?: DropHint
  minWidth?: number
  minHeight?: number
  onResizeEnd?: (id: string, box: { x: number; y: number; width: number; height: number }) => void
}

export type ComponentFlowNode = Node<DesignNodeData, 'component'>
export type ContainerFlowNode = Node<DesignNodeData, 'container'>
export type DesignFlowNode = ComponentFlowNode | ContainerFlowNode

export interface DesignEdgeData extends Record<string, unknown> {
  kind: 'flow' | 'access'
  text: string
}
export type DesignFlowEdge = Edge<DesignEdgeData, 'arch'>

function IssueMark({ count, word }: { count: number; word: string }) {
  if (count === 0) return null
  return <span className="dw-node-issues" title={word}><span aria-hidden="true">▲</span>{count}</span>
}

export const ComponentNode = memo(function ComponentNode({ data, selected }: NodeProps<ComponentFlowNode>) {
  return (
    <div className={`dw-node layer-${data.layer}${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <span className="dw-node-role">{data.roleLabel}</span>
      <strong className="dw-node-label">{data.label}</strong>
      <code className="dw-node-code">{data.codeName}</code>
      <IssueMark count={data.issueCount} word={data.issueWord} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
})

export const ContainerNode = memo(function ContainerNode({ id, data, selected }: NodeProps<ContainerFlowNode>) {
  const dropClass = data.drop ? (data.drop.ok ? ' drop-ok' : ' drop-refused') : ''
  return (
    <div className={`dw-container layer-${data.layer}${selected ? ' selected' : ''}${dropClass}`}>
      <NodeResizer
        isVisible={selected}
        minWidth={data.minWidth}
        minHeight={data.minHeight}
        onResizeEnd={(_event, box) => data.onResizeEnd?.(id, box)}
      />
      <Handle type="target" position={Position.Left} />
      <div className="dw-container-head">
        <span className="dw-node-role">{data.roleLabel}</span>
        <strong className="dw-node-label">{data.label}</strong>
        <code className="dw-node-code">{data.codeName}</code>
        {data.tag && <span className="dw-chip">{data.tag}</span>}
        <IssueMark count={data.issueCount} word={data.issueWord} />
      </div>
      {data.drop && (
        <div className="dw-drop-hint" role="status">
          <span aria-hidden="true">{data.drop.ok ? '✓ ' : '⊘ '}</span>{data.drop.message}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
})

export const ArchEdge = memo(function ArchEdge(props: EdgeProps<DesignFlowEdge>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd, markerStart } = props
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const access = data?.kind === 'access'
  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        markerStart={markerStart}
        className={`dw-edge ${access ? 'access' : 'flow'}${selected ? ' selected' : ''}`}
        style={access ? undefined : { strokeDasharray: '6 4' }}
      />
      <EdgeLabelRenderer>
        <div
          className={`dw-edge-label ${access ? 'access' : 'flow'}${selected ? ' selected' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {access && <span aria-hidden="true">⚿ </span>}
          {data?.text}
        </div>
      </EdgeLabelRenderer>
    </>
  )
})

export const nodeTypes = { component: ComponentNode, container: ContainerNode }
export const edgeTypes = { arch: ArchEdge }
