/** Save bytes as a file through a temporary object URL (browser only). */
export function downloadBytes(data: Uint8Array, fileName: string, mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'): void {
  const blob = new Blob([data.slice().buffer], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Human-readable message for an API or runtime error. */
export function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'detail' in e && typeof (e as { detail: unknown }).detail === 'string') {
    const status = (e as { status?: number }).status
    return status ? `${(e as { detail: string }).detail} (HTTP ${status})` : (e as { detail: string }).detail
  }
  return e instanceof Error ? e.message : String(e)
}
