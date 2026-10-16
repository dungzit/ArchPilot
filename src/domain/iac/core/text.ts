/**
 * Deterministic text helpers shared by every adapter. Never `localeCompare`,
 * never `toLocale*` (design-v2 4.4.5: order is compared by code unit).
 */
import type { ConfigValue } from '../../graph/types'

export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function sortedStrings(values: Iterable<string>): string[] {
  return [...values].sort(byCodeUnit)
}

/** `orders_db` -> `orders-db` (resource names). */
export function kebab(codeName: string): string {
  return codeName.replace(/_/g, '-')
}

/** `orders_db` -> `ORDERS_DB` (environment variable prefixes). */
export function upperSnake(codeName: string): string {
  return codeName.toUpperCase()
}

/** `orders_db` -> `OrdersDb` (IAM statement sids). */
export function pascal(codeName: string): string {
  return codeName.split('_').filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('')
}

export function configText(value: ConfigValue): string {
  return Array.isArray(value) ? value.join(', ') : String(value)
}

/**
 * Markdown-safe inline text (design-v2 4.4.6): one line, no HTML, no table
 * breaks, no code spans, no leading heading or list markers.
 */
export function mdText(value: string, max = 200): string {
  let text = value
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029\uFEFF]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
  if (text.length > max) text = `${text.slice(0, max - 3).trimEnd()}...`
  text = text.replace(/[\\`*_[\]<>|#!{}]/g, (c) => `\\${c}`)
  // A leading '-', '+', '=' or 'N.' would start a list, a rule or a setext heading.
  return text.replace(/^([-+=]|\d+\.)/, '\\$1')
}

/** A value shown inside a code span: backticks cannot occur (code names, ids, numbers). */
export function mdCode(value: string): string {
  return `\`${value.replace(/`/g, "'").replace(/[\r\n|]/g, ' ')}\``
}
