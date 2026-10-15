import { describe, expect, it } from 'vitest'
import { formatNumber, printDsl, dBin, dNeg, dNum, dId } from './dsl'
import { parseExcelFormula, isA1Cell, isR1C1Like } from './excelFormula'
import { translateExcelFormula, type Resolved, type TranslateEnv } from './translate'

const VALUES = ['ingress', 'rf', 'retention_days', 'broker_write', 'target_util', 'disk_per_broker', 'disk_fill', 'tp_brokers', 'storage_tb', 'storage_brokers', 'x', 'n', 's', 'a', 'b', 'd']
const TABLE = { table: 'raid', columns: ['level', 'factor', 'min_disks'] }

const env: TranslateEnv = {
  resolveName(name): Resolved {
    const lower = name.toLowerCase()
    const hit = VALUES.find((v) => v === lower || `kafka_${v}` === lower)
    if (hit) return { kind: 'value', ident: hit }
    if (lower === 'raid') return { kind: 'table', ...TABLE }
    if (lower.startsWith('raid.')) {
      const index = TABLE.columns.indexOf(lower.slice(5))
      if (index >= 0) return { kind: 'column', ...TABLE, index }
    }
    if (lower === 'disks') return { kind: 'table', table: 'disks', columns: ['k', 'v'] }
    if (lower === 'disks.k') return { kind: 'column', table: 'disks', columns: ['k', 'v'], index: 0 }
    return { kind: 'error', message: { vi: `Không biết tên ${name}`, en: `Unknown name ${name}` } }
  },
}

function dsl(formula: string): string {
  const r = translateExcelFormula(formula, env)
  if (!r.ok) throw new Error(`translation failed: ${r.error.en}`)
  return r.dsl
}

function err(formula: string): string {
  const r = translateExcelFormula(formula, env)
  if (r.ok) throw new Error(`expected an error, got ${r.dsl}`)
  return r.error.en
}

describe('Excel formula parser', () => {
  it('classifies cell references and names', () => {
    expect(isA1Cell('A1')).toBe(true)
    expect(isA1Cell('XFD1048576')).toBe(true)
    expect(isA1Cell('XFE1')).toBe(false)
    expect(isA1Cell('rf')).toBe(false)
    expect(isA1Cell('tp1')).toBe(true)
    expect(isR1C1Like('R1C1')).toBe(true)
    expect(isR1C1Like('rc')).toBe(true)
    expect(isR1C1Like('rf')).toBe(false)
  })

  it('keeps Excel precedence: unary minus binds tighter than ^, ^ is left-associative', () => {
    expect(parseExcelFormula('=-2^2')).toMatchObject({ type: 'binary', op: '^', left: { type: 'unary' } })
    expect(parseExcelFormula('2^3^2')).toMatchObject({ type: 'binary', op: '^', left: { type: 'binary', op: '^' } })
  })

  it('strips _xlfn. prefixes from function names', () => {
    expect(parseExcelFormula('_xlfn.IFS(a>1,2,TRUE,3)')).toMatchObject({ type: 'call', name: 'IFS' })
    expect(parseExcelFormula('_xlfn.CEILING.MATH(a)')).toMatchObject({ type: 'call', name: 'CEILING.MATH' })
  })
})

