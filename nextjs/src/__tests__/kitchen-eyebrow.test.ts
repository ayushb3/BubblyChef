/**
 * The kitchen header's "<Weekday> <part of day>" eyebrow (issue #748).
 */
import { kitchenEyebrow, partOfDay } from '@/lib/kitchen/eyebrow'

describe('partOfDay', () => {
  it.each([
    [4, 'night'],
    [5, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [16, 'afternoon'],
    [17, 'evening'],
    [20, 'evening'],
    [21, 'night'],
    [23, 'night'],
    [0, 'night'],
  ])('hour %i is %s', (hour, expected) => {
    expect(partOfDay(hour)).toBe(expected)
  })
})

describe('kitchenEyebrow', () => {
  it('reads the weekday and part of day in the clock it is given', () => {
    // 2026-09-29 is a Tuesday.
    expect(kitchenEyebrow(new Date(2026, 8, 29, 18, 30))).toBe('Tuesday evening')
    expect(kitchenEyebrow(new Date(2026, 8, 29, 8, 0))).toBe('Tuesday morning')
    expect(kitchenEyebrow(new Date(2026, 8, 29, 14, 0))).toBe('Tuesday afternoon')
    expect(kitchenEyebrow(new Date(2026, 8, 29, 23, 30))).toBe('Tuesday night')
  })
})
