/**
 * The Pantry tab is gone (issue #750); its addresses are not. Each old address
 * must still land somewhere sensible: the kitchen home, with the storage sheet
 * open in List view (and the add sheet or the expiry filter where the old
 * address meant that).
 */
import PantryPage from '@/app/pantry/page'
import UseSoonPage from '@/app/pantry/use-soon/page'

const redirectMock = jest.fn((url: string) => {
  // Next's `redirect` throws to stop rendering; mirror that.
  throw new Error(`NEXT_REDIRECT ${url}`)
})
jest.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

type SearchParams = Record<string, string | string[] | undefined>
type Page = (props: { searchParams: Promise<SearchParams> }) => unknown

async function landing(page: Page, params: SearchParams = {}) {
  redirectMock.mockClear()
  await expect(
    Promise.resolve().then(() => page({ searchParams: Promise.resolve(params) })),
  ).rejects.toThrow(/NEXT_REDIRECT/)
  expect(redirectMock).toHaveBeenCalledTimes(1)
  return redirectMock.mock.calls[0][0] as string
}

function parse(href: string) {
  const url = new URL(href, 'http://localhost')
  return { path: url.pathname, params: Object.fromEntries(url.searchParams) }
}

describe('/pantry', () => {
  it('redirects to home with the storage sheet open in List view', async () => {
    const { path, params } = parse(await landing(PantryPage))
    expect(path).toBe('/')
    expect(params).toEqual({ place: 'fridge', view: 'list' })
  })

  it('/pantry?add=scan still opens the add sheet on its scan tab', async () => {
    const { path, params } = parse(await landing(PantryPage, { add: 'scan' }))
    expect(path).toBe('/')
    expect(params).toEqual({ add: 'scan' })
  })

  it('/pantry?add=type still opens the add sheet on its type tab', async () => {
    const { params } = parse(await landing(PantryPage, { add: 'type' }))
    expect(params).toEqual({ add: 'type' })
  })

  it('ignores an unknown add value and falls back to the List', async () => {
    const { params } = parse(await landing(PantryPage, { add: 'nonsense' }))
    expect(params).toEqual({ place: 'fridge', view: 'list' })
  })
})

describe('/pantry/use-soon', () => {
  it('opens the List with the expiry filter on', async () => {
    const { path, params } = parse(await landing(UseSoonPage))
    expect(path).toBe('/')
    expect(params).toEqual({ place: 'fridge', view: 'list', expiry: 'expiring,expired' })
  })
})
