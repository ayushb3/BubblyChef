/**
 * RecipeImportModal: YouTube video import copy and loading budget (issue #528).
 *
 * A Short is read by Gemini watching the video, which is slower than scraping
 * a page, and a failed import now carries a typed `reason`. These pin down:
 * the placeholder mentions YouTube, each new reason shows its friendly copy
 * (never raw server text), and a hung request ends in an error instead of
 * spinning forever.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import RecipeImportModal from '@/components/recipes/RecipeImportModal'

const SHORT_URL = 'https://www.youtube.com/shorts/dQw4w9WgXcQ'

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch
}

function submit(url: string) {
  fireEvent.change(screen.getByPlaceholderText(/youtube/i), { target: { value: url } })
  fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
}

describe('RecipeImportModal video import', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
    jest.useRealTimers()
  })

  it('mentions YouTube in the placeholder', () => {
    render(<RecipeImportModal onImported={jest.fn()} onClose={jest.fn()} />)
    expect(screen.getByPlaceholderText(/youtube/i)).toBeInTheDocument()
  })

  it.each([
    ['not_a_recipe', /couldn.t find a recipe/i],
    ['video_unavailable', /private|removed|age-restricted/i],
    ['video_timeout', /took too long/i],
    ['video_failed', /couldn.t watch that video/i],
  ])('shows friendly copy for reason %s, not the server text', async (reason, copy) => {
    mockFetchOnce(422, { error: 'RAW SERVER TEXT gemini traceback', reason })
    render(<RecipeImportModal onImported={jest.fn()} onClose={jest.fn()} />)

    submit(SHORT_URL)

    expect(await screen.findByText(copy)).toBeInTheDocument()
    expect(screen.queryByText(/raw server text|gemini|traceback/i)).not.toBeInTheDocument()
  })

  it('shows a video-specific loading message for YouTube links', async () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch
    render(<RecipeImportModal onImported={jest.fn()} onClose={jest.fn()} />)

    submit(SHORT_URL)

    expect(await screen.findByText(/watching the video/i)).toBeInTheDocument()
  })

  it('hands the extracted recipe to onImported on success', async () => {
    mockFetchOnce(200, { title: 'Garlic Noodles', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' })
    const onImported = jest.fn()
    render(<RecipeImportModal onImported={onImported} onClose={jest.fn()} />)

    submit(SHORT_URL)

    await waitFor(() => expect(onImported).toHaveBeenCalled())
    expect(onImported.mock.calls[0][0]).toMatchObject({ title: 'Garlic Noodles' })
    expect(onImported.mock.calls[0][1]).toBe(SHORT_URL)
  })

  it('never spins forever: a hung request ends in a timeout message and re-enables Import', async () => {
    jest.useFakeTimers()
    // Never resolves on its own; rejects the way real fetch does once aborted.
    global.fetch = jest.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    ) as unknown as typeof fetch
    render(<RecipeImportModal onImported={jest.fn()} onClose={jest.fn()} />)

    submit(SHORT_URL)
    expect(await screen.findByText(/watching the video/i)).toBeInTheDocument()

    await act(async () => {
      jest.advanceTimersByTime(95_000)
    })

    expect(await screen.findByText(/took too long/i)).toBeInTheDocument()
    expect(screen.queryByText(/watching the video/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^import$/i })).toBeEnabled()
  })
})
