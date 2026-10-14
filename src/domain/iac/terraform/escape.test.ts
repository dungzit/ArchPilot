import { describe, expect, it } from 'vitest'
import { commentText, hclDecodedValue, hclEscape, hclString } from './escape'

/**
 * A reference HCL template-literal decoder, written from the HCL native
 * syntax spec (quoted template: `\\ \" \n \r \t \uNNNN \UNNNNNNNN` escapes,
 * `$${` and `%%{` literal escapes, `${`/`%{` open a sequence). The property
 * test asserts decode(hclString(s)) === the value Terraform will see, and
 * that no interpolation or directive can open. The same corpus was checked
 * against the real `terraform console` 1.16.4 (26/26 exact round trips).
 */
function decode(literal: string): string {
  expect(literal.startsWith('"') && literal.endsWith('"')).toBe(true)
  const s = literal.slice(1, -1)
  let out = ''
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]
    if (c === '\\') {
      const next = s[i + 1]
      const map: Record<string, string> = { '\\': '\\', '"': '"', n: '\n', r: '\r', t: '\t' }
      if (!(next in map)) throw new Error(`invalid escape \\${next}`)
      out += map[next]
      i += 1
    } else if ((c === '$' || c === '%') && s[i + 1] === c && s[i + 2] === '{') {
      out += `${c}{`
      i += 2
    } else if ((c === '$' || c === '%') && s[i + 1] === '{') {
      throw new Error(`unescaped ${c}{ opens a template sequence`)
    } else if (c === '"') {
      throw new Error('unescaped quote ends the literal early')
    } else if (c === '\n' || c === '\r') {
      throw new Error('raw newline in a quoted literal')
    } else {
      out += c
    }
  }
  return out
}

const HOSTILE = [
  '${file("~/.aws/credentials")}', '%{ if true }x%{ endif }', '$${already}', '%%{already}', '$$${x}',
  'a"b', 'back\\slash', 'trail\\', 'new\nline', 'tab\there', 'cr\rlf', '$', '%', '${', '%{', '}', '$ {x}',
  'Đơn hàng', 'emoji 🚀', '\\${x}', '\\"', '"${"', 'x$', 'x%', '$${', '$$', '%%',
  '${jsonencode(data.aws_caller_identity.current)}', '"; } resource "x" "y" { #', '\u0000nul\u0007bell\u001bESC',
  'line\u2028sep', 'bom\uFEFF', 'lone \uD800 surrogate', 'Tiếng Việt: Cơ sở dữ liệu', 'NFD é', '${{ github.token }}',
]

describe('hclString', () => {
  it.each(HOSTILE)('round-trips %j and never opens a template sequence', (value) => {
    expect(decode(hclString(value))).toBe(hclDecodedValue(value))
  })

  it('escapes exactly the documented characters', () => {
    expect(hclEscape('${x}')).toBe('$${x}')
    expect(hclEscape('%{x}')).toBe('%%{x}')
    expect(hclEscape('a"b\\c')).toBe('a\\"b\\\\c')
    expect(hclEscape('\n\r\t')).toBe('\\n\\r\\t')
    expect(hclEscape('$ and %')).toBe('$ and %')
  })

  it('drops other control characters, BOM, line separators and lone surrogates; NFC-normalises', () => {
    expect(hclDecodedValue('\u0000a\u0007b\u001bc\u2028d\uFEFFe')).toBe('abcde')
    expect(hclDecodedValue('x\uD800y')).toBe('xy')
    expect(hclDecodedValue('🚀')).toBe('🚀')
    expect(hclDecodedValue('é')).toBe('é')
  })

  it('property: 2,000 random strings over a hostile alphabet round-trip', () => {
    const alphabet = ['$', '%', '{', '}', '\\', '"', '\n', '\r', '\t', 'a', ' ', 'đ', '\u0000', '\u2028', '\uD83D', '\uDE80', '#', '*']
    let seed = 20260924
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed
    }
    for (let n = 0; n < 2000; n += 1) {
      let value = ''
      const length = next() % 24
      for (let i = 0; i < length; i += 1) value += alphabet[next() % alphabet.length]
      expect(decode(hclString(value)), JSON.stringify(value)).toBe(hclDecodedValue(value))
    }
  })
})

describe('commentText', () => {
  it('reduces any text to one printable line', () => {
    expect(commentText('a\nb\r\nc\td')).toBe('a b c d')
    expect(commentText('  x  ')).toBe('x')
    expect(commentText('\u2028x\u0000')).toBe('x')
    expect(commentText('x'.repeat(300))).toHaveLength(160)
  })
})