describe('Excel -> DSL translation', () => {
  it('translates the Kafka template formulas', () => {
    expect(dsl('=CEILING(ingress*rf/broker_write/target_util,1)')).toBe('ceil(ingress * rf / broker_write / target_util)')
    expect(dsl('ingress*86400*retention_days*rf/1000000')).toBe('ingress * 86400 * retention_days * rf / 1000000')
    expect(dsl('CEILING(storage_tb/(disk_per_broker*disk_fill),1)')).toBe('ceil(storage_tb / (disk_per_broker * disk_fill))')
    expect(dsl('MAX(tp_brokers,storage_brokers,rf)')).toBe('max(tp_brokers, storage_brokers, rf)')
  })

  it('maps comparison operators and booleans functions', () => {
    expect(dsl('rf<3')).toBe('rf < 3')
    expect(dsl('a=b')).toBe('a == b')
    expect(dsl('a<>b')).toBe('a != b')
    expect(dsl('AND(a>1,b<=2)')).toBe('(a > 1 and b <= 2)')
    expect(dsl('OR(a>1,b>=2,d=0)')).toBe('(a > 1 or b >= 2 or d == 0)')
    expect(dsl('NOT(a>1)')).toBe('not (a > 1)')
    expect(dsl('IF(AND(a>1,b>1),a,b)')).toBe('if((a > 1 and b > 1), a, b)')
  })

  it('maps rounding functions per 05 §4', () => {
    expect(dsl('ROUND(x,2)')).toBe('round(x, 2)')
    expect(dsl('ROUNDUP(x,0)')).toBe('ceil(x)')
    expect(dsl('ROUNDUP(x,2)')).toBe('ceil(x * 10^2) / 10^2')
    expect(dsl('ROUNDDOWN(x,0)')).toBe('floor(x)')
    expect(dsl('ROUNDDOWN(x,-1)')).toBe('floor(x * 10^(-1)) / 10^(-1)')
    expect(dsl('CEILING(x)')).toBe('ceil(x)')
    expect(dsl('CEILING(x,1)')).toBe('ceil(x)')
    expect(dsl('CEILING(x,4)')).toBe('roundup_to(x, 4)')
    expect(dsl('_xlfn.CEILING.MATH(x,8)')).toBe('roundup_to(x, 8)')
    expect(dsl('FLOOR(x,5)')).toBe('floor(x / 5) * 5')
    expect(dsl('FLOOR(x,1)')).toBe('floor(x)')
  })

  it('maps aggregate functions and percent literals', () => {
    expect(dsl('SUM(a,b,d)')).toBe('sum(a, b, d)')
    expect(dsl('AVERAGE(a,b)')).toBe('avg(a, b)')
    expect(dsl('MIN(a,ABS(b))')).toBe('min(a, abs(b))')
    expect(dsl('x*70%')).toBe('x * 0.7')
    expect(dsl('x*(a)%')).toBe('x * (a / 100)')
    expect(dsl('1E-7*x')).toBe('0.0000001 * x')
  })

  it('translates IFS to nested if', () => {
    expect(dsl('_xlfn.IFS(a>10,3,a>5,2,TRUE,1)')).toBe('if(a > 10, 3, if(a > 5, 2, 1))')
    const r = translateExcelFormula('IFS(a>10,3,a>5,2)', env)
    expect(r.ok && r.dsl).toBe('if(a > 10, 3, 2)')
    expect(r.ok && r.warnings.length).toBe(1)
  })

  it('preserves Excel evaluation order with parentheses', () => {
    expect(dsl('-x^2')).toBe('(-x)^2')
    expect(dsl('2^3^2')).toBe('(2^3)^2')
    expect(dsl('a-(b-d)')).toBe('a - (b - d)')
    expect(dsl('a-b-d')).toBe('a - b - d')
    expect(dsl('a/(b*d)')).toBe('a / (b * d)')
    expect(dsl('-(a+b)')).toBe('-(a + b)')
    expect(dsl('a^-2')).toBe('a^(-2)')
  })

  it('resolves prefixed defined names to identifiers', () => {
    expect(dsl('kafka_ingress*Kafka_RF')).toBe('ingress * rf')
  })

  it('translates lookups over named Lookups tables', () => {
    expect(dsl('VLOOKUP(a,raid,2,FALSE)')).toBe('lookup(raid, a, "factor")')
    expect(dsl('VLOOKUP("RAID10",raid,3,0)')).toBe('lookup(raid, "RAID10", "min_disks")')
    expect(dsl('_xlfn.XLOOKUP(a,raid.level,raid.factor)')).toBe('lookup(raid, a, "factor")')
    expect(dsl('INDEX(raid.factor,MATCH(a,raid.level,0))')).toBe('lookup(raid, a, "factor")')
    expect(dsl('INDEX(raid,MATCH(a,raid.level,0),3)')).toBe('lookup(raid, a, "min_disks")')
  })

  it('rejects what it cannot translate faithfully', () => {
    expect(err('INDIRECT("A1")')).toMatch(/Unsupported function INDIRECT/)
    expect(err('A1*2')).toMatch(/Cell reference "A1"/)
    expect(err('Inputs!$F$2*2')).toMatch(/Cell reference/)
    expect(err('SUM(A1:A3)')).toMatch(/not supported/)
    expect(err('[1]Sheet1!A1+1')).toMatch(/External/)
    expect(err('SUM({1,2})')).toMatch(/Array constants/)
    expect(err('a&b')).toMatch(/concatenation/)
    expect(err('a<b<c')).toMatch(/Chained/)
    expect(err('IF(a>1,2)')).toMatch(/all 3 arguments/)
    expect(err('VLOOKUP(a,raid,2)')).toMatch(/exact match/)
    expect(err('VLOOKUP(a,raid,9,FALSE)')).toMatch(/column index/)
    expect(err('_xlfn.XLOOKUP(a,raid.factor,raid.level)')).toMatch(/first \(key\) column/)
    expect(err('INDEX(disks.k,MATCH(a,raid.level,0))')).toMatch(/same table/)
    expect(err('MATCH(a,raid.level,0)')).toMatch(/inside INDEX/)
    expect(err('"text"')).toMatch(/lookup keys/)
    expect(err('unknown_name*2')).toMatch(/Unknown name/)
    expect(err('raid*2')).toMatch(/only be used inside/)
    expect(err('#REF!+1')).toMatch(/Error value/)
    expect(err('x;y')).toMatch(/","/)
    expect(err('')).toMatch(/Empty/)
    expect(err('(a+b')).toMatch(/\)/)
    expect(err('RC*2')).toMatch(/Cell reference/)
    expect(err('A:A')).toMatch(/Ranges/)
    expect(err('Table1[Col]')).toMatch(/structured/)
  })
})

describe('DSL printer', () => {
  it('formats numbers without exponent notation', () => {
    expect(formatNumber(1e-7)).toBe('0.0000001')
    expect(formatNumber(1.5e-10)).toBe('0.00000000015')
    expect(formatNumber(1e21)).toBe('1000000000000000000000')
    expect(formatNumber(-2.5e22)).toBe('-25000000000000000000000')
    expect(formatNumber(116.64)).toBe('116.64')
    expect(formatNumber(-0)).toBe('0')
  })

  it('parenthesises double negation and negative literals under ^', () => {
    expect(printDsl(dNeg(dNeg(dId('x'))))).toBe('-(-x)')
    expect(printDsl(dBin('^', dNum(10), dNum(-2)))).toBe('10^(-2)')
    expect(printDsl(dBin('-', dNum(1), dNum(-2)))).toBe('1 - (-2)')
  })
})
