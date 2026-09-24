/**
 * Code names (REQ-DES-008) and Vietnamese-aware folding.
 *
 * A code name is set once from the label and never follows later label edits,
 * because it becomes a resource address in generated code (NFR2-DET-003).
 * Pattern: ^[a-z][a-z0-9_]{0,39}$ (contract `codeName`).
 *
 * Folding: NFC first (macOS can hand us NFD Vietnamese), then `đ`/`Đ` mapped
 * explicitly - they do not decompose under NFD, so a plain "strip combining
 * marks" turns "Đơn hàng" into "Đon_hang" (red-team review m4) - then NFD and
 * strip the combining marks. `toLowerCase()` is locale-independent; this
 * module never calls a locale-sensitive API, so the result is the same in
 * every browser, time zone and CI runner.
 */

export const CODE_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/
export const CODE_NAME_MAX_LENGTH = 40

const COMBINING_MARKS = /[̀-ͯ]/g

/** "Đơn hàng Ảnh" -> "Don hang Anh". Case is preserved. */
export function foldDiacritics(text: string): string {
  return text.normalize('NFC').replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFD').replace(COMBINING_MARKS, '')
}

/** Folded and lower-cased: the form both sides of a search comparison use. */
export function foldForSearch(text: string): string {
  return foldDiacritics(text).toLowerCase().replace(/\s+/g, ' ')
}

/** "Đơn hàng (Postgres)!" -> "don_hang_postgres". May be empty or start with a digit. */
export function slugify(label: string): string {
  return foldDiacritics(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function clip(base: string, max: number): string {
  return base.slice(0, max).replace(/_+$/, '')
}

export function isValidCodeName(value: string): boolean {
  return CODE_NAME_PATTERN.test(value)
}

/**
 * A valid code name for `label`. `fallback` (normally the role id, which is a
 * valid code name) replaces an empty slug and prefixes one that starts with a
 * digit: "3rd-party check" on external_service -> "external_service_3rd_party_check".
 */
export function toCodeName(label: string, fallback: string): string {
  if (!isValidCodeName(fallback)) throw new Error(`fallback code name ${JSON.stringify(fallback)} is not valid`)
  const slug = slugify(label)
  if (!slug) return fallback
  return clip(/^[a-z]/.test(slug) ? slug : `${fallback}_${slug}`, CODE_NAME_MAX_LENGTH)
}

/** `base`, or `base_2`, `base_3`, ... - the first one not in `taken`, still within 40 characters. */
export function uniqueCodeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`
    const candidate = clip(base, CODE_NAME_MAX_LENGTH - suffix.length) + suffix
    if (!taken.has(candidate)) return candidate
  }
}
