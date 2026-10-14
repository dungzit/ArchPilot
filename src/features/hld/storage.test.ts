import { describe, expect, it } from 'vitest'
import { emptyStored, loadHldState, loadLastDesign, sanitiseStored, saveHldState, storageKey } from './storage'

describe('HLD storage', () => {
  it('keeps only known, well-typed fields from whatever is stored', () => {
    expect(sanitiseStored({
      meta: { customer: 'ABC', version: 2, evil: 'x' },
      language: 'fr',
      manual: { intro: 'Hi', security: null, bogus: 'x' },
      sections: { sizing: false, rollout: 'no', unknown: false },
      excludedRuns: ['run_1', 7],
      excludedPins: 'pin_1',
    })).toEqual({ meta: { customer: 'ABC' }, manual: { intro: 'Hi' }, sections: { sizing: false }, excludedRuns: ['run_1'], excludedPins: [] })
    expect(sanitiseStored(null)).toEqual(emptyStored())
    expect(sanitiseStored('[]')).toEqual(emptyStored())
  })

  it('never throws without a browser (node: no localStorage)', () => {
    expect(storageKey('dsg_1')).toBe('archpilot.hld.dsg_1')
    expect(loadHldState('dsg_1')).toEqual(emptyStored())
    expect(saveHldState('dsg_1', emptyStored())).toBe(false)
    expect(loadLastDesign()).toBeNull()
  })
})
