import { itemMatchesFacets, isExpiringSoon, isExpired } from '@/lib/pantry-helpers'
import type { PantryFacetSelection } from '@/lib/pantry-helpers'

/**
 * Coverage for the pantry filter bar's facet-combination logic (#228):
 * OR within a facet, AND across facets, empty selection = no constraint.
 */
describe('itemMatchesFacets', () => {
  const emptyFacets: PantryFacetSelection = {
    locations: [],
    categories: [],
    expiryStatuses: [],
  }

  it('matches everything when all facets are empty', () => {
    const item = { location: 'fridge', category: 'produce' }
    expect(itemMatchesFacets(item, 10, emptyFacets)).toBe(true)
    expect(itemMatchesFacets(item, null, emptyFacets)).toBe(true)
  })

  describe('OR within a facet', () => {
    it('matches if location is any of the selected values', () => {
      const facets: PantryFacetSelection = { ...emptyFacets, locations: ['fridge', 'freezer'] }
      expect(itemMatchesFacets({ location: 'fridge', category: 'x' }, null, facets)).toBe(true)
      expect(itemMatchesFacets({ location: 'freezer', category: 'x' }, null, facets)).toBe(true)
      expect(itemMatchesFacets({ location: 'counter', category: 'x' }, null, facets)).toBe(false)
    })

    it('matches if category is any of the selected values', () => {
      const facets: PantryFacetSelection = { ...emptyFacets, categories: ['produce', 'dairy'] }
      expect(itemMatchesFacets({ location: 'x', category: 'produce' }, null, facets)).toBe(true)
      expect(itemMatchesFacets({ location: 'x', category: 'dairy' }, null, facets)).toBe(true)
      expect(itemMatchesFacets({ location: 'x', category: 'meat' }, null, facets)).toBe(false)
    })

    it('matches expiring-soon OR expired when both expiry options are selected', () => {
      const facets: PantryFacetSelection = { ...emptyFacets, expiryStatuses: ['expiring', 'expired'] }
      const item = { location: 'x', category: 'y' }
      expect(itemMatchesFacets(item, 2, facets)).toBe(true) // expiring soon
      expect(itemMatchesFacets(item, -1, facets)).toBe(true) // expired
      expect(itemMatchesFacets(item, 10, facets)).toBe(false) // fresh, neither
    })

    it('expiring soon alone does not match an expired item', () => {
      const facets: PantryFacetSelection = { ...emptyFacets, expiryStatuses: ['expiring'] }
      expect(itemMatchesFacets({ location: 'x', category: 'y' }, -1, facets)).toBe(false)
    })

    it('expired alone does not match a soon-expiring item', () => {
      const facets: PantryFacetSelection = { ...emptyFacets, expiryStatuses: ['expired'] }
      expect(itemMatchesFacets({ location: 'x', category: 'y' }, 1, facets)).toBe(false)
    })
  })

  describe('AND across facets', () => {
    it('requires location AND category AND expiry to all match', () => {
      const facets: PantryFacetSelection = {
        locations: ['fridge', 'freezer'],
        categories: ['produce'],
        expiryStatuses: ['expiring'],
      }
      // Matches all three.
      expect(itemMatchesFacets({ location: 'fridge', category: 'produce' }, 1, facets)).toBe(true)
      // Wrong category.
      expect(itemMatchesFacets({ location: 'fridge', category: 'dairy' }, 1, facets)).toBe(false)
      // Wrong location.
      expect(itemMatchesFacets({ location: 'counter', category: 'produce' }, 1, facets)).toBe(false)
      // Not expiring soon.
      expect(itemMatchesFacets({ location: 'fridge', category: 'produce' }, 10, facets)).toBe(false)
    })

    it('an empty facet does not constrain even when other facets are active', () => {
      const facets: PantryFacetSelection = {
        locations: ['fridge'],
        categories: [],
        expiryStatuses: [],
      }
      expect(itemMatchesFacets({ location: 'fridge', category: 'anything-at-all' }, null, facets)).toBe(true)
    })
  })

  it('does not introduce new expiry thresholds beyond the existing 0-3 day window', () => {
    // Pinned against the existing predicates directly, so a future edit to the
    // thresholds inside `itemMatchesFacets` without updating `isExpiringSoon`/
    // `isExpired` would fail here.
    for (const days of [-5, -1, 0, 1, 2, 3, 4, 10, null]) {
      const facets: PantryFacetSelection = { locations: [], categories: [], expiryStatuses: ['expiring', 'expired'] }
      const expected = isExpiringSoon(days) || isExpired(days)
      expect(itemMatchesFacets({ location: 'x', category: 'y' }, days, facets)).toBe(expected)
    }
  })
})
