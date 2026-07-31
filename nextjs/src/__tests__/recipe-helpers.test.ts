import { mergeTags } from '@/lib/recipe-helpers'

describe('mergeTags', () => {
  it('returns an empty array when both inputs are absent', () => {
    expect(mergeTags(undefined, undefined)).toEqual([])
  })

  it('returns tags when only tags are provided', () => {
    expect(mergeTags(['vegan', 'gluten-free'], undefined)).toEqual(['vegan', 'gluten-free'])
  })

  it('returns dietary_tags when only dietary_tags are provided', () => {
    expect(mergeTags(undefined, ['vegetarian', 'dairy-free'])).toEqual(['vegetarian', 'dairy-free'])
  })

  it('merges both arrays with tags first', () => {
    expect(mergeTags(['vegan'], ['gluten-free'])).toEqual(['vegan', 'gluten-free'])
  })

  it('deduplicates exact duplicates across both arrays', () => {
    expect(mergeTags(['vegan', 'gluten-free'], ['gluten-free', 'dairy-free'])).toEqual([
      'vegan',
      'gluten-free',
      'dairy-free',
    ])
  })

  it('deduplicates case-insensitively, keeping first occurrence', () => {
    // "Vegan" in dietary_tags should not appear if "vegan" is already in tags
    expect(mergeTags(['vegan'], ['Vegan', 'Gluten-Free'])).toEqual(['vegan', 'Gluten-Free'])
  })

  it('handles null values the same as undefined', () => {
    expect(mergeTags(null, null)).toEqual([])
    expect(mergeTags(['vegan'], null)).toEqual(['vegan'])
    expect(mergeTags(null, ['dairy-free'])).toEqual(['dairy-free'])
  })

  it('preserves order of unique tags from both arrays', () => {
    const result = mergeTags(['a', 'b'], ['c', 'a', 'd'])
    expect(result).toEqual(['a', 'b', 'c', 'd'])
  })
})
