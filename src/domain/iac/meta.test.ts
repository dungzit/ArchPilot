/**
 * Structural guards for src/domain/iac:
 * - purity (REQ-ADP-003, NFR2-DET-001): no clock, randomness, locale, Web
 *   Crypto or browser I/O in production modules; the one allowed Date is the
 *   zip's local-time constant;
 * - every code-bearing catalogue role has a realisation row per shipped/spike
 *   target, so coverage never says "no realisation" for a known role;
 * - the CI job pins the same Terraform versions as versions.ts and runs the
 *   validation script; the static lock files match the provider pins.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { catalog } from '../graph/catalog'
import { AWS_CATALOGUE, rolesWithoutRow } from './adapters/aws/catalogue'
import { VSPHERE_CATALOGUE } from './adapters/vsphere/catalogue'
import { IAC_DIR } from './testing/goldens'
import { AWS_PROVIDER, TERRAFORM_FLOOR_VERSION, TERRAFORM_VERSION, VSPHERE_PROVIDER } from './versions'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name.startsWith('__') || name === 'testing' ? [] : sources(full)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [full] : []
  })
}

const FORBIDDEN: [RegExp, string][] = [
  [/\bnew Date\b|\bDate\.(now|parse|UTC)\b/, 'clock'],
  [/\bMath\.random\b/, 'randomness'],
  [/\bperformance\.now\b/, 'clock'],
  [/\btoLocale\w*\(|\blocaleCompare\(|\bIntl\./, 'locale'],
  [/\bcrypto\.(subtle|getRandomValues|randomUUID)\b/, 'Web Crypto'],
  [/\b(window|localStorage|sessionStorage|globalThis)\s*\.|\bprocess\.(env|argv|cwd|platform)\b|\bfetch\s*\(|from 'node:/, 'I/O or environment'],
]

describe('src/domain/iac purity', () => {
  const files = sources(IAC_DIR)
  it('scans the production modules', () => {
    expect(files.length).toBeGreaterThan(20)
  })
  it.each(files.map((file) => [relative(IAC_DIR, file).split('\\').join('/'), file]))('%s reads no clock, randomness, locale, crypto or environment', (name, file) => {
    let code = readFileSync(file, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    if (name === 'core/zip.ts') code = code.replace('new Date(2000, 0, 1, 0, 0, 0)', '')
    for (const [pattern, what] of FORBIDDEN) expect(pattern.test(code), `${name} uses ${what}`).toBe(false)
  })
})

describe('realisation catalogues are complete', () => {
  it('aws: every code-bearing role resolves to a row', () => {
    expect(rolesWithoutRow()).toEqual([])
  })
  it('vsphere spike: every code-bearing role resolves to a row', () => {
    const missing = catalog.roles.filter((role) => role.codeBearing && !VSPHERE_CATALOGUE.realisations.some((row) => row.role === role.id)).map((role) => role.id)
    expect(missing).toEqual([])
  })
  it('realisation ids are unique per catalogue', () => {
    for (const cat of [AWS_CATALOGUE, VSPHERE_CATALOGUE]) {
      const ids = cat.realisations.map((row) => row.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('versions, lock files and CI agree', () => {
  const repo = resolve(IAC_DIR, '../../..')
  const ci = readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf-8')

  it('the iac-validate matrix pins the floor and current Terraform from versions.ts', () => {
    expect(ci).toContain('iac-validate:')
    expect(ci).toContain(`terraform: '${TERRAFORM_FLOOR_VERSION}'`)
    expect(ci).toContain(`terraform: '${TERRAFORM_VERSION}'`)
    expect(ci).toContain('node scripts/iac-validate.mjs terraform')
    expect(ci).toMatch(/sha256sum -c/)
    expect(ci).not.toMatch(/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|terraform (apply|destroy|plan)\b/)
  })

  it.each([['aws', AWS_PROVIDER], ['vsphere', VSPHERE_PROVIDER]] as const)('%s lock file records the pinned provider version and all three platforms', (dir, pin) => {
    const lock = readFileSync(join(IAC_DIR, 'adapters', dir, 'terraform.lock.hcl'), 'utf-8')
    expect(lock).toContain(`provider "registry.terraform.io/${pin.source}" {`)
    expect(lock).toContain(`version     = "${pin.locked}"`)
    expect(lock).toContain(`constraints = "${pin.constraint}"`)
    expect((lock.match(/"zh:/g) ?? []).length).toBeGreaterThan(2)
  })
})
