import { titleCase } from '@/lib/format'

describe('titleCase', () => {
  it('capitalises each word of a multi-word food name', () => {
    expect(titleCase('cheddar cheese')).toBe('Cheddar Cheese')
  })

  it('capitalises a single-word name', () => {
    expect(titleCase('eggs')).toBe('Eggs')
  })

  it('capitalises olive oil', () => {
    expect(titleCase('olive oil')).toBe('Olive Oil')
  })

  it('preserves all-uppercase abbreviations like BBQ', () => {
    expect(titleCase('BBQ sauce')).toBe('BBQ Sauce')
  })

  it('handles already title-cased input idempotently', () => {
    expect(titleCase('Whole Milk')).toBe('Whole Milk')
  })

  it('collapses internal whitespace', () => {
    expect(titleCase('brown  sugar')).toBe('Brown Sugar')
  })

  it('trims leading and trailing whitespace', () => {
    expect(titleCase('  garlic  ')).toBe('Garlic')
  })

  it('lower-cases the rest of a word', () => {
    expect(titleCase('BUTTER')).toBe('BUTTER') // all-caps — preserved as abbreviation
    expect(titleCase('bUTTER')).toBe('Butter')  // mixed — normalised
  })

  it('handles empty string gracefully', () => {
    expect(titleCase('')).toBe('')
  })
})
