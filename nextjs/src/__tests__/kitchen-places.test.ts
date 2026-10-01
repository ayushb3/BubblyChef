/**
 * The storage-places module (issue #748): the stored-location -> place mapping
 * and the per-place counts the kitchen wall shows. Pure, with `today` injected.
 */
import {
  PLACES,
  PLACE_KEYS,
  emptyPlaceSummaries,
  placeAccessibleName,
  placeDef,
  placeForLocation,
  summarizePlaces,
} from '@/lib/kitchen/places'

const TODAY = '2026-10-01'

describe('placeForLocation', () => {
  it.each([
    ['fridge', 'fridge'],
    ['freezer', 'freezer'],
    ['pantry', 'shelves'],
    ['counter', 'basket'],
  ])('maps the stored location %s to the %s place', (location, place) => {
    expect(placeForLocation(location)).toBe(place)
  })

  it('sends an unknown location to Shelves', () => {
    expect(placeForLocation('garage')).toBe('shelves')
    expect(placeForLocation('cupboard')).toBe('shelves')
  })

  it('sends a missing, null or empty location to Shelves', () => {
    expect(placeForLocation(undefined)).toBe('shelves')
    expect(placeForLocation(null)).toBe('shelves')
    expect(placeForLocation('')).toBe('shelves')
  })

  it('ignores case and surrounding whitespace', () => {
    expect(placeForLocation('  Fridge ')).toBe('fridge')
    expect(placeForLocation('FREEZER')).toBe('freezer')
  })
})

describe('PLACES', () => {
  it('is the four places in wall order, one per stored location', () => {
    expect(PLACE_KEYS).toEqual(['fridge', 'freezer', 'shelves', 'basket'])
    expect(PLACES.map((p) => p.location)).toEqual(['fridge', 'freezer', 'pantry', 'counter'])
    expect(PLACES.map((p) => p.label)).toEqual(['Fridge', 'Freezer', 'Shelves', 'Basket'])
  })

  it('looks every key up', () => {
    for (const key of PLACE_KEYS) expect(placeDef(key).key).toBe(key)
  })
})

describe('summarizePlaces', () => {
  it('is zero everywhere for an empty pantry', () => {
    const s = summarizePlaces([], TODAY)
    expect(s).toEqual(emptyPlaceSummaries())
    for (const key of PLACE_KEYS) {
      expect(s[key].count).toBe(0)
      expect(s[key].useSoonCount).toBe(0)
    }
  })

  it('counts rows per place', () => {
    const s = summarizePlaces(
      [
        { location: 'fridge' },
        { location: 'fridge' },
        { location: 'freezer' },
        { location: 'pantry' },
        { location: 'pantry' },
        { location: 'pantry' },
        { location: 'counter' },
      ],
      TODAY,
    )
    expect(s.fridge.count).toBe(2)
    expect(s.freezer.count).toBe(1)
    expect(s.shelves.count).toBe(3)
    expect(s.basket.count).toBe(1)
  })

  it('puts rows with an unknown or missing location on the Shelves, so the counts add up', () => {
    const items = [
      { location: 'fridge' },
      { location: 'garage' },
      { location: null },
      {},
      { location: '' },
    ]
    const s = summarizePlaces(items, TODAY)
    expect(s.fridge.count).toBe(1)
    expect(s.shelves.count).toBe(4)
    const total = PLACE_KEYS.reduce((n, k) => n + s[k].count, 0)
    expect(total).toBe(items.length)
  })

  it('counts a row as use soon when it is expired or expires within 3 days', () => {
    const s = summarizePlaces(
      [
        { location: 'fridge', expiry_date: '2026-09-28' }, // expired
        { location: 'fridge', expiry_date: '2026-10-01' }, // today
        { location: 'fridge', expiry_date: '2026-10-04' }, // in 3 days
        { location: 'fridge', expiry_date: '2026-10-05' }, // in 4 days: not yet
        { location: 'fridge', expiry_date: null }, // no date
        { location: 'fridge' }, // no date
      ],
      TODAY,
    )
    expect(s.fridge.count).toBe(6)
    expect(s.fridge.useSoonCount).toBe(3)
  })

  it('keeps use-soon counts per place', () => {
    const s = summarizePlaces(
      [
        { location: 'fridge', expiry_date: '2026-10-02' },
        { location: 'pantry', expiry_date: '2026-10-02' },
        { location: 'pantry', expiry_date: '2027-01-01' },
      ],
      TODAY,
    )
    expect(s.fridge.useSoonCount).toBe(1)
    expect(s.shelves.useSoonCount).toBe(1)
    expect(s.freezer.useSoonCount).toBe(0)
    expect(s.basket.useSoonCount).toBe(0)
  })
})

describe('placeAccessibleName', () => {
  it('reads name, items and how many to use soon', () => {
    expect(placeAccessibleName('Fridge', { count: 23, useSoonCount: 3 })).toBe(
      'Fridge, 23 items, 3 to use soon',
    )
  })

  it('drops the use-soon clause when there is none', () => {
    expect(placeAccessibleName('Shelves', { count: 31, useSoonCount: 0 })).toBe('Shelves, 31 items')
  })

  it('says "1 item" in the singular', () => {
    expect(placeAccessibleName('Basket', { count: 1, useSoonCount: 0 })).toBe('Basket, 1 item')
  })

  it('says "empty" for a place with nothing in it', () => {
    expect(placeAccessibleName('Freezer', { count: 0, useSoonCount: 0 })).toBe('Freezer, empty')
  })

  it('is just the name while the pantry is unknown, never a made-up zero', () => {
    expect(placeAccessibleName('Fridge', null)).toBe('Fridge')
  })
})
