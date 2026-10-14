#!/usr/bin/env node
/**
 * iac-validate: run every golden package through real Terraform
 * (design-v2 4.4.13 "Terraform" row; NFR2-COR-001, REQ-IAC-024, AC-03).
 *
 * Reads src/domain/iac/__golden__/index.json (written by golden.test.ts),
 * copies each golden folder to a scratch directory (goldens stay clean), and
 * runs the adapter's declared validation commands with the given binary:
 *   terraform fmt -check -recursive -diff
 *   terraform init -backend=false -input=false
 *   terraform validate -json   -> must be valid with 0 errors and 0 warnings
 * Then a negative control: a copy with one mis-aligned `=` must FAIL
 * `fmt -check`, proving the gate can fail at all.
 *
 * Offline by construction: point TF_CLI_CONFIG_FILE at a CLI config whose only
 * provider_installation method is a filesystem_mirror (see ci.yml).
 * No cloud credentials are needed or read. Never runs plan/apply/destroy.
 *
 * Usage: node scripts/iac-validate.mjs [path/to/terraform]
 *   env IAC_WORK_DIR (default build/iac), IAC_ONLY=<fixture> to run one.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '..')
const requested = process.argv[2] ?? process.env.TERRAFORM ?? 'terraform'
// A path (not a bare command name) must survive the per-folder cwd change.
const terraform = /[\\/]/.test(requested) ? resolve(requested) : requested
const goldenRoot = join(repo, 'src', 'domain', 'iac', '__golden__')
const work = resolve(repo, process.env.IAC_WORK_DIR ?? join('build', 'iac'))
const index = JSON.parse(readFileSync(join(goldenRoot, 'index.json'), 'utf-8'))

const FORBIDDEN = new Set(['apply', 'destroy', 'plan', 'import', 'state', 'console'])

function run(args, cwd) {
  if (FORBIDDEN.has(args[0])) throw new Error(`refusing to run terraform ${args[0]}`)
  const result = spawnSync(terraform, args, { cwd, encoding: 'utf-8', env: { ...process.env, TF_IN_AUTOMATION: '1', TF_INPUT: '0', CHECKPOINT_DISABLE: '1' } })
  if (result.error) throw result.error
  return result
}

const version = run(['version', '-json'], repo)
console.log(`terraform: ${JSON.parse(version.stdout).terraform_version}`)

rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
let failures = 0
const goldens = index.goldens.filter((g) => !process.env.IAC_ONLY || g.fixture === process.env.IAC_ONLY)
for (const golden of goldens) {
  const dir = join(work, golden.dir.replace(/\//g, '__'))
  cpSync(join(goldenRoot, golden.dir), dir, { recursive: true })
  const verdicts = []
  for (const command of golden.validationCommands) {
    if (command[0] !== 'terraform') throw new Error(`${golden.dir}: only terraform commands are supported here, got ${command[0]}`)
    const args = command.slice(1)
    const result = run(args, dir)
    let ok = result.status === 0
    if (args[0] === 'validate' && args.includes('-json')) {
      try {
        const report = JSON.parse(result.stdout)
        ok = ok && report.valid === true && report.error_count === 0 && report.warning_count === 0
        if (!ok) console.log(JSON.stringify(report.diagnostics, null, 2))
      } catch {
        ok = false
      }
    }
    if (!ok) {
      failures += 1
      console.log(`--- ${golden.dir}: terraform ${args.join(' ')} FAILED (exit ${result.status})`)
      console.log(result.stdout.slice(0, 4000))
      console.log(result.stderr.slice(0, 4000))
    }
    verdicts.push(`${args[0]}=${ok ? 'ok' : 'FAIL'}`)
  }
  console.log(`${golden.dir} [${golden.adapter} ${golden.version}]: ${verdicts.join(' ')}`)
}

// Negative control: a broken copy must fail fmt -check.
if (goldens.length > 0) {
  const broken = join(work, '__negative_control__')
  cpSync(join(goldenRoot, goldens[0].dir), broken, { recursive: true })
  const main = join(broken, 'main.tf')
  const text = readFileSync(main, 'utf-8')
  const mutated = text.replace(/^(\s+\w+)( +)= /m, '$1$2  = ')
  if (mutated === text || !existsSync(main)) throw new Error('negative control: could not mis-align an attribute')
  writeFileSync(main, mutated)
  const result = run(['fmt', '-check', '-recursive'], broken)
  if (result.status === 0) {
    failures += 1
    console.log('negative control FAILED: fmt -check accepted a mis-aligned file')
  } else {
    console.log('negative control: fmt -check rejects a mis-aligned file (as it must)')
  }
}

console.log(failures === 0 ? `OK: ${goldens.length} golden folder(s) valid` : `FAILED: ${failures} check(s)`)
process.exit(failures === 0 ? 0 : 1)
