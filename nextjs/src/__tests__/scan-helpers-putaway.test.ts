/**
 * Put-away's item helpers (issue #753): the place an item is headed to, how its
 * quantity reads on the card, and the store name read off the receipt text.
 */
import {
  guessStoreName,
  scanItemPlace,
  scanQuantityLabel,
  scannedToBulkAddItem,
  withScanPlace,
  type ScannedItemWithId,
} from '@/lib/scan-helpers'

function scanned(over: Partial<ScannedItemWithId> = {}): ScannedItemWithId {
  return {
    _id: 'a',
    name: 'Green peppers',
    original_name: 'grn pep',
    source_line: 'GRN PEP 2 @ 0.89',
    price: 0.89,
    quantity: 2,
    unit: 'item',
    category: 'produce',
    location: 'fridge',
    confidence: 0.6,
    ...over,
  }
}

describe('scanItemPlace', () => {
  it.each([
    ['fridge', 'fridge'],
    ['freezer', 'freezer'],
    ['pantry', 'shelves'],
    ['counter', 'basket'],
    ['garage', 'shelves'],
    ['', 'shelves'],
  ])('%s is headed to %s', (location, place) => {
    expect(scanItemPlace(scanned({ location }))).toBe(place)
  })
})

describe('withScanPlace', () => {
  it('moves the item by writing the stored location of the place', () => {
    expect(withScanPlace(scanned(), 'freezer').location).toBe('freezer')
    expect(withScanPlace(scanned(), 'shelves').location).toBe('pantry')
    expect(withScanPlace(scanned(), 'basket').location).toBe('counter')
  })
})

describe('the write', () => {
  it('saves each item with the place it is displayed under, even for an unknown location', () => {
    expect(scannedToBulkAddItem(scanned({ location: 'garage' })).storage_location).toBe('pantry')
    expect(scannedToBulkAddItem(scanned({ location: 'Counter' })).storage_location).toBe('counter')
  })
})

describe('scanQuantityLabel', () => {
  it('is the bare number for a plain item, the number and unit otherwise', () => {
    expect(scanQuantityLabel(scanned({ quantity: 2, unit: 'item' }))).toBe('2')
    expect(scanQuantityLabel(scanned({ quantity: 1, unit: 'box' }))).toBe('1 box')
    expect(scanQuantityLabel(scanned({ quantity: 0.5, unit: 'lb' }))).toBe('0.5 lb')
    expect(scanQuantityLabel(scanned({ quantity: 3, unit: '' }))).toBe('3')
  })
})

describe('guessStoreName', () => {
  it('reads the first line of the receipt and tidies the capitals', () => {
    expect(guessStoreName("TRADER JOE'S\nMILK 4.29")).toBe("Trader Joe's")
    expect(guessStoreName('Grocery Mart\nEggs 12ct $3.49')).toBe('Grocery Mart')
  })

  it('skips blank lines at the top', () => {
    expect(guessStoreName('\n\n  WHOLE FOODS  \nMILK 4.29')).toBe('Whole Foods')
  })

  it('gives up rather than guess when the first line is not a name', () => {
    expect(guessStoreName('')).toBeNull()
    expect(guessStoreName('MILK 4.29\nEGGS 3.99')).toBeNull()
    expect(guessStoreName('10/01/2026 18:32')).toBeNull()
    expect(guessStoreName('Thank you for shopping')).toBeNull()
    expect(guessStoreName('x')).toBeNull()
  })
})
