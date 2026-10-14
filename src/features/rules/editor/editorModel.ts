/**
 * Pure helpers for the rule editor (WP-A2, docs/v3/05 §6): blank models,
 * "Paste JSON" parsing with structural validation, key=value test fields,
 * and mapping engine compile errors (`where`) to editor rows.
 */
import type { RulePack, RuleStatus, SizingModelDef } from '../../../contracts/pilot'
import type { RuleError } from '../../../domain/rules/engine'

export interface EditablePack {
  /** Set when editing a stored, user-owned pack (save = update). */
  id?: string
  builtIn: boolean
  name: string
  description: string
  version: number
  status: RuleStatus
  models: SizingModelDef[]
}

export type PackDraft = Omit<RulePack, 'id' | 'builtIn' | 'createdAt' | 'updatedAt'>

export function blankModel(id = 'model_1'): SizingModelDef {
  return {
    id,
    nameVi: 'Model mới',
    nameEn: 'New model',
    componentType: 'generic',
    formulaMode: 'excel',
    inputs: [{ name: 'x', labelVi: 'x', labelEn: 'x', unit: 'count', default: 1 }],
    params: [],
    calc: [{ name: 'y', formula: 'x * 2', unit: 'count' }],
    outputs: [{ name: 'y', from: 'y', unit: 'count', rounding: 'none' }],
    warnings: [],
    lookups: [],
    tests: [{ id: 'T1', inputs: { x: 1 }, expected: { y: 2 }, tolerance: 0.000001 }],
  }
}

export function blankPack(): EditablePack {
  return { builtIn: false, name: 'Rule pack mới / New rule pack', description: '', version: 1, status: 'draft', models: [blankModel()] }
}

export function editableFrom(pack: RulePack): EditablePack {
  return {
    id: pack.builtIn ? undefined : pack.id,
    builtIn: pack.builtIn,
    name: pack.builtIn ? `${pack.name} (copy)` : pack.name,
    description: pack.description ?? '',
    version: pack.builtIn ? 1 : pack.version,
    status: pack.status,
    models: structuredClone(pack.models),
  }
}

export function toDraft(pack: EditablePack, status: RuleStatus): PackDraft {
  return { name: pack.name.trim(), description: pack.description.trim() || null, version: pack.version, status, models: pack.models }
}

/** A model id not used yet in the pack. */
export function nextModelId(models: SizingModelDef[]): string {
  for (let i = models.length + 1; ; i++) {
    const id = `model_${i}`
    if (!models.some((m) => m.id === id)) return id
  }
}

// ---------------------------------------------------------------------------
// key=value fields of tests
// ---------------------------------------------------------------------------

export function formatKv(record: Record<string, number>): string {
  return Object.entries(record).map(([k, v]) => `${k}=${v}`).join(', ')
}

/** "a=1, b=2.5" -> {a:1, b:2.5}; returns an error string for bad input. */
export function parseKv(text: string): Record<string, number> | string {
  const out: Record<string, number> = {}
  const parts = text.split(/[,;\n]/).map((p) => p.trim()).filter((p) => p !== '')
  for (const part of parts) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?)$/.exec(part)
    if (!m) return `"${part}"`
    out[m[1]] = Number(m[2])
  }
  return out
}

// ---------------------------------------------------------------------------
// Paste JSON
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function checkModel(raw: unknown, path: string): string | null {
  if (!isObj(raw)) return `${path}: not an object`
  for (const key of ['id', 'nameVi', 'nameEn', 'componentType'] as const) if (!isStr(raw[key])) return `${path}.${key}: string expected`
  if (raw.formulaMode !== undefined && raw.formulaMode !== 'units' && raw.formulaMode !== 'excel') return `${path}.formulaMode: "units" or "excel" expected`
  for (const key of ['inputs', 'params', 'calc', 'outputs', 'warnings', 'lookups', 'tests'] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) return `${path}.${key}: array expected`
  }
  const arr = (key: string) => (raw[key] as unknown[] | undefined) ?? []
  for (const [i, x] of arr('inputs').entries()) {
    if (!isObj(x) || !isStr(x.name) || !isNum(x.default) || !isStr(x.unit)) return `${path}.inputs[${i}]: name, unit and numeric default expected`
  }
  for (const [i, x] of arr('params').entries()) {
    if (!isObj(x) || !isStr(x.name) || !isNum(x.value) || !isStr(x.unit)) return `${path}.params[${i}]: name, unit and numeric value expected`
  }
  for (const [i, x] of arr('calc').entries()) {
    if (!isObj(x) || !isStr(x.name) || !isStr(x.formula) || !isStr(x.unit)) return `${path}.calc[${i}]: name, formula and unit expected`
  }
  for (const [i, x] of arr('outputs').entries()) {
    if (!isObj(x) || !isStr(x.name) || !isStr(x.from) || !isStr(x.unit)) return `${path}.outputs[${i}]: name, from and unit expected`
  }
  for (const [i, x] of arr('warnings').entries()) {
    if (!isObj(x) || !isStr(x.condition) || !isStr(x.severity)) return `${path}.warnings[${i}]: condition and severity expected`
  }
  for (const [i, x] of arr('lookups').entries()) {
    if (!isObj(x) || !isStr(x.name) || !Array.isArray(x.columns) || !Array.isArray(x.rows)) return `${path}.lookups[${i}]: name, columns and rows expected`
  }
  for (const [i, x] of arr('tests').entries()) {
    if (!isObj(x) || !isStr(x.id) || !isObj(x.inputs) || !isObj(x.expected)) return `${path}.tests[${i}]: id, inputs and expected expected`
    for (const v of [...Object.values(x.inputs), ...Object.values(x.expected)]) if (!isNum(v)) return `${path}.tests[${i}]: numeric values expected`
  }
  return null
}

