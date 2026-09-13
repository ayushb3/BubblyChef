import { isGuestUser } from '@/lib/auth/guest'
import type { User } from '@supabase/supabase-js'

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as User
}

describe('isGuestUser', () => {
  it('is true for an anonymous Supabase user', () => {
    expect(isGuestUser(makeUser({ is_anonymous: true }))).toBe(true)
  })

  it('is false for a real, confirmed user', () => {
    expect(isGuestUser(makeUser({ is_anonymous: false }))).toBe(false)
  })

  it('is false when is_anonymous is missing (older SDK/session shape)', () => {
    expect(isGuestUser(makeUser())).toBe(false)
  })

  it('is false for null/undefined (no session)', () => {
    expect(isGuestUser(null)).toBe(false)
    expect(isGuestUser(undefined)).toBe(false)
  })
})
