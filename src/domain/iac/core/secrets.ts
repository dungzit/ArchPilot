/**
 * Secret detection (design-v2 4.4.6; REQ-IAC-015, NFR2-SEC-001).
 *
 * - IAC-E06: a secret-looking literal typed into a config field, binding
 *   field or target option (checked before generation).
 * - IAC-E12: a secret pattern anywhere in an emitted file (checked after
 *   generation, before any download). It names the file and the line.
 *
 * High-confidence patterns only, so a hit is worth blocking a download.
 */
import type { GeneratedFile, IacProblem } from './types'

export const SECRET_PATTERNS: { id: string; pattern: RegExp }[] = [
  { id: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'github-token', pattern: /\bghp_[A-Za-z0-9]{36}\b/ },
  { id: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{20}/ },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{8,}/ },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}/ },
  { id: 'secret-assignment', pattern: /(?:password|secret|token)\s*=\s*"[^"\n]{6,}"/i },
]

/** Pattern ids that fire on `text` (for IAC-E06 on a single value). */
export function secretHits(text: string): string[] {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ id }) => id)
}

const SECRET_KEY = /(password|passwd|secret|token|apikey|api_key|privatekey|private_key|credential)/i

/** True when a config key names a secret and carries a non-empty literal. */
export function isSecretField(key: string, value: unknown): boolean {
  return SECRET_KEY.test(key) && typeof value === 'string' && value.trim() !== ''
}

/** IAC-E12 over every emitted file. */
export function lintFiles(files: GeneratedFile[]): IacProblem[] {
  const out: IacProblem[] = []
  for (const file of files) {
    file.content.split('\n').forEach((line, index) => {
      for (const { id, pattern } of SECRET_PATTERNS) {
        if (!pattern.test(line)) continue
        out.push({
          severity: 'error', ruleId: 'IAC-E12', path: `${file.path}:${index + 1}`,
          message: {
            en: `${file.path} line ${index + 1} looks like a secret (${id}). The download is blocked.`,
            vi: `${file.path} dòng ${index + 1} có vẻ chứa bí mật (${id}). Tải xuống bị chặn.`,
          },
          fix: { en: 'Remove the secret from the design; supply it at run time instead.', vi: 'Xóa bí mật khỏi thiết kế; cung cấp khi chạy.' },
        })
      }
    })
  }
  return out
}
