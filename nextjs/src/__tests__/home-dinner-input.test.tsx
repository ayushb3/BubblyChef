/**
 * Issue #854 — Home's "What's for dinner?" input, below the kitchen wall.
 *
 * Submitting text opens /chat with that text as the first message (the existing
 * `?ask=` seed); submitting it empty opens a fresh /chat so the starter chips
 * show. The door keeps working as before. The chat side (sends once under
 * StrictMode, `?new=1` skips resume) is in `chat-deep-links.test.tsx`.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HeroHome from '@/components/dashboard/HeroHome'
import DinnerInput from '@/components/kitchen/DinnerInput'

const push = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

beforeEach(() => push.mockClear())

describe('DinnerInput', () => {
  it('is a labelled text field with the dinner prompt', () => {
    render(<DinnerInput />)
    const field = screen.getByRole('textbox', { name: "What's for dinner?" })
    expect(field).toHaveAttribute('placeholder', "What's for dinner?")
  })

  it('opens /chat with the typed text as the first message (Enter submits)', () => {
    render(<DinnerInput />)
    const field = screen.getByRole('textbox', { name: "What's for dinner?" })
    fireEvent.change(field, { target: { value: '  something with eggs & rice  ' } })
    fireEvent.submit(field.closest('form')!)
    expect(push).toHaveBeenCalledTimes(1)
    const url = new URL(push.mock.calls[0][0], 'http://x')
    expect(url.pathname).toBe('/chat')
    expect(url.searchParams.get('ask')).toBe('something with eggs & rice')
  })

  it('the button submits too, once per tap', () => {
    render(<DinnerInput />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'pasta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Bubbly' }))
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0][0]).toBe('/chat?ask=pasta')
  })

  it('empty (or blank) opens a fresh chat so the starter chips show, with no message', () => {
    render(<DinnerInput />)
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
    expect(push).toHaveBeenLastCalledWith('/chat?new=1')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
    expect(push).toHaveBeenLastCalledWith('/chat?new=1')
  })

  it('caps the text at what the chat seed keeps (160)', () => {
    render(<DinnerInput />)
    expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', '160')
  })
})

describe('on Home', () => {
  it('sits below the wall, the door stays, and submitting navigates', async () => {
    global.fetch = jest.fn(
      async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response,
    ) as unknown as typeof fetch
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <HeroHome displayName="ayush" />
      </QueryClientProvider>,
    )
    const field = await screen.findByRole('textbox', { name: "What's for dinner?" })
    const door = screen.getByRole('link', { name: 'Plan dinner' })
    expect(door).toHaveAttribute('href', '/chat?plan=dinner')
    // The input follows the kitchen scene in document order.
    const scene = document.querySelector('[data-tour="hero"]')!
    expect(scene.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.change(field, { target: { value: 'tacos' } })
    fireEvent.submit(field.closest('form')!)
    expect(push).toHaveBeenCalledWith('/chat?ask=tacos')
  })
})
