/**
 * Formatting helpers for the HLD export. Pure; the locale is always explicit
 * (vi-VN or en-US), never the machine's, so the same input gives the same text.
 */
import type { HldLanguage } from './types'

export function localeOf(language: HldLanguage): 'vi-VN' | 'en-US' {
  return language === 'vi' ? 'vi-VN' : 'en-US'
}

const formatters = new Map<string, Intl.NumberFormat>()

function formatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let cached = formatters.get(key)
  if (!cached) {
    cached = new Intl.NumberFormat(locale, options)
    formatters.set(key, cached)
  }
  return cached
}

/**
 * 1234567.891 -> "1.234.567,89" (vi) / "1,234,567.89" (en). Values below 1
 * keep three significant digits so 0.000123 does not collapse to "0".
 * Non-finite values print as an em dash.
 */
export function formatNumber(value: number, language: HldLanguage): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const locale = localeOf(language)
  const abs = Math.abs(value)
  if (abs !== 0 && abs < 1) return formatter(locale, { maximumSignificantDigits: 3 }).format(value)
  return formatter(locale, { maximumFractionDigits: 2 }).format(value)
}

/** A config/assumption value of any shape as display text. */
export function formatValue(value: unknown, language: HldLanguage): string {
  if (typeof value === 'number') return formatNumber(value, language)
  if (typeof value === 'boolean') return language === 'vi' ? (value ? 'có' : 'không') : value ? 'yes' : 'no'
  if (Array.isArray(value)) return value.map((item) => formatValue(item, language)).join(', ')
  if (value === null || value === undefined) return '—'
  return String(value)
}

/**
 * Characters that are illegal in XML 1.0 (C0 controls bar tab/newline/CR,
 * lone surrogates, U+FFFE/U+FFFF). A design label or a pasted note with one of
 * them would otherwise produce a .docx Word refuses to open.
 */
// eslint-disable-next-line no-control-regex
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function cleanText(text: unknown): string {
  if (text === null || text === undefined) return ''
  return String(text).replace(XML_ILLEGAL, '')
}

/** Trimmed, cleaned, with a fallback for blank values. */
export function orDash(text: string | null | undefined): string {
  const value = cleanText(text ?? '').trim()
  return value.length > 0 ? value : '—'
}

/** Only absolute http(s) URLs become hyperlinks (no javascript:, file:, data: ...). */
export function safeUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null
  const trimmed = url.trim()
  // No whitespace, C0/C1 controls, lone surrogates or U+FFFE/U+FFFF: the URL is written raw into the .rels XML.
  if (!/^https?:\/\/[^\s]+$/i.test(trimmed) || cleanText(trimmed) !== trimmed || /[\u007F-\u009F]/.test(trimmed)) return null
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? trimmed : null
  } catch {
    return null
  }
}

/** Fold Vietnamese diacritics (đ -> d), keep [A-Za-z0-9._-], collapse the rest to "_". */
export function fileSafe(text: string, fallback: string): string {
  const folded = cleanText(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
  const safe = folded
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80)
  return safe.length > 0 ? safe : fallback
}

/** HLD_<project>_v<version>.docx, safe on Windows, macOS and Linux. */
export function hldFileName(projectName: string, version: string): string {
  const project = fileSafe(projectName, 'project')
  const bareVersion = cleanText(version).trim().replace(/^[vV](?=\d)/, '')
  return `HLD_${project}_v${fileSafe(bareVersion, '1.0')}.docx`
}

/** Manual text -> paragraphs and bullets. "- ", "* " and "• " start a bullet; blank lines separate. */
export function parseManualText(text: string): ({ kind: 'paragraph'; text: string } | { kind: 'bullets'; items: string[] })[] {
  const out: ({ kind: 'paragraph'; text: string } | { kind: 'bullets'; items: string[] })[] = []
  for (const raw of cleanText(text).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (line.trim().length === 0) continue
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    if (bullet) {
      const last = out[out.length - 1]
      if (last && last.kind === 'bullets') last.items.push(bullet[1].trim())
      else out.push({ kind: 'bullets', items: [bullet[1].trim()] })
    } else {
      out.push({ kind: 'paragraph', text: line.trim() })
    }
  }
  return out
}

/** Non-empty lines without a leading bullet marker or "1." numbering. */
export function manualLines(text: string): string[] {
  return cleanText(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/^([-*•]|\d+[.)])\s+/, '').trim())
    .filter((line) => line.length > 0)
}

/** The local calendar date as YYYY-MM-DD (for the meta form default; not used by the builder). */
export function todayIso(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
