import { strFromU8, unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { assertSafePath, buildZip, ZipPathError, zipMtime } from './zip'

const allowed = ['main.tf', 'README.md', '.gitignore', '.github/workflows/terraform.yml']
const files = [{ path: 'main.tf', content: 'x\n' }, { path: 'README.md', content: '# r\n' }, { path: '.gitignore', content: '.terraform/\n' }]
const originalTz = process.env.TZ

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

/** DOS date/time fields of every local file header. */
function dosStamps(zip: Uint8Array): { date: number; time: number }[] {
  const out: { date: number; time: number }[] = []
  for (let i = 0; i + 4 <= zip.length; i += 1) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x03 && zip[i + 3] === 0x04) {
      out.push({ time: zip[i + 10] | (zip[i + 11] << 8), date: zip[i + 12] | (zip[i + 13] << 8) })
    }
  }
  return out
}

describe('path guard (design-v2 4.4.11)', () => {
  it.each(['../x', '/etc/passwd', 'a\\b', 'a/../b', './a', 'a b', 'ü.tf', '', 'x'.repeat(201), 'not-declared.tf', 'a//b'])('refuses %j', (path) => {
    expect(() => assertSafePath(path, new Set(allowed))).toThrow(ZipPathError)
  })

  it('accepts declared, safe paths', () => {
    for (const path of allowed) expect(() => assertSafePath(path, new Set(allowed))).not.toThrow()
  })

  it('refuses unsafe root folders and duplicate roots', () => {
    expect(() => buildZip([{ root: '../x', files, allowed }])).toThrow(ZipPathError)
    expect(() => buildZip([{ root: 'Orders', files, allowed }])).toThrow(ZipPathError)
    expect(() => buildZip([{ root: 'a', files, allowed }, { root: 'a', files, allowed }])).toThrow(/twice/)
  })
})

describe('deterministic zip', () => {
  it('sorted entries, one root folder per profile, stable bytes, fixed 2000-01-01 00:00 stamp', () => {
    const zip = buildZip([{ root: 'b-root', files, allowed }, { root: 'a-root', files: [...files].reverse(), allowed }])
    expect(Object.keys(unzipSync(zip))).toEqual([
      'a-root/.gitignore', 'a-root/README.md', 'a-root/main.tf', 'b-root/.gitignore', 'b-root/README.md', 'b-root/main.tf',
    ])
    expect(strFromU8(unzipSync(zip)['a-root/main.tf'])).toBe('x\n')
    expect(buildZip([{ root: 'b-root', files, allowed }, { root: 'a-root', files, allowed }])).toEqual(zip)
    // DOS date: (2000 - 1980) << 9 | 1 << 5 | 1 = 10273; time 0.
    expect(dosStamps(zip)).toEqual(Array(6).fill({ date: 10273, time: 0 }))
  })

  it('TC-DET-TZ: identical bytes in UTC, Ho Chi Minh City, Los Angeles and the date-line extremes (never throws west of UTC)', () => {
    const zones = ['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Etc/GMT+12']
    const offsets = new Set<number>()
    const hashes = new Set<string>()
    for (const zone of zones) {
      process.env.TZ = zone
      offsets.add(new Date(2000, 0, 1).getTimezoneOffset())
      expect(zipMtime().getFullYear()).toBe(2000)
      hashes.add(Buffer.from(buildZip([{ root: 'r', files, allowed }])).toString('base64'))
    }
    // Guard: the TZ switch really took effect in this runtime, so the test is not vacuous.
    expect(offsets.size).toBeGreaterThan(1)
    expect(hashes.size).toBe(1)
  })
})
