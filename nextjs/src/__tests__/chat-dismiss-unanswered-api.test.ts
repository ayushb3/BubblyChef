/**
 * Issue #871 -- the wire shape of `dismissUnansweredTurn`.
 *
 * It DELETEs the conversation's unanswered-turn resource on the AI service with
 * the dismissed text in a JSON body, so the service deletes only a stored turn
 * with exactly that text.
 */
import { dismissUnansweredTurn } from '@/lib/api/chat'

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  }),
}))

const fetchMock = jest.fn()

beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch
  jest.clearAllMocks()
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ deleted: true }) })
})

describe('dismissUnansweredTurn', () => {
  it('DELETEs the conversation resource with the dismissed text as a JSON body', async () => {
    await dismissUnansweredTurn('conv-1', 'plan dinner')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/v1\/chat\/history\/conv-1\/unanswered$/)
    expect(init.method).toBe('DELETE')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(init.body)).toEqual({ content: 'plan dinner' })
  })

  it('resolves to whether the service deleted a turn', async () => {
    await expect(dismissUnansweredTurn('conv-1', 'plan dinner')).resolves.toBe(true)

    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ deleted: false }) })
    await expect(dismissUnansweredTurn('conv-1', 'plan dinner')).resolves.toBe(false)
  })

  it('rejects on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })

    await expect(dismissUnansweredTurn('conv-1', 'plan dinner')).rejects.toThrow('500')
  })
})
