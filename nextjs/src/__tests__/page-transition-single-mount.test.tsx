/**
 * Issue #679 — a client navigation into a seeded `/chat` sent the seed twice.
 *
 * Cause: `PageTransition` wrapped the page in `<AnimatePresence mode="wait">`
 * with an `exit`. In the App Router `children` is a router slot that renders
 * whatever route is *current*, so the exiting wrapper (keyed by the old
 * pathname) rendered the NEW page too. That mounted `ChatSurface` #1 (its seed
 * effect sent), and after the 200 ms exit the new keyed wrapper mounted
 * `ChatSurface` #2 with fresh refs (it sent again).
 *
 * This suite renders the REAL `PageTransition` and the REAL framer-motion
 * (mocking `AnimatePresence` would mock away the bug), around a single
 * `<Outlet />` element whose output follows a context value, the way the router
 * slot follows the current route.
 *
 * Deliberately NOT wrapped in `StrictMode`: dev double-invokes mount effects,
 * so a mount counter would read 2 per real mount and blur the 2-vs-3
 * difference. StrictMode isn't the bug (the seed's `seedSentRef` already holds
 * under it: see chat-deep-links.test.tsx), and production has no StrictMode.
 */
import React, { createContext, useContext, useEffect } from 'react'
import { act, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/ThemeProvider'
import PageTransition from '@/components/ui/PageTransition'

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }))

let mockPathname = '/recipes/r1'
let mockSearchParams = new URLSearchParams('')
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
}))

// The cook-preview modal is not under test; it would fetch its own data.
jest.mock('@/components/recipes/CookModal', () => ({
  __esModule: true,
  default: () => null,
}))

// The real `useChat` runs; only its network module is stubbed. A stream that
// never settles keeps the request count observable without any reply.
const streamChatMessage = jest.fn(() => new Promise<void>(() => {}))
jest.mock('@/lib/api/chat', () => ({
  streamChatMessage: (...args: unknown[]) =>
    (streamChatMessage as unknown as (...a: unknown[]) => Promise<void>)(...args),
  checkAIHealth: jest.fn(async () => ({ ai_available: true, providers: [] })),
  fetchChatHistory: jest.fn(async () => []),
  applyPantryProposal: jest.fn(),
}))

jest.mock('@/lib/api/recipes', () => ({
  fetchRecipe: jest.fn(),
  promoteRecipeDraft: jest.fn(),
}))

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ChatPage = require('@/app/chat/page').default as () => React.JSX.Element

const RouteCtx = createContext('/recipes/r1')

let mounts = 0
function MountCounter() {
  useEffect(() => {
    mounts++
  }, [])
  return <div>counter</div>
}

/**
 * Stands in for the App Router's slot: one element, created once, whose output
 * follows the current route from context. Keying the counter by route stands in
 * for the router rendering a different segment per route; without the key the
 * counter couldn't tell main from the fix.
 */
function Outlet() {
  const route = useContext(RouteCtx)
  return route === '/chat' ? <ChatPage /> : <MountCounter key={route} />
}

const outlet = <Outlet />

function tree(route: string, client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RouteCtx.Provider value={route}>
          <PageTransition>{outlet}</PageTransition>
        </RouteCtx.Provider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 600)))

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  Element.prototype.scrollIntoView = () => {}
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
})

beforeEach(() => {
  jest.clearAllMocks()
  mounts = 0
  mockPathname = '/recipes/r1'
  mockSearchParams = new URLSearchParams('')
  window.localStorage.clear()
})

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('PageTransition mounts each page once per navigation (#679)', () => {
  it('a client navigation mounts the new page once (first mount + one, not two)', async () => {
    const client = newClient()
    const { rerender } = render(tree('/a', client))
    mockPathname = '/a'
    await settle()
    expect(mounts).toBe(1)

    mockPathname = '/b'
    rerender(tree('/b', client))
    await settle()

    expect(mounts).toBe(2)
  })

  const UUID = '0b6e2f1a-1111-4222-8333-444455556666'

  it('a client navigation into /chat?meal= sends the seed once, with the fixed-main context', async () => {
    const client = newClient()
    const { rerender } = render(tree('/recipes/r1', client))
    await settle()

    mockPathname = '/chat'
    mockSearchParams = new URLSearchParams(`meal=${UUID}&title=Lemon Pasta`)
    rerender(tree('/chat', client))
    await settle()

    expect(streamChatMessage).toHaveBeenCalledTimes(1)
    const [request] = streamChatMessage.mock.calls[0] as unknown as [
      { context?: { meal_fixed_main?: { recipe_id?: string } } },
    ]
    expect(request.context?.meal_fixed_main?.recipe_id).toBe(UUID)
  })

  it.each([
    ['plan=dinner'],
    ['tip=Salt your pasta water'],
    ['use=spinach'],
  ])('a client navigation into /chat?%s sends the seed once', async (query) => {
    const client = newClient()
    const { rerender } = render(tree('/recipes/r1', client))
    await settle()

    mockPathname = '/chat'
    mockSearchParams = new URLSearchParams(query)
    rerender(tree('/chat', client))
    await settle()

    expect(streamChatMessage).toHaveBeenCalledTimes(1)
  })

  it('guard: a direct load of /chat?meal= (no navigation) sends once', async () => {
    mockPathname = '/chat'
    mockSearchParams = new URLSearchParams(`meal=${UUID}&title=Lemon Pasta`)
    render(tree('/chat', newClient()))
    await settle()

    expect(streamChatMessage).toHaveBeenCalledTimes(1)
  })
})
