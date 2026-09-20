/**
 * Shared pantry vocabulary.
 *
 * The storage-location list used to be declared three times — in the edit
 * modal (as `{ value, label }`, exported for the pantry filter bar's location
 * facet, #228), in the manual add row (same shape, a private copy) and in the
 * scan review card (as a bare `string[]`). Three hand-typed copies of the same
 * four values are how they drift apart from each other and from the food
 * catalog's `default_location` (issue #478). This is the one source;
 * everything that renders or filters by location reads from here.
 *
 * The `value`s are the strings stored in `pantry_items.location` and returned
 * by the food catalog's `default_location`, so they must not change without a
 * migration.
 */

export const LOCATIONS = [
  { value: 'fridge', label: 'Fridge' },
  { value: 'freezer', label: 'Freezer' },
  { value: 'pantry', label: 'Pantry' },
  { value: 'counter', label: 'Counter' },
] as const

/** One of the stored location strings (`'fridge' | 'freezer' | ...`). */
export type PantryLocation = (typeof LOCATIONS)[number]['value']

/**
 * Bare stored values, for callers that only need the strings (e.g. a plain
 * `<select>` that shows the raw value). Derived, never hand-typed, so it
 * cannot disagree with `LOCATIONS`.
 */
export const LOCATION_VALUES: readonly PantryLocation[] = LOCATIONS.map((l) => l.value)

/** Where an item goes when nothing better is known. */
export const DEFAULT_LOCATION: PantryLocation = 'pantry'
