/**
 * Pre-flight check of an .xlsx package before exceljs parses it (WP-A2).
 *
 * exceljs loads every row into memory and expands every defined-name range
 * into individual cells, so a hostile 5 MB file could hang the browser tab.
 * This scan reads only the zip directory, [Content_Types].xml,
 * xl/workbook.xml and the sheet XML, and rejects:
 *   - macro-enabled packages (vbaProject.bin or a macroEnabled content type),
 *   - packages whose declared uncompressed size is too large (zip bomb),
 *   - defined names covering too many cells,
 *   - sheets with far more rows than the import limit.
 */
import { strFromU8, unzipSync } from 'fflate'
import { LIMITS } from './layout'
import { msg, type Msg } from './messages'

export type PackageCheck = { ok: true } | { ok: false; message: Msg }

function columnNumber(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

/** Number of cells in "Sheet!$A$1:$C$9" style range lists (comma separated). */
function rangeCells(text: string): number {
  let total = 0
  const re = /\$?([A-Za-z]{1,3})?\$?(\d+)?(?::\$?([A-Za-z]{1,3})?\$?(\d+)?)?$/
  for (const part of text.split(',')) {
    const ref = part.slice(part.lastIndexOf('!') + 1).trim()
    const m = re.exec(ref)
    if (!m) continue
    const c1 = m[1] ? columnNumber(m[1]) : 1
    const r1 = m[2] ? Number(m[2]) : 1
    const c2 = m[3] ? columnNumber(m[3]) : m[1] ? c1 : 16384
    const r2 = m[4] ? Number(m[4]) : m[2] ? r1 : 1048576
    if (!ref.includes(':')) {
      total += 1
      continue
    }
    total += (Math.abs(c2 - c1) + 1) * (Math.abs(r2 - r1) + 1)
  }
  return total
}

export function inspectXlsxPackage(bytes: Uint8Array): PackageCheck {
  let declared = 0
  let macro = false
  let entries = 0
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter(file) {
        entries++
        declared += file.originalSize
        if (/vbaProject\.bin$/i.test(file.name)) macro = true
        if (declared > LIMITS.maxUncompressedBytes) return false
        return file.name === '[Content_Types].xml' || file.name === 'xl/workbook.xml' || /^xl\/worksheets\/[^/]+\.xml$/i.test(file.name)
      },
    })
  } catch {
    return { ok: false, message: msg('File không phải .xlsx hợp lệ (không đọc được nội dung nén).', 'Not a valid .xlsx file (the package cannot be read).') }
  }
  if (declared > LIMITS.maxUncompressedBytes || entries > 2000) {
    return { ok: false, message: msg('File giải nén quá lớn (nghi zip bomb).', 'The uncompressed package is too large (possible zip bomb).') }
  }
  const types = files['[Content_Types].xml'] ? strFromU8(files['[Content_Types].xml']) : ''
  if (macro || /macroEnabled/i.test(types)) {
    return { ok: false, message: msg('File có macro (.xlsm) không được chấp nhận; hãy lưu lại dạng .xlsx.', 'Macro-enabled files (.xlsm) are not accepted; save as .xlsx.') }
  }
  if (!types.includes('spreadsheetml.sheet.main+xml') || !files['xl/workbook.xml']) {
    return { ok: false, message: msg('File không phải workbook Excel .xlsx.', 'The file is not an Excel .xlsx workbook.') }
  }
  const workbookXml = strFromU8(files['xl/workbook.xml'])
  for (const m of workbookXml.matchAll(/<definedName\b[^>]*>([^<]*)<\/definedName>/g)) {
    if (rangeCells(m[1]) > LIMITS.maxDefinedNameCells) {
      return { ok: false, message: msg('Có defined name trỏ tới vùng quá lớn.', 'A defined name covers too many cells.') }
    }
  }
  for (const [name, data] of Object.entries(files)) {
    if (!name.startsWith('xl/worksheets/')) continue
    const xml = strFromU8(data)
    let rows = 0
    let from = 0
    for (;;) {
      const at = xml.indexOf('<row', from)
      if (at < 0) break
      const after = xml[at + 4]
      if (after === ' ' || after === '>' || after === '/') rows++
      from = at + 4
    }
    if (rows > LIMITS.maxRowsPerSheet * 4) {
      return { ok: false, message: msg(`Sheet ${name} có quá nhiều dòng.`, `Sheet ${name} has too many rows.`) }
    }
  }
  return { ok: true }
}
