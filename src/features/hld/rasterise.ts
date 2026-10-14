/**
 * SVG -> PNG in the browser via an offscreen canvas, for the diagram in HLD
 * section 3.2. Best effort: any failure (no canvas, image error, timeout)
 * resolves to null and the document links to the design instead.
 *
 * The SVG comes from domain/hld/diagram.ts, which escapes every user string
 * and has no scripts or external references, so loading it as an image data
 * URL does not taint the canvas.
 */
import type { DiagramImage } from '../../domain/hld'

/** Keep well inside browser canvas limits (Chrome/Edge: 16384 px per side, ~268 M px area). */
const MAX_SIDE = 4096

export async function svgToPng(svg: string, width: number, height: number, options: { scale?: number; timeoutMs?: number } = {}): Promise<DiagramImage | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || !(width > 0) || !(height > 0)) return null
  const scale = Math.min(options.scale ?? 2, MAX_SIDE / width, MAX_SIDE / height)
  const pixelWidth = Math.max(1, Math.round(width * scale))
  const pixelHeight = Math.max(1, Math.round(height * scale))
  try {
    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, options.timeoutMs ?? 4000)
    if (!image) return null
    const canvas = document.createElement('canvas')
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    const context = canvas.getContext('2d')
    if (!context) return null
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, pixelWidth, pixelHeight)
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return null
    const png = new Uint8Array(await blob.arrayBuffer())
    return png.byteLength > 0 ? { png, width: pixelWidth, height: pixelHeight } : null
  } catch {
    return null
  }
}

function loadImage(src: string, timeoutMs: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    const timer = setTimeout(() => resolve(null), timeoutMs)
    image.onload = () => {
      clearTimeout(timer)
      resolve(image)
    }
    image.onerror = () => {
      clearTimeout(timer)
      resolve(null)
    }
    image.src = src
  })
}
