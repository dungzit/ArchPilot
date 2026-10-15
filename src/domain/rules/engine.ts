/**
 * Rule engine public interface (pilot WP-A, docs/v3/05). The lead fixed these
 * signatures so WP-A2 (Excel import, rule editor) and WP-C (HLD) can build in
 * parallel. WP-A owns the implementation and must keep the signatures.
 *
 * Pure: no React, no fetch, deterministic (decision D3: sizing arithmetic
 * lives in TypeScript only).
 *
 * How a model is run
 * ------------------
 * 1. `compileInternal` parses every formula and condition (parser.ts) and
 *    type-checks it: names must exist, a calc step may only read earlier
 *    steps, and in `units` mode every value carries a dimension over
 *    [byte, second] (units.ts) that must line up: `+ - < ==` need equal
 *    dimensions, `ceil/floor/round` need a dimensionless argument, and each
 *    calc's inferred dimension must equal its declared unit's. Number
 *    literals are dimensionless, except `0`, which matches any unit.
 * 2. Evaluation works in base units (bytes, seconds): an input of `150 MB/s`
 *    enters as 1.5e8. Each step's value is then expressed in its declared unit
 *    for the trace, so `116.64 TB` is computed as 1.1664e14 bytes / 1e12.
 *    In `excel` mode nothing is converted: identifiers are their raw numbers.
 * 3. ceil/floor/roundup_to, output rounding and comparisons first snap their
 *    operand to 12 significant digits, so float noise never adds a host
 *    (600 MB/s × 3 / 100 MB/s / 0.6 is 30.000000000000004 in IEEE doubles).
 */
import type { RuleLookup, RuleSeverity, RuleTest, SizingModelDef, SizingRun, SizingRunWarning, SizingStep } from '../../contracts/pilot'
import { formatPlain, withUnit } from './format'
import { DslSyntaxError, IDENTIFIER_RE, KEYWORDS, parseFormula, printExpr, referencedNames, type Expr } from './parser'
import { DIMENSIONLESS, dimDiv, dimEquals, dimMul, dimPow, formatDim, isCountUnit, isDimensionless, parseUnit, type Dim } from './units'

export interface RuleError {
  /** Where the problem is, e.g. "calc.storage", "warnings[0]", "outputs.brokers". */
  where: string
  message: string
}

export type CompileResult = { ok: true } | { ok: false; errors: RuleError[] }

export interface ModelTestResult {
  testId: string
  passed: boolean
  failures: { output: string; expected: number; actual: number | null }[]
  error?: string
}

export interface EvaluateMeta {
  rulePackId: string
  rulePackVersion: number
  designId?: string | null
  componentLabel?: string | null
}

/** Functions the DSL knows, for editor autocomplete and error messages. */
export const DSL_FUNCTIONS = ['ceil', 'floor', 'round', 'roundup_to', 'min', 'max', 'sum', 'avg', 'abs', 'if', 'lookup', 'convert'] as const

const SEVERITIES: readonly RuleSeverity[] = ['info', 'low', 'medium', 'high']
const ROUNDINGS = ['none', 'ceil', 'floor', 'round']
/** Below this relative tolerance a test would fail on float noise alone. */
const MIN_TOLERANCE = 1e-9

// ---------------------------------------------------------------------------
// Compiled form (internal)
// ---------------------------------------------------------------------------

type Mode = 'units' | 'excel'

interface SymbolInfo {
  kind: 'input' | 'param' | 'calc'
  name: string
  unit: string
  /** Declared unit -> base units. Always 1 in excel mode. */
  factor: number
  /** null: unknown (excel mode, or the unit itself was invalid), so never checked. */
  dim: Dim | null
  /** Calc step position; -1 for inputs and params. */
  order: number
}

interface CompiledCalc {
  name: string
  where: string
  formula: string
  expr: Expr
  unit: string
  factor: number
}

interface CompiledWarning {
  where: string
  expr: Expr
  severity: RuleSeverity
  messageVi: string
  messageEn: string
}

interface CompiledModel {
  model: SizingModelDef
  mode: Mode
  symbols: Map<string, SymbolInfo>
  lookups: Map<string, RuleLookup>
  calc: CompiledCalc[]
  warnings: CompiledWarning[]
}

function problem(where: string, summary: string, detail: string): RuleError {
  return { where, message: `${summary} at ${where}: ${detail}` }
}

const column = (node: Expr) => ` (column ${node.pos})`

// ---------------------------------------------------------------------------
// Type and dimension checker
// ---------------------------------------------------------------------------

interface CheckContext {
  where: string
  units: boolean
  symbols: Map<string, SymbolInfo>
  lookups: Map<string, RuleLookup>
  /** Calc steps at or after this position are not visible yet. Infinity for warnings. */
  limit: number
  errors: RuleError[]
}

function fail(ctx: CheckContext, summary: string, detail: string): null {
  ctx.errors.push(problem(ctx.where, summary, detail))
  return null
}

/** Constant exponent (`2`, `-1`, `(0.5)`) or null. */
function constantNumber(node: Expr): number | null {
  if (node.kind === 'num') return node.value
  if (node.kind === 'unary' && node.op === '-') {
    const inner = constantNumber(node.arg)
    return inner === null ? null : -inner
  }
  return null
}

