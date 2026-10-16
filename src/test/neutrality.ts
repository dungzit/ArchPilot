/**
 * Test-only NFR2-NEUT-001 scanner. Reads the maintained token list the Python
 * suite also reads (`contracts/catalog/neutrality-tokens.json`) and reports
 * every whole-word hit in keys and string values.
 */
import tokensJson from '../../contracts/catalog/neutrality-tokens.json'

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const TOKEN_RE = new RegExp(`(?<![a-z0-9])(${tokensJson.tokens.map((t) => escape(t.toLowerCase())).join('|')})(?![a-z0-9])`, 'g')

export const NEUTRALITY_TOKENS: readonly string[] = tokensJson.tokens

const SINGLE_WORD_TOKENS = new Set(tokensJson.tokens.map((t) => t.toLowerCase()).filter((t) => /^[a-z0-9]+$/.test(t)))
const CAMEL_BOUNDARY = /(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/

/** Single-word tokens hidden in camelCase: every contiguous run of camel parts, joined and lower-cased. */
function camelCaseHits(text: string): string[] {
  const out: string[] = []
  for (const run of text.match(/[A-Za-z0-9]+/g) ?? []) {
    const parts = run.split(CAMEL_BOUNDARY)
    if (parts.length < 2) continue
    for (let start = 0; start < parts.length; start += 1) {
      let word = ''
      for (let end = start; end < parts.length; end += 1) {
        word += parts[end].toLowerCase()
        if (SINGLE_WORD_TOKENS.has(word)) out.push(word)
      }
    }
  }
  return out
}

/**
 * Whole-word hits in `text`, plus tokens glued into camelCase (review-v2-phase0):
 * config keys are camelCase by contract, and lower-casing `awsRegion`,
 * `s3Bucket` or `vSphereCluster` first glues the token to its neighbour, so the
 * plain scan never saw them. `awesomeRegion` and `cardsDeck` stay clean.
 */
function matches(text: string): string[] {
  const plain = [...text.toLowerCase().matchAll(TOKEN_RE)].map((match) => match[1])
  return [...plain, ...camelCaseHits(text).filter((token) => !plain.includes(token))]
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
