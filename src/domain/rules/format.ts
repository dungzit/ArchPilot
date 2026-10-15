/**
 * Number formatting for rule traces and result cards (pilot WP-A). Pure.
 *
 * Two styles, on purpose:
 * - `formatPlain` goes inside formulas (`max(8, 14, 3)`), so it never groups
 *   thousands: a comma there would read as an argument separator.
 * - `formatDisplay` is for the big result numbers, grouped `50,000,000`.
 * Both keep 6 significant digits, which hides float noise
 * (`7.500000000000001` prints as `7.5`) without hiding anything a sizing
 * decision depends on.
 */
import { isSilentUnit } from './units'

const SIGNIFICANT = 6

export function formatPlain(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e15 || abs < 1e-6) return value.toExponential(3).replace(/\.?0+e/, 'e')
  return String(Number(value.toPrecision(SIGNIFICANT)))
}

const DISPLAY = new Intl.NumberFormat('en-US', { maximumSignificantDigits: SIGNIFICANT })
const DISPLAY_INTEGER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export function formatDisplay(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e15 || abs < 1e-6) return formatPlain(value)
  // Integers up to 15 digits print exactly; the 6-digit cap is for fractions.
  if (Number.isInteger(value)) return DISPLAY_INTEGER.format(value)
  return DISPLAY.format(value)
}

/** `150 MB/s`, `70%`, `3` (silent units such as count/ratio print bare). */
export function withUnit(text: string, unit: string): string {
  const trimmed = unit.trim()
  if (isSilentUnit(trimmed)) return text
  if (trimmed === '%') return `${text}%`
  return `${text} ${trimmed}`
}
