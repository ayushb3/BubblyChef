/**
 * `expiryBadge` — the badge shown on each pantry grid card (`/pantry`).
 *
 * #182: adds a subtle "(est.)" marker when the underlying expiry date is a
 * heuristic guess rather than one read from a receipt/label or entered by
 * hand. Cosmetic only — must never change the badge's colour/urgency tier or
 * the day count itself.
 */
import { expiryBadge } from '@/app/pantry/page'

describe('expiryBadge', () => {
  it('returns nothing for an undated item', () => {
    expect(expiryBadge(null)).toBeNull()
  })

  it('does not show a marker by default or when estimated_expiry is false', () => {
    expect(expiryBadge(3)?.label).toBe('3d left')
    expect(expiryBadge(3, false)?.label).toBe('3d left')
  })

  it('shows the marker when estimated_expiry is true, without changing colour', () => {
    const badge = expiryBadge(3, true)
    expect(badge?.label).toBe('3d left (est.)')
    expect(badge?.color).toBe(expiryBadge(3, false)?.color)
  })

  it('marks the expired and today variants too', () => {
    expect(expiryBadge(-1, true)?.label).toBe('Expired (est.)')
    expect(expiryBadge(0, true)?.label).toBe('Today (est.)')
  })
})
