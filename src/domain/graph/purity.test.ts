/**
 * Structural guard for determinism (NFR2-DET-001; coordinator instruction:
 * "keep the graph core timezone-independent"). The graph core must not read
 * the clock, randomness, the locale or Web Crypto. Rather than trust review
 * alone, scan the production sources for the APIs that would break that.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const sources = readdirSync(here).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))

const FORBIDDEN: [RegExp, string][] = [
  [/\bnew Date\b|\bDate\.(now|parse|UTC)\b/, 'clock'],
  [/\bMath\.random\b/, 'randomness'],
  [/\bperformance\.now\b/, 'clock'],
  [/\btoLocale\w*\(|\blocaleCompare\(|\bIntl\./, 'locale'],
  [/\bcrypto\.(subtle|getRandomValues|randomUUID)\b/, 'Web Crypto (absent on plain-HTTP pages; random)'],
  // `document` is the graph core's own parameter name, so the DOM is caught via globalThis/window only.
  [/\b(window|localStorage|sessionStorage|globalThis)\s*\.|\bfetch\s*\(/, 'browser I/O'],
]

describe('graph core purity', () => {
  it('scans every production module', () => {
    expect(sources.sort()).toEqual(['catalog.ts', 'codeName.ts', 'commands.ts', 'containment.ts', 'hash.ts', 'index.ts', 'migrate.ts', 'types.ts', 'validate.ts'])
  })

  it.each(sources)('%s reads no clock, randomness, locale, Web Crypto or browser I/O', (name) => {
    const code = readFileSync(join(here, name), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    for (const [pattern, what] of FORBIDDEN) expect(pattern.test(code), `${name} uses ${what}`).toBe(false)
  })
})