const ARITY: Record<string, [number, number]> = {
  ceil: [1, 1],
  floor: [1, 1],
  round: [1, 2],
  roundup_to: [2, 2],
  min: [1, Infinity],
  max: [1, Infinity],
  sum: [1, Infinity],
  avg: [1, Infinity],
  abs: [1, 1],
  if: [3, 3],
  lookup: [3, 3],
  convert: [2, 2],
}

function arityText(name: string): string {
  const [low, high] = ARITY[name]
  if (high === Infinity) return `at least ${low} argument${low === 1 ? '' : 's'}`
  if (low === high) return `${low} argument${low === 1 ? '' : 's'}`
  return `${low} or ${high} arguments`
}

/** Returns the expression's dimension, or null when unknown (excel mode, or after an error). */
function check(node: Expr, ctx: CheckContext): Dim | null {
  const known = (dim: Dim | null) => (ctx.units ? dim : null)
  switch (node.kind) {
    case 'num':
      // Zero has every dimension, so `think_time == 0` and `max(x, 0)` are fine.
      return node.value === 0 ? null : known(DIMENSIONLESS)
    case 'str':
      return fail(ctx, 'type error', `a string is only allowed as the column of lookup() or the unit of convert()${column(node)}`)
    case 'ident': {
      if (ctx.lookups.has(node.name) && !ctx.symbols.has(node.name)) {
        return fail(ctx, 'type error', `lookup table "${node.name}" can only be used as lookup(${node.name}, key, "column")${column(node)}`)
      }
      const symbol = ctx.symbols.get(node.name)
      if (!symbol) return fail(ctx, 'unknown name', `"${node.name}" is not an input, param or calc step${column(node)}`)
      if (symbol.kind === 'calc' && symbol.order >= ctx.limit) {
        if (symbol.order === ctx.limit) return fail(ctx, 'circular reference', `"${node.name}" refers to itself${column(node)}`)
        return fail(ctx, 'forward reference', `"${node.name}" is defined in a later step; a calc step can only use earlier ones${column(node)}`)
      }
      return known(symbol.dim)
    }
    case 'unary': {
      const dim = check(node.arg, ctx)
      return node.op === '-' ? dim : known(DIMENSIONLESS)
    }
    case 'binary':
      return checkBinary(node, ctx)
    case 'call':
      return checkCall(node, ctx)
  }
}

function checkBinary(node: Extract<Expr, { kind: 'binary' }>, ctx: CheckContext): Dim | null {
  const left = check(node.left, ctx)
  const right = check(node.right, ctx)
  const known = (dim: Dim | null) => (ctx.units ? dim : null)
  switch (node.op) {
    case '+':
    case '-':
      if (left && right && !dimEquals(left, right)) {
        const verb = node.op === '+' ? 'add' : 'subtract'
        return fail(ctx, 'unit error', `cannot ${verb} ${formatDim(left)} and ${formatDim(right)}${column(node)}`)
      }
      return left ?? right
    case '*':
      return left && right ? dimMul(left, right) : null
    case '/':
      return left && right ? dimDiv(left, right) : null
    case '^': {
      if (!ctx.units) return null
      if (right && !isDimensionless(right)) return fail(ctx, 'unit error', `an exponent must be dimensionless, got ${formatDim(right)}${column(node)}`)
      if (!left) return null
      if (isDimensionless(left)) return DIMENSIONLESS
      const exponent = constantNumber(node.right)
      if (exponent === null) {
        return fail(ctx, 'unit error', `a quantity in ${formatDim(left)} can only be raised to a constant number${column(node)}`)
      }
      return dimPow(left, exponent)
    }
    case 'and':
    case 'or':
      return known(DIMENSIONLESS)
    default:
      if (left && right && !dimEquals(left, right)) {
        return fail(ctx, 'unit error', `cannot compare ${formatDim(left)} with ${formatDim(right)}${column(node)}`)
      }
      return known(DIMENSIONLESS)
  }
}

