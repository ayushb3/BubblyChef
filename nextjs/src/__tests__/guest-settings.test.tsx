/**
 * Settings work for guests (issue #914): a guest (anonymous session) used to have
 * no user_profiles row, so dietary preferences, allergies/dislikes and expiry
 * priority all refused to save ("Create an account to ..."). The profile page now
 * creates the guest's row, so those controls get a real profileId.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ensureProfile } from '@/lib/profile-ensure'

function fakeSupabase(opts: { insertResult: { data: unknown; error: unknown } }) {
  const insert = jest.fn(() => ({
    select: () => ({ single: async () => opts.insertResult }),
  }))
  return { client: { from: jest.fn(() => ({ insert })) }, insert }
}

describe('ensureProfile', () => {
  it('creates an email-less profile row for a guest and returns its id', async () => {
    const { client, insert } = fakeSupabase({ insertResult: { data: { id: 'p1' }, error: null } })
    const row = await ensureProfile(client as never, { id: 'abcdef12-0000' })
    expect(row?.id).toBe('p1')
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'abcdef12-0000', username: 'guest-abcdef12', email: null }),
    )
  })

  it('returns null (not a throw) when the insert fails', async () => {
    const { client } = fakeSupabase({ insertResult: { data: null, error: { message: 'boom' } } })
    expect(await ensureProfile(client as never, { id: 'abcdef12-0000' })).toBeNull()
  })
})

const getUser = jest.fn()
const single = jest.fn()
const insertSingle = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({ eq: () => ({ single }) }),
      insert: () => ({ select: () => ({ single: insertSingle }) }),
    }),
  }),
}))
jest.mock('@/components/auth/SaveAccountBanner', () => ({ __esModule: true, default: () => <div /> }))
jest.mock('@/components/auth/SignOutButton', () => ({ __esModule: true, default: () => <button>Sign out</button> }))
jest.mock('@/components/profile/DisplayNameField', () => ({ __esModule: true, default: () => <p /> }))
jest.mock('@/components/profile/TakeTourButton', () => ({ __esModule: true, default: () => <button /> }))
jest.mock('@/components/profile/SetUpStaplesButton', () => ({ __esModule: true, default: () => <button /> }))
jest.mock('@/components/ui/ThemePicker', () => ({ __esModule: true, default: () => <div /> }))

import ProfilePage from '@/app/profile/page'

async function renderProfile() {
  const jsx = await ProfilePage()
  render(<QueryClientProvider client={new QueryClient()}>{jsx}</QueryClientProvider>)
}

describe('ProfilePage for a guest', () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: 'abcdef12-0000', email: null, is_anonymous: true } } })
    single.mockResolvedValue({ data: null })
    insertSingle.mockResolvedValue({ data: { id: 'p1', dietary_preferences: [] }, error: null })
  })
  afterEach(() => jest.clearAllMocks())

  it('creates the guest profile row when missing', async () => {
    await renderProfile()
    expect(insertSingle).toHaveBeenCalledTimes(1)
  })

  it('still hides Sign out (an account action)', async () => {
    await renderProfile()
    expect(screen.queryByText('Sign out')).not.toBeInTheDocument()
  })

  it('does not insert for a user who already has a row', async () => {
    single.mockResolvedValue({ data: { id: 'p9', dietary_preferences: [] } })
    await renderProfile()
    expect(insertSingle).not.toHaveBeenCalled()
  })
})
