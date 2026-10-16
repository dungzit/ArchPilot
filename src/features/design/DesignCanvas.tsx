/**
 * The design canvas (tasks 2.1-2.4) on React Flow (@xyflow/react 12, MIT).
 *
 * The document is the single source of truth: React Flow keeps a local copy
 * of the nodes only while something is being dragged or resized, and every
 * finished gesture becomes graph commands (one undo step). A refused gesture
 * (NEST rule, depth) shows a toast naming the rule and the canvas snaps back
 * to the document.
 *
 * Gestures: drag from the palette (drop feedback on the container under the
 * pointer), drag a node into another container (re-parent), resize a
 * container (never smaller than its children plus padding), connect two
 * handles (pair defaults), click to select, pan and zoom with 8 px snapping.
 * Keyboard paths live in the workspace (command menu, Layers, Inspector).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FocusEvent } from 'react'
import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ArchGraphV2, Command, Problem } from '../../domain/graph'
import { copy, type TextFn } from '../../ui/copy'
import { edgeTypes, nodeTypes, type DesignFlowNode, type DropHint } from './canvasParts'
import { toFlowEdges, toFlowNodes } from './flowMapping'
import type { RunOptions, Selection } from './model/editor'
import { dropTargetFor, subtreeIds, GRID } from './model/geometry'
import { planAddNode, planConnect, planMoveNode } from './model/operations'
import { currentPaletteDrag, ROLE_DRAG_TYPE, setPaletteDrag } from './Palette'

export interface DesignCanvasProps {
  document: ArchGraphV2
  selection: Selection
  issues: Problem[]
  language: 'vi' | 'en'
  text: TextFn
  run: (commands: Command[], options?: RunOptions) => boolean
  onSelect: (selection: Selection) => void
  onToast: (message: string) => void
  onAddFirst: () => void
  onOpenMenu: () => void
}

export function DesignCanvas(props: DesignCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}

/** Client coordinates of a mouse, touch or drag event (touch: the finger that moved). */
function clientPoint(event: { clientX: number; clientY: number } | TouchEvent): { x: number; y: number } {
  if ('changedTouches' in event) {
    const touch = event.changedTouches[0] ?? event.touches[0]
    return { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 }
  }
  return { x: event.clientX, y: event.clientY }
}

/** Document-derived nodes, carrying over React Flow's live fields for the same id. */
export function mergeLive(current: DesignFlowNode[], derived: DesignFlowNode[]): DesignFlowNode[] {
  const live = new Map(current.map((node) => [node.id, node]))
  return derived.map((node) => {
    const previous = live.get(node.id)
    if (!previous) return node
    const merged = previous.measured ? { ...node, measured: previous.measured } : node
    return previous.dragging ? { ...merged, position: previous.position, dragging: true } : merged
  }) as DesignFlowNode[]
}

type DropState = { containerId: string; hint: DropHint } | null

