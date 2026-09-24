import { describe, expect, it, vi } from 'vitest'
import { CanonicalJsonError, HASH_VERSION, canonicalJson, contentHash, sha256Hex } from './hash'

describe('sha256Hex (pure JS, review M6)', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ])('NIST vector %j', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected)
  })

  it('hashes UTF-8 bytes, so Vietnamese text is stable', () => {
    expect(sha256Hex('Đơn hàng')).toBe(sha256Hex('Đơn hàng'))
    expect(sha256Hex('Đơn hàng')).toHaveLength(64)
  })

  it('does not depend on Web Crypto (plain-HTTP intranet pages have no crypto.subtle)', () => {
    vi.stubGlobal('crypto', undefined)
    try {
      expect(globalThis.crypto).toBeUndefined()
      expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('canonicalJson (RFC 8785 + NFC)', () => {
  it('sorts keys at every depth and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}')
  })

  it('sorts keys by UTF-16 code units, not by locale', () => {
    expect(canonicalJson({ b: 1, B: 2, á: 3, a: 4, '€': 5, '😀': 6 })).toBe('{"B":2,"a":4,"b":1,"á":3,"€":5,"😀":6}')
  })

  it('writes numbers in ECMAScript shortest form (JCS)', () => {
    expect(canonicalJson([1.0, -0, 1e21, 0.1 + 0.2, 1e-7, 100])).toBe('[1,0,1e+21,0.30000000000000004,1e-7,100]')
  })

  it('NFC-normalises strings and keys, so NFD Vietnamese hashes like NFC', () => {
    const nfc = { 'tên': 'Đơn hàng' }
    const nfd = { ['tên'.normalize('NFD')]: 'Đơn hàng'.normalize('NFD') }
    expect(canonicalJson(nfd)).toBe(canonicalJson(nfc))
    expect(contentHash(nfd)).toBe(contentHash(nfc))
  })

  it('ignores key insertion order but not array order', () => {
    expect(contentHash({ a: 1, b: [1, 2] })).toBe(contentHash({ b: [1, 2], a: 1 }))
    expect(contentHash({ a: [1, 2] })).not.toBe(contentHash({ a: [2, 1] }))
  })

  it('drops undefined object members like JSON.stringify and writes undefined array items as null', () => {
    expect(canonicalJson({ a: undefined, b: [undefined] })).toBe('{"b":[null]}')
  })

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [() => 1], [BigInt(1)]])('refuses %s', (value) => {
    expect(() => canonicalJson({ value })).toThrow(CanonicalJsonError)
  })

  it('refuses two keys that collide after normalisation', () => {
    expect(() => canonicalJson({ ['é']: 1, ['é'.normalize('NFD')]: 2 })).toThrow(/normalise to/)
  })

  it('has a version that derivation records carry', () => {
    expect(HASH_VERSION).toBe(1)
  })

  it('pins one golden hash, computed independently with Python hashlib, so a change to the canonical form fails loudly', () => {
    const value = { note: 'Đơn hàng'.normalize('NFD'), answers: { readWriteRatio: 9, peakRps: 1500 } }
    expect(canonicalJson(value)).toBe('{"answers":{"peakRps":1500,"readWriteRatio":9},"note":"Đơn hàng"}')
    // python -c "hashlib.sha256('{...Đơn hàng...}'.encode('utf-8')).hexdigest()"
    expect(contentHash(value)).toBe('8c560a7dcab207e71a6dc43ceab8bea95224c5f30e3a77c7838e02a0d0ebfb42')
  })
})