function normaliseModel(raw: Record<string, unknown>): SizingModelDef {
  const m = structuredClone(raw) as unknown as SizingModelDef
  m.inputs = (m.inputs ?? []).map((i) => ({ ...i, labelVi: i.labelVi ?? i.name, labelEn: i.labelEn ?? i.name }))
  m.params = m.params ?? []
  m.calc = m.calc ?? []
  m.outputs = m.outputs ?? []
  m.warnings = (m.warnings ?? []).map((w) => ({ ...w, messageVi: w.messageVi ?? w.messageEn ?? '', messageEn: w.messageEn ?? w.messageVi ?? '' }))
  m.lookups = m.lookups ?? []
  m.tests = (m.tests ?? []).map((t) => ({ ...t, tolerance: isNum(t.tolerance) ? t.tolerance : 0.000001 }))
  return m
}

/**
 * Accepts a RulePack (or draft), a single SizingModelDef, or an array of
 * models. The result is always a NEW pack (no id): pasting never overwrites a
 * stored pack by accident.
 */
export function packFromJson(text: string): { ok: true; pack: EditablePack } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
  let models: unknown[]
  let name = 'Pasted pack'
  let description = ''
  if (Array.isArray(raw)) models = raw
  else if (isObj(raw) && Array.isArray(raw.models)) {
    models = raw.models
    if (isStr(raw.name) && raw.name.trim() !== '') name = raw.name
    if (isStr(raw.description)) description = raw.description
  } else if (isObj(raw) && Array.isArray(raw.calc)) models = [raw]
  else return { ok: false, error: 'Expected a rule pack ({ models: [...] }), a model ({ calc: [...] }) or an array of models.' }
  if (models.length === 0) return { ok: false, error: 'No models.' }
  if (models.length > 50) return { ok: false, error: 'At most 50 models.' }
  for (const [i, m] of models.entries()) {
    const problem = checkModel(m, `models[${i}]`)
    if (problem) return { ok: false, error: problem }
  }
  const ids = models.map((m) => (m as { id: string }).id)
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'Duplicate model id.' }
  return {
    ok: true,
    pack: { builtIn: false, name, description, version: 1, status: 'draft', models: models.map((m) => normaliseModel(m as Record<string, unknown>)) },
  }
}

// ---------------------------------------------------------------------------
// Compile errors -> rows
// ---------------------------------------------------------------------------

export type Section = 'inputs' | 'params' | 'calc' | 'outputs' | 'warnings' | 'tests' | 'lookups'

/**
 * Does `where` (e.g. "calc.storage", "warnings[0]", "calc[2].formula",
 * "tests.T1") point at row `index` / `name` of `section`?
 */
export function errorMatchesRow(where: string, section: Section, name: string | null, index: number): boolean {
  const w = where.trim()
  if (!w.startsWith(section)) return false
  const rest = w.slice(section.length)
  if (rest.startsWith(`[${index}]`)) return true
  if (name !== null && name !== '' && rest.startsWith('.')) {
    const key = rest.slice(1)
    return key === name || key.startsWith(`${name}.`) || key.startsWith(`${name}[`)
  }
  return false
}

export function rowErrors(errors: RuleError[], section: Section, name: string | null, index: number): RuleError[] {
  return errors.filter((e) => errorMatchesRow(e.where, section, name, index))
}

/** Errors that no row claims (model-level problems), shown above the tables. */
export function unmatchedErrors(errors: RuleError[], model: SizingModelDef): RuleError[] {
  const rows: [Section, (string | null)[]][] = [
    ['inputs', model.inputs.map((x) => x.name)],
    ['params', model.params.map((x) => x.name)],
    ['calc', model.calc.map((x) => x.name)],
    ['outputs', model.outputs.map((x) => x.name)],
    ['warnings', model.warnings.map(() => null)],
    ['tests', model.tests.map((x) => x.id)],
    ['lookups', model.lookups.map((x) => x.name)],
  ]
  return errors.filter((e) => !rows.some(([section, names]) => names.some((n, i) => errorMatchesRow(e.where, section, n, i))))
}