function checkCall(node: Extract<Expr, { kind: 'call' }>, ctx: CheckContext): Dim | null {
  const arity = ARITY[node.name]
  if (!arity) {
    node.args.forEach((arg) => { if (arg.kind !== 'str') check(arg, ctx) })
    return fail(ctx, 'unknown function', `"${node.name}()"; known functions: ${DSL_FUNCTIONS.join(', ')}${column(node)}`)
  }
  if (node.args.length < arity[0] || node.args.length > arity[1]) {
    return fail(ctx, 'wrong argument count', `${node.name}() takes ${arityText(node.name)}, got ${node.args.length}${column(node)}`)
  }
  const known = (dim: Dim | null) => (ctx.units ? dim : null)
  const needDimensionless = (arg: Expr, dim: Dim | null, role: string) => {
    if (dim && !isDimensionless(dim)) {
      fail(ctx, 'unit error', `${role} needs a dimensionless number but got ${formatDim(dim)}; divide by a quantity in the same unit first (for example storage / disk_size)${column(arg)}`)
    }
  }
  const sameDims = (dims: (Dim | null)[], what: string): Dim | null => {
    const first = dims.find((dim): dim is Dim => dim !== null) ?? null
    const clash = first ? dims.find((dim) => dim && !dimEquals(dim, first)) : undefined
    if (first && clash) return fail(ctx, 'unit error', `${what} need the same unit, got ${formatDim(first)} and ${formatDim(clash)}${column(node)}`)
    return first
  }
  switch (node.name) {
    case 'ceil':
    case 'floor':
    case 'round': {
      needDimensionless(node.args[0], check(node.args[0], ctx), `${node.name}()`)
      if (node.args[1]) needDimensionless(node.args[1], check(node.args[1], ctx), 'the digits of round()')
      return known(DIMENSIONLESS)
    }
    case 'roundup_to':
      return sameDims(node.args.map((arg) => check(arg, ctx)), 'roundup_to(x, step) arguments')
    case 'min':
    case 'max':
    case 'sum':
    case 'avg':
      return sameDims(node.args.map((arg) => check(arg, ctx)), `${node.name}() arguments`)
    case 'abs':
      return check(node.args[0], ctx)
    case 'if': {
      check(node.args[0], ctx)
      return sameDims([check(node.args[1], ctx), check(node.args[2], ctx)], 'both branches of if()')
    }
    case 'lookup':
      return checkLookup(node, ctx)
    case 'convert': {
      const dim = check(node.args[0], ctx)
      const target = node.args[1]
      if (target.kind !== 'str') return fail(ctx, 'type error', `convert(x, "unit") needs the unit as a quoted string${column(target)}`)
      if (!ctx.units) return null
      const unit = parseUnit(target.value)
      if (!unit) return fail(ctx, 'unknown unit', `"${target.value}" in convert()${column(target)}`)
      if (dim && !dimEquals(dim, unit.dim)) {
        return fail(ctx, 'unit error', `cannot convert ${formatDim(dim)} to "${target.value}" (${formatDim(unit.dim)})${column(target)}`)
      }
      return dim
    }
    default:
      return null
  }
}

function checkLookup(node: Extract<Expr, { kind: 'call' }>, ctx: CheckContext): Dim | null {
  const [tableArg, keyArg, columnArg] = node.args
  const known = ctx.units ? DIMENSIONLESS : null
  if (tableArg.kind !== 'ident') return fail(ctx, 'type error', `the first argument of lookup() must be a lookup table name${column(tableArg)}`)
  const table = ctx.lookups.get(tableArg.name)
  if (!table) return fail(ctx, 'unknown lookup table', `"${tableArg.name}"${column(tableArg)}`)
  if (keyArg.kind !== 'str') {
    const keyDim = check(keyArg, ctx)
    if (keyDim && !isDimensionless(keyDim)) {
      fail(ctx, 'unit error', `a lookup key must be dimensionless, got ${formatDim(keyDim)}${column(keyArg)}`)
    }
  }
  if (columnArg.kind !== 'str') return fail(ctx, 'type error', `the column of lookup() must be a quoted string, e.g. "factor"${column(columnArg)}`)
  if (columnIndex(table, columnArg.value) < 0) {
    return fail(ctx, 'unknown column', `"${columnArg.value}" is not a column of lookup table "${table.name}" (columns: ${table.columns.join(', ')})${column(columnArg)}`)
  }
  if (keyArg.kind === 'str' || keyArg.kind === 'num') {
    // A literal key can be checked now instead of failing at run time.
    if (!findRow(table, keyArg.value)) return fail(ctx, 'lookup error', `table "${table.name}" has no row with key ${JSON.stringify(keyArg.value)}${column(keyArg)}`)
  }
  return known
}

function columnIndex(table: RuleLookup, name: string): number {
  const wanted = name.trim().toLowerCase()
  return table.columns.findIndex((col) => String(col).trim().toLowerCase() === wanted)
}

