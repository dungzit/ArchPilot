/**
 * Content hashing for derivations and fingerprints (design-v2 4.3.10, as
 * tightened by red-team review M6).
 *
 * - Canonical JSON is RFC 8785 (JCS): object keys sorted by UTF-16 code units,
 *   numbers in ECMAScript shortest form, no whitespace. Strings (keys and
 *   values) are NFC-normalised first, so Vietnamese typed on macOS (often NFD)
 *   and on Windows (NFC) hash the same.
 * - SHA-256 comes from @noble/hashes: pure JavaScript, synchronous, identical
 *   bytes in every browser and in Node. Web Crypto is NOT used - `crypto.subtle`
 *   exists only in secure contexts, so over plain-HTTP intranet access it is
 *   undefined and outdated-propagation would silently stop.
 * - No clock, no locale, no environment input: the same value hashes the same
 *   everywhere, in every time zone.
 *
 * `HASH_VERSION` goes into every derivation record; changing the canonical
 * form or a projection is a version bump, never a silent change.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export const HASH_VERSION = 1

export class CanonicalJsonError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalJsonError'
  }
}

/** RFC 8785 canonical JSON of a JSON-compatible value, strings NFC-normalised. */
export function canonicalJson(value: unknown): string {
  return serialise(value, '$')
}

function serialise(value: unknown, path: string): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalJsonError(`${path}: ${value} has no JSON form`)
      return JSON.stringify(value) // ECMAScript Number::toString = the JCS number form; -0 -> "0"
    case 'string':
      return JSON.stringify(value.normalize('NFC'))
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item, index) => (item === undefined ? 'null' : serialise(item, `${path}[${index}]`))).join(',')}]`
      }
      const entries: [string, unknown][] = []
      const seen = new Set<string>()
      for (const [rawKey, item] of Object.entries(value as Record<string, unknown>)) {
        if (item === undefined) continue // JSON.stringify drops these too
        const key = rawKey.normalize('NFC')
        if (seen.has(key)) throw new CanonicalJsonError(`${path}: two keys normalise to ${JSON.stringify(key)}`)
        seen.add(key)
        entries.push([key, item])
      }
      // Default sort compares UTF-16 code units, which is exactly what JCS requires.
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${serialise(item, `${path}.${key}`)}`).join(',')}}`
    }
    default:
      throw new CanonicalJsonError(`${path}: a ${typeof value} has no JSON form`)
  }
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)))
}

/** sha256 hex of the canonical JSON of `value`. */
export function contentHash(value: unknown): string {
  return sha256Hex(canonicalJson(value))
}