function CanvasInner({ document, selection, issues, language, text, run, onSelect, onToast, onAddFirst, onOpenMenu }: DesignCanvasProps) {
  const flow = useReactFlow()
  const [drop, setDrop] = useState<DropState>(null)
  const docRef = useRef(document)
  docRef.current = document

  const onResizeEnd = useCallback((id: string, box: { x: number; y: number; width: number; height: number }) => {
    const node = docRef.current.nodes.find((candidate) => candidate.id === id)
    if (!node) return
    const commands: Command[] = []
    const x = Math.round(box.x)
    const y = Math.round(box.y)
    if (x !== node.position.x || y !== node.position.y) commands.push({ type: 'moveNode', id, position: { x, y } })
    commands.push({ type: 'resizeNode', id, size: { width: Math.round(box.width), height: Math.round(box.height) } })
    run(commands)
  }, [run])

  const derived = useMemo(
    () => toFlowNodes({ document, selection, issues, language, text, drop, onResizeEnd }),
    [document, selection, issues, language, text, drop, onResizeEnd],
  )
  const derivedRef = useRef(derived)
  derivedRef.current = derived
  const [nodes, setNodes] = useState<DesignFlowNode[]>(derived)
  // Keep what React Flow measured, and the live position of a node being dragged:
  // replacing them mid-gesture (a drop-hint update) makes React Flow drop the drag
  // (warning #015 "node not initialized").
  useEffect(() => { setNodes((current) => mergeLive(current, derived)) }, [derived])
  const edges = useMemo(() => toFlowEdges({ document, selection, issues, language, text }), [document, selection, issues, language, text])

  const onNodesChange = useCallback((changes: NodeChange<DesignFlowNode>[]) => {
    // Selection and removal belong to the workspace (and go through commands).
    const local = changes.filter((change) => change.type === 'position' || change.type === 'dimensions')
    if (local.length > 0) setNodes((current) => applyNodeChanges(local, current))
  }, [])

  // Back to the document positions (a refused gesture), keeping measurements.
  const snapBack = useCallback(() => setNodes((current) => mergeLive(current.map((node) => ({ ...node, dragging: false })), derivedRef.current)), [])

  const refusal = useCallback((code: string, message: { vi: string; en: string }) => `${code}: ${text(message)}`, [text])

  const hintFor = useCallback((roleId: string, point: { x: number; y: number }, exclude?: Set<string>): DropState => {
    const target = dropTargetFor(docRef.current, roleId, point, exclude)
    if (target.parentId === null) return null
    const container = docRef.current.nodes.find((node) => node.id === target.parentId)
    const message = target.verdict.ok
      ? text(copy(`Thả vào ${container?.label ?? ''}`, `Drop into ${container?.label ?? ''}`))
      : refusal(target.verdict.ruleId, target.verdict.message)
    return { containerId: target.parentId, hint: { ok: target.verdict.ok, message } }
  }, [refusal, text])

  const updateDrop = useCallback((next: DropState) => {
    setDrop((current) => (
      current?.containerId === next?.containerId && current?.hint.ok === next?.hint.ok && current?.hint.message === next?.hint.message ? current : next
    ))
  }, [])

  const onNodeDrag: OnNodeDrag<DesignFlowNode> = useCallback((event, node) => {
    const docNode = docRef.current.nodes.find((candidate) => candidate.id === node.id)
    if (!docNode) return
    const pointer = flow.screenToFlowPosition(clientPoint(event))
    updateDrop(hintFor(docNode.type, pointer, subtreeIds(docRef.current, node.id)))
  }, [flow, hintFor, updateDrop])

  const onNodeDragStop: OnNodeDrag<DesignFlowNode> = useCallback((event, node) => {
    setDrop(null)
    const absolute = flow.getInternalNode(node.id)?.internals.positionAbsolute ?? node.position
    const pointer = flow.screenToFlowPosition(clientPoint(event))
    const plan = planMoveNode(docRef.current, node.id, absolute, pointer)
    if (!plan.ok) {
      onToast(refusal(plan.error.code, plan.error.message))
      snapBack()
      return
    }
    if (plan.commands.length === 0 || !run(plan.commands, { select: { kind: 'node', id: node.id } })) snapBack()
  }, [flow, onToast, refusal, run, snapBack])

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    const roleId = currentPaletteDrag()
    if (!roleId && !Array.from(event.dataTransfer.types).includes(ROLE_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (roleId) updateDrop(hintFor(roleId, flow.screenToFlowPosition(clientPoint(event))))
  }, [flow, hintFor, updateDrop])

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    const roleId = event.dataTransfer.getData(ROLE_DRAG_TYPE) || currentPaletteDrag()
    setPaletteDrag(null)
    setDrop(null)
    if (!roleId) return
    event.preventDefault()
    const at = flow.screenToFlowPosition(clientPoint(event))
    const plan = planAddNode(docRef.current, roleId, language, { at })
    if (!plan.ok) {
      onToast(refusal(plan.error.code, plan.error.message))
      return
    }
    run(plan.commands, { select: { kind: 'node', id: plan.createdId! } })
  }, [flow, language, onToast, refusal, run])

  const onConnect = useCallback((connection: Connection) => {
    const plan = planConnect(docRef.current, connection.source, connection.target, language)
    if (!plan.ok) {
      onToast(refusal(plan.error.code, plan.error.message))
      return
    }
    run(plan.commands, { select: { kind: 'edge', id: plan.createdId! } })
  }, [language, onToast, refusal, run])

  // Tabbing onto a node or edge selects it, so the Inspector follows the keyboard.
  const onFocusCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const element = event.target as HTMLElement
    const id = element.getAttribute?.('data-id')
    if (!id) return
    if (element.classList.contains('react-flow__node')) onSelect({ kind: 'node', id })
    else if (element.classList.contains('react-flow__edge')) onSelect({ kind: 'edge', id })
  }, [onSelect])

  return (
    <div
      className="dw-canvas"
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null) }}
      onFocusCapture={onFocusCapture}
    >
      <ReactFlow<DesignFlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={(connection) => connection.source !== connection.target}
        onNodeClick={(_event, node) => onSelect({ kind: 'node', id: node.id })}
        onEdgeClick={(_event, edge) => onSelect({ kind: 'edge', id: edge.id })}
        onPaneClick={() => onSelect(null)}
        connectionMode={ConnectionMode.Loose}
        snapToGrid
        snapGrid={[GRID, GRID]}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        disableKeyboardA11y
        nodesFocusable
        edgesFocusable
        minZoom={0.2}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        aria-label={text(copy('Canvas thiết kế. Dùng Lớp hoặc menu lệnh (/) để thao tác bằng bàn phím.', 'Design canvas. Use Layers or the command menu (/) to work with the keyboard.'))}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable style={{ width: 150, height: 100 }} ariaLabel={text(copy('Bản đồ thu nhỏ', 'Mini map'))} />
      </ReactFlow>
      {document.nodes.length === 0 && (
        <div className="dw-canvas-empty">
          <strong>{text(copy('Canvas đang trống', 'The canvas is empty'))}</strong>
          <p>{text(copy('Bắt đầu với một địa điểm và một phân đoạn mạng, hoặc gõ / để thêm bất kỳ thành phần nào.', 'Start with a site and a network segment, or press / to add any component.'))}</p>
          <div className="dw-row">
            <button type="button" className="dw-button primary" onClick={onAddFirst}>{text(copy('Thêm địa điểm', 'Add site'))}</button>
            <button type="button" className="dw-button" onClick={onOpenMenu}>{text(copy('Menu lệnh (/)', 'Command menu (/)'))}</button>
          </div>
        </div>
      )}
    </div>
  )
}
