/**
 * Cross-language canonical-JSON vectors and input hygiene (review-v2-phase0).
 *
 * `contracts/differential/jcs.vectors.json` is produced by an independent
 * Python RFC 8785 + NFC reference (`backend/tests/jcs_reference.py`) and
 * checked by `backend/tests/test_jcs_vectors.py`. canonicalJson() and
 * contentHash() must reproduce it byte for byte.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CanonicalJsonError, canonicalJson, contentHash } from './hash'

const vectorsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../contracts/differential/jcs.vectors.json')
const vectors = JSON.parse(readFileSync(vectorsPath, 'utf-8')) as { valuesJson: string; expected: { canonical: string; sha256: string }[] }
const values = JSON.parse(vectors.valuesJson) as unknown[]

describe('canonicalJson agrees with the independent Python reference', () => {
  it('has one expectation per value', () => {
    expect(values.length).toBe(vectors.expected.length)
    expect(values.length).toBeGreaterThan(100)
  })

  it.each(values.map((value, index) => [index, value] as const))('vector %i', (index, value) => {
    expect(canonicalJson(value)).toBe(vectors.expected[index].canonical)
    expect(contentHash(value)).toBe(vectors.expected[index].sha256)
  })
})

describe('canonicalJson refuses what has no canonical form', () => {
  it('writes array holes as null, like JSON.stringify (was the invalid "[,1]")', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(canonicalJson([, 1])).toBe('[null,1]')
    expect(canonicalJson(new Array(2))).toBe('[null,null]')
  })

  it.each([
    ['a Date', new Date(0)],
    ['a Map', new Map([['a', 1]])],
    ['a Set', new Set([1])],
    ['a class instance', new (class Point { x = 1 })()],
  ])('refuses %s instead of hashing it as {}', (_label, value) => {
    expect(() => canonicalJson({ value })).toThrow(CanonicalJsonError)
  })

  it('still accepts null-prototype objects', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { b: 1, a: 2 })
    expect(canonicalJson(bare)).toBe('{"a":2,"b":1}')
  })

  it.each([
    ['a lone high surrogate in a value', { s: 'a\uD800b' }],
    ['a lone low surrogate in a value', { s: '\uDC00' }],
    ['a lone surrogate in a key', { ['k\uDBFF']: 1 }],
  ])('refuses %s (RFC 8785 needs I-JSON)', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(/unpaired UTF-16 surrogate/)
  })

  it('accepts a proper surrogate pair', () => {
    expect(canonicalJson({ s: String.fromCharCode(0xd83d, 0xde00) })).toBe(`{"s":"${String.fromCodePoint(0x1f600)}"}`)
  })
})
