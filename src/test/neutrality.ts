/**
 * Test-only NFR2-NEUT-001 scanner. Reads the maintained token list the Python
 * suite also reads (`contracts/catalog/neutrality-tokens.json`) and reports
 * every whole-word hit in keys and string values.
 */
import tokensJson from '../../contracts/catalog/neutrality-tokens.json'

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const TOKEN_RE = new RegExp(`(?<![a-z0-9])(${tokensJson.tokens.map((t) => escape(t.toLowerCase())).join('|')})(?![a-z0-9])`, 'g')

export const NEUTRALITY_TOKENS: readonly string[] = tokensJson.tokens

function matches(text: string): string[] {
  return [...text.toLowerCase().matchAll(TOKEN_RE)].map((match) => match[1])
}

/** `[path, token]` for every hit; paths in `skip` (e.g. `$.deployment`) are not descended into. */
export function neutralityHits(value: unknown, path = '$', skip: ReadonlySet<string> = new Set()): [string, string][] {
  const hits: [string, string][] = []
  if (Array.isArray(value)) {
    value.forEach((item, index) => hits.push(...neutralityHits(item, `${path}[${index}]`, skip)))
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const child = `${path}.${key}`
      if (skip.has(child)) continue
      hits.push(...matches(key).map((token): [string, string] => [child, token]))
      hits.push(...neutralityHits(item, child, skip))
    }
  } else if (typeof value === 'string') {
    hits.push(...matches(value).map((token): [string, string] => [path, token]))
  }
  return hits
}
