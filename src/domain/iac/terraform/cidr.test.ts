import { describe, expect, it } from 'vitest'
import { cidrsubnet, contains, formatCidr, overlaps, parseCidr } from './cidr'

describe('parseCidr', () => {
  it('parses valid IPv4 CIDRs', () => {
    expect(parseCidr('10.0.0.0/16')).toEqual({ base: 0x0a000000, prefix: 16, hostBitsSet: false })
    expect(parseCidr('0.0.0.0/0')).toEqual({ base: 0, prefix: 0, hostBitsSet: false })
    expect(parseCidr('255.255.255.255/32')?.base).toBe(0xffffffff)
  })

  it('flags host bits', () => {
    expect(parseCidr('10.0.0.1/16')).toEqual({ base: 0x0a000000, prefix: 16, hostBitsSet: true })
  })

  it.each(['10.0.0.0', '10.0.0/16', '10.0.0.256/24', '10.0.0.0/33', '010.0.0.0/8', '10.0.0.0/08', 'a.b.c.d/8', ' 10.0.0.0/8', '10.0.0.0/-1', '::/0', ''])(
    'rejects %j', (text) => {
      expect(parseCidr(text)).toBeUndefined()
    },
  )
})

describe('maths', () => {
  const vpc = parseCidr('10.0.0.0/16')!
  it('contains and overlaps', () => {
    expect(contains(vpc, parseCidr('10.0.4.0/22')!)).toBe(true)
    expect(contains(vpc, parseCidr('10.1.0.0/24')!)).toBe(false)
    expect(contains(vpc, parseCidr('10.0.0.0/8')!)).toBe(false)
    expect(overlaps(parseCidr('10.0.0.0/22')!, parseCidr('10.0.3.0/24')!)).toBe(true)
    expect(overlaps(parseCidr('10.0.0.0/22')!, parseCidr('10.0.4.0/24')!)).toBe(false)
  })

  it('cidrsubnet matches Terraform', () => {
    // terraform console: cidrsubnet("10.0.4.0/22", 2, 3) = "10.0.7.0/24"
    expect(formatCidr(cidrsubnet(parseCidr('10.0.4.0/22')!, 2, 3))).toBe('10.0.7.0/24')
    expect(formatCidr(cidrsubnet(parseCidr('10.0.0.0/16')!, 8, 255))).toBe('10.0.255.0/24')
    expect(() => cidrsubnet(parseCidr('10.0.0.0/30')!, 4, 0)).toThrow(RangeError)
    expect(() => cidrsubnet(parseCidr('10.0.0.0/24')!, 2, 4)).toThrow(RangeError)
  })

  it('formats round-trip', () => {
    for (const text of ['10.20.1.0/24', '192.168.0.0/16', '172.16.32.0/20']) expect(formatCidr(parseCidr(text)!)).toBe(text)
  })
})
