/**
 * Issue #495 — Spec B.3 cooking timers. `parseDurations` is the pure
 * function step ⏱ chips are built on: it must find a duration phrase
 * wherever one exists in a step's free text, and never throw on text that
 * has none.
 */

import { parseDurations, formatDuration, deriveStepLabel } from '@/lib/timers'

describe('parseDurations', () => {
  it('parses "15 min"', () => {
    expect(parseDurations('Simmer for 15 min, stirring occasionally.')).toEqual([
      { label: '15 min', seconds: 900 },
    ])
  })

  it('parses "15 minutes"', () => {
    expect(parseDurations('Bake for 15 minutes until golden.')).toEqual([
      { label: '15 min', seconds: 900 },
    ])
  })

  it('parses "1 hour"', () => {
    expect(parseDurations('Let the dough rest for 1 hour.')).toEqual([
      { label: '1 hr', seconds: 3600 },
    ])
  })

  it('parses a range "1–2 hours" using the lower bound and naming the range', () => {
    const result = parseDurations('Marinate for 1–2 hours in the fridge.')
    expect(result).toHaveLength(1)
    expect(result[0].seconds).toBe(3600)
    expect(result[0].label).toContain('1 hr')
    expect(result[0].label).toContain('1–2 hr')
  })

  it('parses a hyphen range "1-2 hours" the same as an en dash', () => {
    const result = parseDurations('Marinate for 1-2 hours.')
    expect(result[0].seconds).toBe(3600)
  })

  it('parses a "to" range "15 to 20 minutes"', () => {
    const result = parseDurations('Roast for 15 to 20 minutes.')
    expect(result[0].seconds).toBe(900)
  })

  it('parses "45 seconds"', () => {
    expect(parseDurations('Microwave for 45 seconds.')).toEqual([
      { label: '45 sec', seconds: 45 },
    ])
  })

  it('parses "an hour"', () => {
    expect(parseDurations('Chill for an hour before serving.')).toEqual([
      { label: '1 hr', seconds: 3600 },
    ])
  })

  it('parses "a minute"', () => {
    expect(parseDurations('Whisk for a minute.')).toEqual([{ label: '1 min', seconds: 60 }])
  })

  it('finds multiple durations in one step', () => {
    const result = parseDurations('Simmer for 10 minutes, then rest for 5 minutes.')
    expect(result).toHaveLength(2)
    expect(result.map((d) => d.seconds)).toEqual([600, 300])
  })

  it('returns an empty array for text with no duration', () => {
    expect(parseDurations('Season with salt and pepper to taste.')).toEqual([])
  })

  it('returns an empty array for empty text', () => {
    expect(parseDurations('')).toEqual([])
  })

  it('ignores a zero-length duration', () => {
    expect(parseDurations('Rest for 0 minutes.')).toEqual([])
  })
})

describe('formatDuration', () => {
  it('formats sub-minute seconds as 0:ss', () => {
    expect(formatDuration(45)).toBe('0:45')
  })

  it('formats minutes as m:ss', () => {
    expect(formatDuration(900)).toBe('15:00')
  })

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatDuration(3661)).toBe('1:01:01')
  })

  it('clamps negative input to zero', () => {
    expect(formatDuration(-5)).toBe('0:00')
  })
})

describe('deriveStepLabel', () => {
  it('takes the clause up to the first comma', () => {
    expect(deriveStepLabel('Simmer sauce, stirring occasionally for 15 minutes.')).toBe(
      'Simmer sauce',
    )
  })

  it('caps at 6 words when there is no punctuation', () => {
    expect(deriveStepLabel('Whisk the eggs together with the sugar and vanilla until pale')).toBe(
      'Whisk the eggs together with the',
    )
  })

  it('falls back to "Step" for empty text', () => {
    expect(deriveStepLabel('')).toBe('Step')
  })
})
