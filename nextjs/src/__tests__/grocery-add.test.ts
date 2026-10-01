/**
 * Issue #787: a recipe card's "Add to grocery list" (`lib/grocery-add.ts`).
 * Adding a recipe's missing items a second time must not un-tick a line the
 * user already checked off at the shop.
 */

import { addItemsToMyGroceryList } from '@/lib/grocery-add'
import { loadGroceryLines, saveGroceryLines } from '@/lib/grocery-store'
import { setLineChecked } from '@/lib/grocery'

const getUser = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: () => getUser() } }),
}))

beforeEach(() => {
  window.localStorage.clear()
  getUser.mockReset()
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
})

describe('addItemsToMyGroceryList', () => {
  it("adds the items to the signed-in user's list", async () => {
    await addItemsToMyGroceryList(['parsley', '1 lemon'])
    expect(
      loadGroceryLines('u1')
        .map((l) => l.name)
        .sort(),
    ).toEqual(['1 lemon', 'parsley'])
  })

  it('keeps a ticked item ticked when the recipe is added again, and adds the rest', async () => {
    await addItemsToMyGroceryList(['parsley', '1 lemon'])
    const parsley = loadGroceryLines('u1').find((l) => l.name === 'parsley')!
    saveGroceryLines('u1', setLineChecked(loadGroceryLines('u1'), parsley.key, true))

    await addItemsToMyGroceryList(['parsley', '1 lemon', 'thyme'])
    const lines = loadGroceryLines('u1')
    expect(lines).toHaveLength(3)
    expect(lines.find((l) => l.name === 'parsley')?.checked).toBe(true)
    expect(lines.find((l) => l.name === '1 lemon')?.checked).toBe(false)
    expect(lines.find((l) => l.name === 'thyme')?.checked).toBe(false)
  })

  it('rejects when nobody is signed in', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    await expect(addItemsToMyGroceryList(['parsley'])).rejects.toThrow(/sign in/i)
  })
})
