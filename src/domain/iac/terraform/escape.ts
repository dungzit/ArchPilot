/**
 * Injection-safe text for generated HCL and comments (design-v2 4.4.6,
 * red-team review M10; REQ-IAC-015).
 *
 * Every user-influenced string that reaches a `.tf` file goes through
 * `hclString()` (quoted string literal) or `commentText()` (a `#` line).
 * Identifiers never do: they come only from validated code names.
 *
 * The escape set was checked against the real `terraform console` (1.16.4):
 * a 26-string hostile corpus (`${file("~/.aws/credentials")}`, `%{ if }`,
 * `$${`, `$$${`, trailing backslash, quotes, newlines, Vietnamese, emoji)
 * decodes back to the exact input. `escape.test.ts` keeps the same corpus
 * plus a property test.
 */

// Controls other than \t \n \r (escaped), C1 controls, lone surrogates, BOM, and
// the Unicode line/paragraph separators some editors treat as newlines.
const DROP = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029\uFEFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** The body of an HCL quoted template literal (no surrounding quotes). */
export function hclEscape(value: string): string {
  const text = value.normalize('NFC').replace(DROP, '')
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (c === '\\') out += '\\\\'
    else if (c === '"') out += '\\"'
    else if (c === '\n') out += '\\n'
    else if (c === '\r') out += '\\r'
    else if (c === '\t') out += '\\t'
    else if ((c === '$' || c === '%') && text[i + 1] === '{') {
      // `${` -> `$${` and `%{` -> `%%{`: HCL's literal escapes, so no interpolation or directive can start.
      out += `${c}${c}{`
      i += 1
    } else out += c
  }
  return out
}

/** A complete, quoted HCL string literal that decodes to `value` (NFC, controls dropped). */
export function hclString(value: string): string {
  return `"${hclEscape(value)}"`
}

/** What `hclString(value)` decodes to in Terraform. */
export function hclDecodedValue(value: string): string {
  return value.normalize('NFC').replace(DROP, '')
}

/**
 * One printable comment line: NFC, every control character and line break
 * becomes a space, runs of spaces collapse, trimmed, at most `max` characters.
 */
export function commentText(value: string, max = 160): string {
  const flat = value
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029\uFEFF]/g, ' ')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 3).trimEnd()}...`
}
