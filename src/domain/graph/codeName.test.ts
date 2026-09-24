import { describe, expect, it } from 'vitest'
import { foldDiacritics, foldForSearch, isValidCodeName, slugify, toCodeName, uniqueCodeName } from './codeName'

describe('Vietnamese folding (review m4)', () => {
  it.each([
    ['Đơn hàng', 'Don hang'],
    ['ĐƠN HÀNG', 'DON HANG'],
    ['đường dẫn', 'duong dan'],
    ['Người dùng', 'Nguoi dung'],
    ['Ảnh sản phẩm', 'Anh san pham'],
    ['Cổng thanh toán', 'Cong thanh toan'],
  ])('%s -> %s', (input, expected) => {
    expect(foldDiacritics(input)).toBe(expected)
  })

  it('NFD input (as macOS can produce) folds exactly like NFC input', () => {
    const nfc = 'Đơn hàng Ảnh'
    const nfd = nfc.normalize('NFD')
    expect(nfd).not.toBe(nfc)
    expect(foldDiacritics(nfd)).toBe(foldDiacritics(nfc))
    expect(toCodeName(nfd, 'service')).toBe(toCodeName(nfc, 'service'))
  })

  it('search folding lower-cases and collapses whitespace', () => {
    expect(foldForSearch('  Cân   Bằng Tải ')).toBe(' can bang tai ')
  })
})

describe('code names (REQ-DES-008)', () => {
  it.each([
    ['Orders API', 'service', 'orders_api'],
    ['Đơn hàng (Postgres)', 'relational_db', 'don_hang_postgres'],
    ['  --Web  LB--  ', 'load_balancer', 'web_lb'],
    ['3rd-party fraud check', 'external_service', 'external_service_3rd_party_fraud_check'],
    ['***', 'cache', 'cache'],
    ['', 'note', 'note'],
    ['日本語', 'service', 'service'],
  ])('%j on %s -> %s', (label, role, expected) => {
    expect(toCodeName(label, role)).toBe(expected)
    expect(isValidCodeName(expected)).toBe(true)
  })

  it('never exceeds 40 characters and never ends with an underscore', () => {
    const name = toCodeName('a'.repeat(39) + ' b c d', 'service')
    expect(name.length).toBeLessThanOrEqual(40)
    expect(name.endsWith('_')).toBe(false)
    expect(isValidCodeName(name)).toBe(true)
  })

  it('refuses a fallback that is not itself a valid code name', () => {
    expect(() => toCodeName('x', 'Bad Fallback')).toThrow(/not valid/)
  })

  it('uniqueness adds _2, _3 and still fits in 40 characters', () => {
    const taken = new Set(['orders', 'orders_2'])
    expect(uniqueCodeName('orders', taken)).toBe('orders_3')
    expect(uniqueCodeName('fresh', taken)).toBe('fresh')
    const long = 'x'.repeat(40)
    const unique = uniqueCodeName(long, new Set([long]))
    expect(unique).toBe(`${'x'.repeat(38)}_2`)
    expect(isValidCodeName(unique)).toBe(true)
  })

  it('slugify keeps digits and drops everything else', () => {
    expect(slugify('Tier-2 / zone A')).toBe('tier_2_zone_a')
  })

  it.each(['Orders', '1abc', 'a-b', '', 'a'.repeat(41), 'đơn'])('%j is not a valid code name', (value) => {
    expect(isValidCodeName(value)).toBe(false)
  })
})