/** Exact match on the first column: numbers numerically, strings case-insensitively. */
function findRow(table: RuleLookup, key: number | string): (string | number)[] | undefined {
  if (typeof key === 'number') {
    const target = snap(key)
    return table.rows.find((row) => {
      const cell = row[0]
      if (typeof cell === 'number') return snap(cell) === target
      return typeof cell === 'string' && cell.trim() !== '' && Number(cell) === target
    })
  }
  const target = key.trim().toLowerCase()
  const numeric = target === '' ? NaN : Number(target)
  return table.rows.find((row) => {
    const cell = row[0]
    if (typeof cell === 'string') return cell.trim().toLowerCase() === target
    return typeof cell === 'number' && cell === numeric
  })
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function compileInternal(model: SizingModelDef): { compiled: CompiledModel | null; errors: RuleError[] } {
  const errors: RuleError[] = []
  if (!model || typeof model !== 'object') return { compiled: null, errors: [problem('model', 'invalid model', 'not an object')] }
  for (const key of ['inputs', 'params', 'calc', 'outputs', 'warnings', 'lookups', 'tests'] as const) {
    if (!Array.isArray(model[key])) errors.push(problem('model', 'invalid model', `"${key}" must be a list`))
  }
  if (errors.length) return { compiled: null, errors }
  if (typeof model.id !== 'string' || model.id.trim() === '') errors.push(problem('model', 'invalid model', 'the model needs an id'))
  const modeValue = model.formulaMode ?? 'units'
  if (modeValue !== 'units' && modeValue !== 'excel') errors.push(problem('model', 'invalid model', `formulaMode must be "units" or "excel", got "${String(modeValue)}"`))
  const mode: Mode = modeValue === 'excel' ? 'excel' : 'units'
  const units = mode === 'units'

  const symbols = new Map<string, SymbolInfo>()
  const lookups = new Map<string, RuleLookup>()
  const claimed = new Map<string, string>()
  const claim = (name: unknown, where: string): name is string => {
    if (typeof name !== 'string' || !IDENTIFIER_RE.test(name)) {
      errors.push(problem(where, 'invalid name', `${JSON.stringify(name)} must start with a letter or _ and contain only letters, digits and _`))
      return false
    }
    if (KEYWORDS.has(name)) {
      errors.push(problem(where, 'invalid name', `"${name}" is a reserved word`))
      return false
    }
    const previous = claimed.get(name)
    if (previous) {
      errors.push(problem(where, 'duplicate name', `"${name}" is already used by ${previous}`))
      return false
    }
    claimed.set(name, where)
    return true
  }
  const resolveUnit = (unit: unknown, where: string): { factor: number; dim: Dim | null } => {
    if (typeof unit !== 'string') {
      errors.push(problem(where, 'invalid unit', 'unit must be a string ("" for none)'))
      return { factor: 1, dim: null }
    }
    if (!units) return { factor: 1, dim: null }
    const parsed = parseUnit(unit)
    if (!parsed) {
      errors.push(problem(where, 'unknown unit', `"${unit}"; use e.g. B KB MB GB TB, KiB..PiB, b Mb Gb, bps Mbps Gbps, ms s min h day week month year, IOPS, %, count, or X/Y rates`))
      return { factor: 1, dim: null }
    }
    return parsed
  }

  model.inputs.forEach((input, index) => {
    const where = `inputs.${input?.name ?? index}`
    if (!claim(input?.name, where)) return
    const unit = resolveUnit(input.unit, where)
    if (!isFiniteNumber(input.default)) errors.push(problem(where, 'invalid input', 'the default must be a finite number'))
    if (input.min !== undefined && input.min !== null && !isFiniteNumber(input.min)) errors.push(problem(where, 'invalid input', 'min must be a finite number'))
    if (input.max !== undefined && input.max !== null && !isFiniteNumber(input.max)) errors.push(problem(where, 'invalid input', 'max must be a finite number'))
    if (isFiniteNumber(input.min) && isFiniteNumber(input.max) && input.min > input.max) errors.push(problem(where, 'invalid input', `min ${input.min} is greater than max ${input.max}`))
    if (isFiniteNumber(input.default) && isFiniteNumber(input.min) && input.default < input.min) errors.push(problem(where, 'invalid input', `the default ${input.default} is below min ${input.min}`))
    if (isFiniteNumber(input.default) && isFiniteNumber(input.max) && input.default > input.max) errors.push(problem(where, 'invalid input', `the default ${input.default} is above max ${input.max}`))
    symbols.set(input.name, { kind: 'input', name: input.name, unit: input.unit, factor: unit.factor, dim: unit.dim, order: -1 })
  })

  model.params.forEach((param, index) => {
    const where = `params.${param?.name ?? index}`
    if (!claim(param?.name, where)) return
    const unit = resolveUnit(param.unit, where)
    if (!isFiniteNumber(param.value)) errors.push(problem(where, 'invalid param', 'the value must be a finite number'))
    symbols.set(param.name, { kind: 'param', name: param.name, unit: param.unit, factor: unit.factor, dim: unit.dim, order: -1 })
  })

  model.lookups.forEach((table, index) => {
    const where = `lookups.${table?.name ?? index}`
    if (!claim(table?.name, where)) return
    if (!Array.isArray(table.columns) || table.columns.length < 2 || table.columns.some((col) => typeof col !== 'string' || col.trim() === '')) {
      errors.push(problem(where, 'invalid lookup', 'needs at least 2 named columns (the first one is the key)'))
      return
    }
    const lowered = table.columns.map((col) => col.trim().toLowerCase())
    if (new Set(lowered).size !== lowered.length) errors.push(problem(where, 'invalid lookup', 'column names must be unique'))
    if (!Array.isArray(table.rows)) {
      errors.push(problem(where, 'invalid lookup', 'rows must be a list'))
      return
    }
    table.rows.forEach((row, rowIndex) => {
      if (!Array.isArray(row) || row.length !== table.columns.length) {
        errors.push(problem(where, 'invalid lookup', `row ${rowIndex + 1} must have ${table.columns.length} cells`))
      } else if (row.some((cell) => !(typeof cell === 'string' || isFiniteNumber(cell)))) {
        errors.push(problem(where, 'invalid lookup', `row ${rowIndex + 1} has a cell that is neither text nor a finite number`))
      }
    })
    lookups.set(table.name, table)
  })

  // Register every calc name first so a forward reference reads as one, not as "unknown name".
  const calcUnits: ({ factor: number; dim: Dim | null } | null)[] = model.calc.map((step, index) => {
    const where = `calc.${step?.name ?? index}`
    if (!claim(step?.name, where)) return null
    const unit = resolveUnit(step.unit, where)
    symbols.set(step.name, { kind: 'calc', name: step.name, unit: step.unit, factor: unit.factor, dim: unit.dim, order: index })
    return unit
  })

  const calc: CompiledCalc[] = []
  model.calc.forEach((step, index) => {
    const unit = calcUnits[index]
    if (!unit) return
    const where = `calc.${step.name}`
    const expr = parseChecked(step.formula, where, errors)
    if (!expr) return
    const ctx: CheckContext = { where, units, symbols, lookups, limit: index, errors }
    const before = errors.length
    const dim = check(expr, ctx)
    if (units && errors.length === before && dim && unit.dim && !dimEquals(dim, unit.dim)) {
      errors.push(problem(where, 'unit mismatch', `got ${formatDim(dim)}, declared ${step.unit || '(no unit)'}`))
    }
    calc.push({ name: step.name, where, formula: step.formula, expr, unit: step.unit, factor: unit.factor })
  })

  const outputNames = new Set<string>()
  model.outputs.forEach((output, index) => {
    const where = `outputs.${output?.name ?? index}`
    if (typeof output?.name !== 'string' || output.name.trim() === '') {
      errors.push(problem(where, 'invalid output', 'the output needs a name'))
      return
    }
    if (outputNames.has(output.name)) errors.push(problem(where, 'duplicate name', `output "${output.name}" is listed twice`))
    outputNames.add(output.name)
    if (output.rounding !== undefined && !ROUNDINGS.includes(output.rounding)) {
      errors.push(problem(where, 'invalid output', `rounding must be one of ${ROUNDINGS.join(', ')}`))
    }
    const source = symbols.get(output.from)
    if (!source) {
      errors.push(problem(where, 'unknown name', `"${String(output.from)}" is not a calc step, input or param`))
      return
    }
    const unit = resolveUnit(output.unit, where)
    if (units && unit.dim && source.dim && !dimEquals(unit.dim, source.dim)) {
      errors.push(problem(where, 'unit mismatch', `"${output.from}" is ${formatDim(source.dim)} (${source.unit}), declared ${output.unit || '(no unit)'}`))
    }
  })

  const warnings: CompiledWarning[] = []
  model.warnings.forEach((warning, index) => {
    const where = `warnings[${index}]`
    if (!SEVERITIES.includes(warning?.severity)) errors.push(problem(where, 'invalid warning', `severity must be one of ${SEVERITIES.join(', ')}`))
    if (typeof warning?.messageVi !== 'string' || typeof warning?.messageEn !== 'string') {
      errors.push(problem(where, 'invalid warning', 'messageVi and messageEn are required'))
    }
    const expr = parseChecked(warning?.condition, where, errors)
    if (!expr) return
    check(expr, { where, units, symbols, lookups, limit: Infinity, errors })
    warnings.push({ where, expr, severity: warning.severity, messageVi: warning.messageVi, messageEn: warning.messageEn })
  })

  const testIds = new Set<string>()
  const calcNames = new Set(model.calc.map((step) => step?.name))
  model.tests.forEach((test, index) => {
    const where = `tests.${test?.id ?? index}`
    if (typeof test?.id !== 'string' || test.id.trim() === '') {
      errors.push(problem(where, 'invalid test', 'the test needs an id'))
      return
    }
    if (testIds.has(test.id)) errors.push(problem(where, 'duplicate name', `test id "${test.id}" is used twice`))
    testIds.add(test.id)
    if (!isFiniteNumber(test.tolerance) || test.tolerance < 0) errors.push(problem(where, 'invalid test', 'tolerance must be a number >= 0'))
    for (const [name, value] of Object.entries(test.inputs ?? {})) {
      if (symbols.get(name)?.kind !== 'input') errors.push(problem(where, 'invalid test', `"${name}" is not an input of this model`))
      else if (!isFiniteNumber(value)) errors.push(problem(where, 'invalid test', `input "${name}" must be a finite number`))
    }
    const expected = Object.entries(test.expected ?? {})
    if (expected.length === 0) errors.push(problem(where, 'invalid test', 'the test expects nothing; add at least one expected output'))
    for (const [name, value] of expected) {
      if (!outputNames.has(name) && !calcNames.has(name)) errors.push(problem(where, 'invalid test', `"${name}" is not an output or calc step of this model`))
      else if (!isFiniteNumber(value)) errors.push(problem(where, 'invalid test', `expected "${name}" must be a finite number`))
    }
  })

  if (errors.length) return { compiled: null, errors }
  return { compiled: { model, mode, symbols, lookups, calc, warnings }, errors }
}

function parseChecked(source: unknown, where: string, errors: RuleError[]): Expr | null {
  if (typeof source !== 'string' || source.trim() === '') {
    errors.push(problem(where, 'syntax error', 'the formula is empty'))
    return null
  }
  try {
    return parseFormula(source)
  } catch (error) {
    if (error instanceof DslSyntaxError) errors.push(problem(where, 'syntax error', `${error.message} (column ${error.column})`))
    else errors.push(problem(where, 'syntax error', String(error)))
    return null
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

class EvalFailure extends Error {}

/** 12 significant digits: removes IEEE noise before ceil/floor/compare. */
function snap(value: number): number {
  if (value === 0 || !Number.isFinite(value)) return value
  return Number(value.toPrecision(12))
}

/** Excel ROUND: half away from zero, robust against 1.005-style noise. */
function roundHalfAway(value: number, digits: number): number {
  const factor = 10 ** Math.trunc(digits)
  const scaled = Number((Math.abs(value) * factor).toPrecision(15))
  return (Math.sign(value) * Math.round(scaled)) / factor
}

interface EvalState {
  compiled: CompiledModel
  /** Base units in `units` mode, raw numbers in `excel` mode. */
  values: Map<string, number>
}

const truthy = (value: number) => value !== 0

function evaluate(node: Expr, state: EvalState): number {
  switch (node.kind) {
    case 'num':
      return node.value
    case 'str':
      throw new EvalFailure('a string cannot be used as a number')
    case 'ident': {
      const value = state.values.get(node.name)
      if (value === undefined) throw new EvalFailure(`"${node.name}" has no value`)
      return value
    }
    case 'unary': {
      const value = evaluate(node.arg, state)
      return node.op === '-' ? -value : truthy(value) ? 0 : 1
    }
    case 'binary':
      return evaluateBinary(node, state)
    case 'call':
      return evaluateCall(node, state)
  }
}

function evaluateBinary(node: Extract<Expr, { kind: 'binary' }>, state: EvalState): number {
  if (node.op === 'and') return truthy(evaluate(node.left, state)) && truthy(evaluate(node.right, state)) ? 1 : 0
  if (node.op === 'or') return truthy(evaluate(node.left, state)) || truthy(evaluate(node.right, state)) ? 1 : 0
  const left = evaluate(node.left, state)
  const right = evaluate(node.right, state)
  switch (node.op) {
    case '+':
      return left + right
    case '-':
      return left - right
    case '*':
      return left * right
    case '/':
      if (right === 0) throw new EvalFailure(`division by zero${column(node)}`)
      return left / right
    case '^': {
      const result = left ** right
      if (Number.isNaN(result)) throw new EvalFailure(`${formatPlain(left)}^${formatPlain(right)} is not a real number${column(node)}`)
      return result
    }
    case '<':
      return snap(left) < snap(right) ? 1 : 0
    case '<=':
      return snap(left) <= snap(right) ? 1 : 0
    case '>':
      return snap(left) > snap(right) ? 1 : 0
    case '>=':
      return snap(left) >= snap(right) ? 1 : 0
    case '==':
      return snap(left) === snap(right) ? 1 : 0
    case '!=':
      return snap(left) !== snap(right) ? 1 : 0
  }
}

function evaluateCall(node: Extract<Expr, { kind: 'call' }>, state: EvalState): number {
  const arg = (index: number) => evaluate(node.args[index], state)
  switch (node.name) {
    case 'ceil':
      return Math.ceil(snap(arg(0)))
    case 'floor':
      return Math.floor(snap(arg(0)))
    case 'round':
      return roundHalfAway(arg(0), node.args.length > 1 ? arg(1) : 0)
    case 'roundup_to': {
      const value = arg(0)
      const step = arg(1)
      if (!(step > 0)) throw new EvalFailure(`roundup_to() needs a step > 0, got ${formatPlain(step)}${column(node)}`)
      return Math.ceil(snap(value / step)) * step
    }
    case 'min':
      return Math.min(...node.args.map((_, index) => arg(index)))
    case 'max':
      return Math.max(...node.args.map((_, index) => arg(index)))
    case 'sum':
      return node.args.reduce((total, _, index) => total + arg(index), 0)
    case 'avg':
      return node.args.reduce((total, _, index) => total + arg(index), 0) / node.args.length
    case 'abs':
      return Math.abs(arg(0))
    case 'if':
      return truthy(arg(0)) ? arg(1) : arg(2)
    case 'lookup':
      return evaluateLookup(node, state)
    case 'convert':
      // Values are already in base units (units mode) or raw (excel mode); the
      // target unit only matters to the checker and to the trace.
      return arg(0)
    default:
      throw new EvalFailure(`unknown function ${node.name}()`)
  }
}

function lookupParts(node: Extract<Expr, { kind: 'call' }>, state: EvalState) {
  const [tableArg, keyArg, columnArg] = node.args
  const table = tableArg.kind === 'ident' ? state.compiled.lookups.get(tableArg.name) : undefined
  if (!table || columnArg.kind !== 'str') throw new EvalFailure(`invalid lookup()${column(node)}`)
  const key: number | string = keyArg.kind === 'str' ? keyArg.value : evaluate(keyArg, state)
  return { table, key, columnName: columnArg.value }
}

function evaluateLookup(node: Extract<Expr, { kind: 'call' }>, state: EvalState): number {
  const { table, key, columnName } = lookupParts(node, state)
  const row = findRow(table, key)
  if (!row) {
    const keys = table.rows.map((candidate) => String(candidate[0])).join(', ')
    throw new EvalFailure(`lookup table "${table.name}" has no row with key ${typeof key === 'number' ? formatPlain(key) : JSON.stringify(key)} (keys: ${keys})`)
  }
  const cell = row[columnIndex(table, columnName)]
  const value = typeof cell === 'number' ? cell : Number(cell)
  if (typeof cell === 'string' && (cell.trim() === '' || !Number.isFinite(value))) {
    throw new EvalFailure(`lookup table "${table.name}", column "${columnName}" for key ${String(key)} is "${cell}", not a number`)
  }
  return value
}

/** A value as a trace shows it: `150 MB/s`, `70%`, but `8` for 8 broker. */
function traceText(value: number, unit: string): string {
  return isCountUnit(unit) ? formatPlain(value) : withUnit(formatPlain(value), unit)
}

/** A symbol's value expressed in its own declared unit (what people read). */
function displayValue(symbol: SymbolInfo, base: number, mode: Mode): number {
  return mode === 'units' ? base / symbol.factor : base
}

/** The formula with values and units substituted: `ceil(150 MB/s × 3 / 100 MB/s / 0.6) = ceil(7.5)`. */
function substitute(step: CompiledCalc, state: EvalState): string {
  const { compiled, values } = state
  const leaf = (node: Expr): string | undefined => {
    if (node.kind === 'ident') {
      const symbol = compiled.symbols.get(node.name)
      const base = values.get(node.name)
      if (!symbol || base === undefined) return undefined
      return traceText(displayValue(symbol, base, compiled.mode), symbol.unit)
    }
    if (node.kind === 'call' && node.name === 'lookup') {
      const { table, key, columnName } = lookupParts(node, state)
      const keyText = node.args[1].kind === 'str' ? JSON.stringify(key) : printExpr(node.args[1], leaf)
      return `lookup(${table.name}, ${keyText} → ${columnName} = ${formatPlain(evaluate(node, state))})`
    }
    return undefined
  }
  const text = printExpr(step.expr, leaf)
  // A top-level rounding also shows the value it rounds: `... = ceil(7.5)`.
  const top = step.expr
  let tail: string | null = null
  if (top.kind === 'call' && !top.paren && ['ceil', 'floor', 'round'].includes(top.name)) {
    const inner = formatPlain(evaluate(top.args[0], state))
    const digits = top.args[1] ? `, ${formatPlain(evaluate(top.args[1], state))}` : ''
    tail = `${top.name}(${inner}${digits})`
  } else if (top.kind === 'call' && !top.paren && top.name === 'roundup_to') {
    const show = (node: Expr) => {
      const value = evaluate(node, state)
      return compiled.mode === 'units' ? traceText(value / step.factor, step.unit) : formatPlain(value)
    }
    tail = `roundup_to(${show(top.args[0])}, ${show(top.args[1])})`
  }
  return tail === null || tail === text ? text : `${text} = ${tail}`
}

/** First max()/min() with 2+ arguments, depth-first. */
function firstMinMax(expr: Expr): Extract<Expr, { kind: 'call' }> | null {
  switch (expr.kind) {
    case 'call':
      if ((expr.name === 'max' || expr.name === 'min') && expr.args.length >= 2) return expr
      for (const arg of expr.args) {
        const found = firstMinMax(arg)
        if (found) return found
      }
      return null
    case 'binary':
      return firstMinMax(expr.left) ?? firstMinMax(expr.right)
    case 'unary':
      return firstMinMax(expr.arg)
    default:
      return null
  }
}

/**
 * Which constraint decided the primary output. Starts at the calc step that
 * feeds the first output and walks back through the steps it reads (nearest
 * first) until it meets a max()/min(); `hosts = max(cpu_hosts, ram_hosts) +
 * spare_hosts` therefore reports `cpu_hosts`. Ties go to the first argument.
 */
function findBinding(state: EvalState): string | null {
  const { compiled } = state
  const primary = compiled.model.outputs[0]
  if (!primary) return null
  const indexByName = new Map(compiled.calc.map((step, index) => [step.name, index]))
  const start = indexByName.get(primary.from)
  if (start === undefined) return null
  const queue = [start]
  const seen = new Set<number>()
  while (queue.length) {
    const index = queue.shift() as number
    if (seen.has(index)) continue
    seen.add(index)
    const call = firstMinMax(compiled.calc[index].expr)
    if (call) {
      const values = call.args.map((arg) => snap(evaluate(arg, state)))
      const target = call.name === 'max' ? Math.max(...values) : Math.min(...values)
      const winner = call.args[values.indexOf(target)]
      return winner.kind === 'ident' ? winner.name : printExpr(winner)
    }
    for (const name of referencedNames(compiled.calc[index].expr)) {
      const ref = indexByName.get(name)
      if (ref !== undefined && ref < index) queue.push(ref)
    }
  }
  return null
}

const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/** `{rf}` in a warning message becomes the value with its unit. */
function interpolate(message: string, state: EvalState): string {
  return message.replace(PLACEHOLDER_RE, (whole, name: string) => {
    const symbol = state.compiled.symbols.get(name)
    const base = state.values.get(name)
    if (!symbol || base === undefined) return whole
    return traceText(displayValue(symbol, base, state.compiled.mode), symbol.unit)
  })
}

function applyRounding(value: number, rounding: string | undefined): number {
  switch (rounding) {
    case 'ceil':
      return Math.ceil(snap(value))
    case 'floor':
      return Math.floor(snap(value))
    case 'round':
      return roundHalfAway(value, 0)
    default:
      return value
  }
}

function runCompiled(compiled: CompiledModel, inputs: Record<string, number>, meta: EvaluateMeta): SizingRun {
  const { model, mode } = compiled
  const values = new Map<string, number>()
  const state: EvalState = { compiled, values }
  const given = inputs ?? {}

  const runInputs: SizingRun['inputs'] = []
  for (const input of model.inputs) {
    const provided = Object.prototype.hasOwnProperty.call(given, input.name) ? given[input.name] : undefined
    if (provided !== undefined && !isFiniteNumber(provided)) {
      throw new Error(`invalid input at inputs.${input.name}: ${JSON.stringify(provided)} is not a finite number`)
    }
    const value = provided ?? input.default
    const symbol = compiled.symbols.get(input.name) as SymbolInfo
    values.set(input.name, value * symbol.factor)
    const source = provided !== undefined && provided !== input.default ? 'user' : (input.source ?? 'default')
    runInputs.push({ name: input.name, value, unit: input.unit, source })
  }
  for (const param of model.params) {
    const symbol = compiled.symbols.get(param.name) as SymbolInfo
    values.set(param.name, param.value * symbol.factor)
    runInputs.push({ name: param.name, value: param.value, unit: param.unit, source: param.source ? `param: ${param.source}` : 'param' })
  }

  const steps: SizingStep[] = []
  for (const step of compiled.calc) {
    try {
      const base = evaluate(step.expr, state)
      if (!Number.isFinite(base)) throw new EvalFailure('the result is not a finite number')
      values.set(step.name, base)
      steps.push({
        name: step.name,
        formula: step.formula,
        substituted: substitute(step, state),
        value: mode === 'units' ? base / step.factor : base,
        unit: step.unit,
      })
    } catch (error) {
      throw new Error(`evaluation error at ${step.where}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const outputs: SizingRun['outputs'] = model.outputs.map((output) => {
    const base = values.get(output.from) as number
    const factor = mode === 'units' ? (parseUnit(output.unit)?.factor ?? 1) : 1
    const value = applyRounding(base / factor, output.rounding)
    return { name: output.name, value, unit: output.unit, label: output.labelEn ?? output.labelVi ?? output.name }
  })

  let binding: string | null = null
  try {
    binding = findBinding(state)
  } catch (error) {
    throw new Error(`evaluation error at outputs.${model.outputs[0]?.name}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const warnings: SizingRunWarning[] = []
  for (const warning of compiled.warnings) {
    let fired: boolean
    try {
      fired = truthy(evaluate(warning.expr, state))
    } catch (error) {
      throw new Error(`evaluation error at ${warning.where}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (fired) {
      warnings.push({ severity: warning.severity, messageVi: interpolate(warning.messageVi, state), messageEn: interpolate(warning.messageEn, state) })
    }
  }

  return {
    designId: meta?.designId ?? null,
    componentLabel: meta?.componentLabel ?? null,
    rulePackId: meta?.rulePackId ?? '',
    rulePackVersion: meta?.rulePackVersion ?? 0,
    modelId: model.id,
    modelName: model.nameEn || model.nameVi || model.id,
    inputs: runInputs,
    steps,
    outputs,
    binding,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Public API (signatures fixed by the lead)
// ---------------------------------------------------------------------------

/** Parse and type-check every formula and warning condition of a model. Never throws. */
export function compileModel(model: SizingModelDef): CompileResult {
  try {
    const { errors } = compileInternal(model)
    return errors.length ? { ok: false, errors } : { ok: true }
  } catch (error) {
    return { ok: false, errors: [problem('model', 'internal error', error instanceof Error ? error.message : String(error))] }
  }
}

/**
 * Evaluate a model. Inputs missing from `inputs` take their defaults.
 * Throws an Error whose message names the failing step when evaluation fails.
 */
export function evaluateModel(model: SizingModelDef, inputs: Record<string, number>, meta: EvaluateMeta): SizingRun {
  const { compiled, errors } = compileInternal(model)
  if (!compiled) {
    const more = errors.length > 1 ? ` (and ${errors.length - 1} more error${errors.length > 2 ? 's' : ''})` : ''
    throw new Error(`${errors[0]?.message ?? 'the model does not compile'}${more}`)
  }
  return runCompiled(compiled, inputs, meta)
}

function closeEnough(actual: number, expected: number, tolerance: number): boolean {
  const relative = Math.max(isFiniteNumber(tolerance) ? tolerance : 0, MIN_TOLERANCE)
  if (expected === 0) return Math.abs(actual) <= relative
  return Math.abs(actual - expected) <= relative * Math.abs(expected)
}

function runOneTest(compiled: CompiledModel, test: RuleTest): ModelTestResult {
  const expected = Object.entries(test.expected ?? {})
  try {
    const run = runCompiled(compiled, test.inputs ?? {}, { rulePackId: '', rulePackVersion: 0 })
    const outputs = new Map(run.outputs.map((output) => [output.name, output.value]))
    const steps = new Map(run.steps.map((step) => [step.name, step.value]))
    const failures: ModelTestResult['failures'] = []
    for (const [name, want] of expected) {
      const actual = outputs.get(name) ?? steps.get(name) ?? null
      if (actual === null || !closeEnough(actual, want, test.tolerance)) failures.push({ output: name, expected: want, actual })
    }
    return { testId: test.id, passed: failures.length === 0, failures }
  } catch (error) {
    return {
      testId: test.id,
      passed: false,
      failures: expected.map(([name, want]) => ({ output: name, expected: want, actual: null })),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Run every test case of a model. Never throws; failures are reported per test. */
export function runModelTests(model: SizingModelDef): ModelTestResult[] {
  try {
    const tests = Array.isArray(model?.tests) ? model.tests : []
    const { compiled, errors } = compileInternal(model)
    if (!compiled) {
      const reason = `the model does not compile: ${errors[0]?.message ?? 'unknown error'}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''}`
      return tests.map((test, index) => ({
        testId: typeof test?.id === 'string' ? test.id : `#${index + 1}`,
        passed: false,
        failures: Object.entries(test?.expected ?? {}).map(([name, want]) => ({ output: name, expected: Number(want), actual: null })),
        error: reason,
      }))
    }
    return tests.map((test) => runOneTest(compiled, test))
  } catch (error) {
    return [{ testId: '(all)', passed: false, failures: [], error: error instanceof Error ? error.message : String(error) }]
  }
}
