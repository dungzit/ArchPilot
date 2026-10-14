/**
 * The design graph as a standalone SVG, from the stored node positions
 * (pilot WP-C, 06 §1 item 3.2). Containers are dashed boxes drawn first,
 * components are boxes with their label and role, edges are straight lines
 * between box borders with an arrowhead and their label at the midpoint.
 *
 * Pure: the browser rasterises the result to PNG (features/hld/rasterise.ts)
 * for the DOCX. Every user string is XML-escaped; nothing from the design is
 * ever interpreted as markup. Geometry mirrors features/design/model/geometry.ts
 * (positions relative to the parent; default component size 184 x 56).
 */
import { getRole } from '../graph/catalog'
import { ancestors, nodeMap } from '../graph/containment'
import type { ArchGraphV2, ArchNodeV2 } from '../graph/types'
import { cleanText } from './format'
import type { HldLanguage } from './types'

const COMPONENT = { width: 184, height: 56 }
const CONTAINER_DEFAULTS: Record<string, { width: number; height: number }> = {
  site: { width: 760, height: 480 },
  zone: { width: 520, height: 340 },
  network_segment: { width: 400, height: 220 },
  hypervisor_cluster: { width: 360, height: 220 },
  container_platform: { width: 360, height: 220 },
}
const PADDING = 32
/** Upper bound for the drawing, so a stray far-away node cannot make a giant image. */
const MAX_SIDE = 6000

export interface DiagramSvg {
  svg: string
  width: number
  height: number
  /** Nodes and edges actually drawn. */
  nodes: number
  edges: number
}

interface Box { x: number; y: number; width: number; height: number }

export function escapeXml(text: string): string {
  return cleanText(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function truncate(text: string, max: number): string {
  const clean = cleanText(text).replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function isContainer(node: ArchNodeV2): boolean {
  return getRole(node.type)?.container === true
}

function sizeOf(node: ArchNodeV2): { width: number; height: number } {
  const size = node.size
  if (size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0) return { width: size.width, height: size.height }
  return isContainer(node) ? CONTAINER_DEFAULTS[node.type] ?? { width: 360, height: 220 } : COMPONENT
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

/** Where the line from the box centre towards (tx, ty) leaves the box. */
function borderPoint(box: Box, tx: number, ty: number): { x: number; y: number } {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const scale = Math.min(Math.abs((box.width / 2) / (dx || 1e-9)), Math.abs((box.height / 2) / (dy || 1e-9)))
  return { x: cx + dx * Math.min(scale, 1), y: cy + dy * Math.min(scale, 1) }
}

const round = (value: number) => Math.round(value * 10) / 10

export function buildDiagramSvg(graph: ArchGraphV2 | null, language: HldLanguage): DiagramSvg | null {
  if (!graph || graph.nodes.length === 0) return null
  const byId = nodeMap(graph)
  const boxes = new Map<string, Box>()
  for (const node of byId.values()) {
    let x = finite(node.position?.x ?? 0)
    let y = finite(node.position?.y ?? 0)
    for (const id of ancestors(graph, node.id, byId)) {
      const ancestor = byId.get(id)!
      x += finite(ancestor.position?.x ?? 0)
      y += finite(ancestor.position?.y ?? 0)
    }
    boxes.set(node.id, { x, y, ...sizeOf(node) })
  }
  const all = [...boxes.values()]
  const minX = Math.min(...all.map((box) => box.x)) - PADDING
  const minY = Math.min(...all.map((box) => box.y)) - PADDING
  const width = Math.min(MAX_SIDE, Math.ceil(Math.max(...all.map((box) => box.x + box.width)) - minX + PADDING))
  const height = Math.min(MAX_SIDE, Math.ceil(Math.max(...all.map((box) => box.y + box.height)) - minY + PADDING))
  const at = (box: Box): Box => ({ x: round(box.x - minX), y: round(box.y - minY), width: box.width, height: box.height })

  const depth = (node: ArchNodeV2) => ancestors(graph, node.id, byId).length
  const nodes = [...byId.values()]
  const containers = nodes.filter(isContainer).sort((a, b) => depth(a) - depth(b))
  const components = nodes.filter((node) => !isContainer(node))
  const parts: string[] = []

  for (const node of containers) {
    const box = at(boxes.get(node.id)!)
    const role = getRole(node.type)?.label[language] ?? node.type
    parts.push(
      `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="10" fill="#f4f8fb" fill-opacity="0.6" stroke="#7f95aa" stroke-width="1.5" stroke-dasharray="6 4"/>`,
      `<text x="${box.x + 12}" y="${box.y + 22}" font-size="14" font-weight="700" fill="#17324d">${escapeXml(truncate(node.label, 60))}</text>`,
      `<text x="${box.x + 12}" y="${box.y + 38}" font-size="11" fill="#5f6f80">${escapeXml(truncate(role, 40))}</text>`,
    )
  }

  let edgeCount = 0
  for (const edge of graph.edges) {
    const source = boxes.get(edge.source)
    const target = boxes.get(edge.target)
    if (!source || !target || edge.source === edge.target) continue
    const s = at(source)
    const t = at(target)
    const from = borderPoint(s, t.x + t.width / 2, t.y + t.height / 2)
    const to = borderPoint(t, s.x + s.width / 2, s.y + s.height / 2)
    const both = edge.direction === 'bidirectional'
    const dash = edge.kind === 'flow' ? ' stroke-dasharray="5 4"' : ''
    parts.push(
      `<line x1="${round(from.x)}" y1="${round(from.y)}" x2="${round(to.x)}" y2="${round(to.y)}" stroke="#4d78b8" stroke-width="1.6"${dash} marker-end="url(#arrow)"${both ? ' marker-start="url(#arrow-start)"' : ''}/>`,
    )
    if (edge.label && edge.label.trim()) {
      const mx = round((from.x + to.x) / 2)
      const my = round((from.y + to.y) / 2)
      parts.push(`<text x="${mx}" y="${my - 4}" font-size="11" text-anchor="middle" fill="#2c4a66" stroke="#ffffff" stroke-width="3" paint-order="stroke">${escapeXml(truncate(edge.label, 40))}</text>`)
    }
    edgeCount += 1
  }

  for (const node of components) {
    const box = at(boxes.get(node.id)!)
    const annotation = node.type === 'note' || node.type === 'shape' || node.type === 'text'
    const role = getRole(node.type)?.label[language] ?? node.type
    const label = annotation ? node.annotation?.text || node.label : node.label
    parts.push(
      `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="8" fill="${annotation ? '#fff8e6' : '#ffffff'}" stroke="${annotation ? '#d99828' : '#17324d'}" stroke-width="1.5"/>`,
      `<text x="${box.x + box.width / 2}" y="${box.y + box.height / 2 - 3}" font-size="13" font-weight="700" text-anchor="middle" fill="#17324d">${escapeXml(truncate(label, Math.max(8, Math.floor(box.width / 7.5))))}</text>`,
      `<text x="${box.x + box.width / 2}" y="${box.y + box.height / 2 + 14}" font-size="11" text-anchor="middle" fill="#5f6f80">${escapeXml(truncate(annotation ? '' : role, Math.max(8, Math.floor(box.width / 6.5))))}</text>`,
    )
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, Helvetica, sans-serif">`,
    '<defs>',
    '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#4d78b8"/></marker>',
    '<marker id="arrow-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M10,0 L0,5 L10,10 z" fill="#4d78b8"/></marker>',
    '</defs>',
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    ...parts,
    '</svg>',
  ].join('\n')
  return { svg, width, height, nodes: nodes.length, edges: edgeCount }
}
