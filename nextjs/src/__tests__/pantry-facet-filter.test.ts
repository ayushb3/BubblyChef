import { itemMatchesFacets, isExpiringSoon, isExpired } from '@/lib/pantry-helpers'
import type { PantryFacetSelection } from '@/lib/pantry-helpers'

/**
 * Coverage for the pantry filter bar's facet-combination logic (#228):
 * OR within a facet, AND across facets, empty selection = no constraint.
 *
 * Two facets remain — category and expiry. The location facet was removed
 * with the kitchen-location field (issue #397); the first "OR within a
 * facet" case below pins that an item's stored `location` no longer takes
 * part in filtering at all.
 */
describe('itemMatchesFacets', () => {
  const emptyFacets: PantryFacetSelection = {
    categories: [],
    expiryStatuses: [],
  }

  it('matches everything when all facets are empty', () => {
    const item = { category: 'produce' }
    expect(itemMatchesFacets(item, 10, emptyFacets)).toBe(true)
    expect(itemMatchesFacets(item, null, emptyFacets)).toBe(true)
  })

  describe('OR within a facet', () => {
    it('matches if location is any of the selected values', () => {
      // #397: there is no location facet any more. Whatever the row still
      // stores in `location` is ignored — it neither matches nor excludes —
      // and the selection type has no `locations` key to express one.
      const facets: PantryFacetSelection = { ...emptyFacets, categories: ['x'] }
      for (const location of ['fridge', 'freezer', 'pantry', 'counter']) {
        // Rows are built as variables: the predicate's parameter type no
        // longer even names `location`, so a literal would not compile.
        const matchingRow = { location, category: 'x' }
        const otherCategoryRow = { location, category: 'y' }
        expect(itemMatchesFacets(matchingRow, null, facets)).toBe(true)
        expect(itemMatchesFacets(otherCategoryRow, null, facets)).toBe(false)
      }
      expect(Object.keys(emptyFacets)).toEqual(['categories', 'expiryStatuses'])
    })

    it('matches if category is any of the selected values', () => {
      const facets: PantryFacetSelection = { ...emptyFacets, categories: ['produce', 'dairy'] }
      expect(itemMatchesFacets({ category: 'produce' }, null, facets)).toBe(true)
      expect(itemMatchesFacets({ category: 'dairy' }, null, facets)).toBe(true)
      expect(itemMatchesFacets({ category: 'meat' }, null, facets)).toBe(false)
    })

    it('matches expiring-soon OR expired when both expiry options are selected', () => {
      const facets: PantryFacetSelection = { ...emptyFacets, expiryStatuses: ['expiring', 'expired'] }
      const item = { category: 'y' }
      expect(itemMatchesFacets(item, 2, facets)).toBe(true) // expiring soon
      expect(itemMatchesFacets(item, -1, facets)).toBe(true) // expired
      expect(itemMatchesFacets(item, 10, facets)).toBe(false) // fresh, neither
    })

    it('expiring soon alone does not match an expired item', () => {
      const facets: PantryFacetSelection = { ...emptyFacets, expiryStatuses: ['expiring'] }
      expect(itemMatchesFacets({ category: 'y' }, -1, facets)).toBe(false)
    })

    it('expired alone does not match a soon-expiring item', () => {
      const facets: PantryFacetSelection = { ...emptyFacets, expiryStatuses: ['expired'] }
      expect(itemMatchesFacets({ category: 'y' }, 1, facets)).toBe(false)
    })
  })

  describe('AND across facets', () => {
    it('requires location AND category AND expiry to all match', () => {
      // #397: location dropped out of the AND — category AND expiry remain.
      const facets: PantryFacetSelection = {
        categories: ['produce'],
        expiryStatuses: ['expiring'],
      }
      // Matches both.
      expect(itemMatchesFacets({ category: 'produce' }, 1, facets)).toBe(true)
      // Wrong category.
      expect(itemMatchesFacets({ category: 'dairy' }, 1, facets)).toBe(false)
      // A stored location, whatever it is, cannot exclude a row any more.
      const counterRow = { location: 'counter', category: 'produce' }
      expect(itemMatchesFacets(counterRow, 1, facets)).toBe(true)
      // Not expiring soon.
      expect(itemMatchesFacets({ category: 'produce' }, 10, facets)).toBe(false)
    })

    it('an empty facet does not constrain even when other facets are active', () => {
      const facets: PantryFacetSelection = {
        categories: [],
        expiryStatuses: ['expiring'],
      }
      expect(itemMatchesFacets({ category: 'anything-at-all' }, 1, facets)).toBe(true)
    })
  })

  it('does not introduce new expiry thresholds beyond the existing 0-3 day window', () => {
    // Pinned against the existing predicates directly, so a future edit to the
    // thresholds inside `itemMatchesFacets` without updating `isExpiringSoon`/
    // `isExpired` would fail here.
    for (const days of [-5, -1, 0, 1, 2, 3, 4, 10, null]) {
      const facets: PantryFacetSelection = { categories: [], expiryStatuses: ['expiring', 'expired'] }
      const expected = isExpiringSoon(days) || isExpired(days)
      expect(itemMatchesFacets({ category: 'y' }, days, facets)).toBe(expected)
    }
  })
})
