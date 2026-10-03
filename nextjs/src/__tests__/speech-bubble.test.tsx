/**
 * Bubbly's speech bubble (issue #915): typed out normally, whole line at once under
 * reduced motion, and finishable from the keyboard.
 */
import React from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SpeechBubble from '@/components/ui/SpeechBubble'

let mockReduced = false
jest.mock('@/lib/motion', () => ({
  useMotionConfig: () => ({ reduced: mockReduced, springs: {} }),
}))

const LINE = 'Welcome to your kitchen!'
const typed = () => screen.getByTestId('speech-typed').textContent

beforeEach(() => {
  mockReduced = false
  jest.useFakeTimers()
})
afterEach(() => jest.useRealTimers())

it('shows the whole line immediately under reduced motion', () => {
  mockReduced = true
  render(<SpeechBubble text={LINE} />)
  expect(typed()).toBe(LINE)
})

it('types the line out one character at a time otherwise', () => {
  render(<SpeechBubble text={LINE} />)
  expect(typed()).toBe('')
  act(() => {
    jest.advanceTimersByTime(28 * 3)
  })
  expect(typed()).toBe('Wel')
  act(() => {
    jest.advanceTimersByTime(28 * LINE.length)
  })
  expect(typed()).toBe(LINE)
})

it('Enter or Space on the typing bubble shows the whole line', async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
  render(<SpeechBubble text={LINE} />)
  screen.getByRole('button', { name: /show the whole line/i }).focus()
  await user.keyboard('{Enter}')
  expect(typed()).toBe(LINE)
  // Done: no longer a control.
  expect(screen.queryByRole('button', { name: /show the whole line/i })).toBeNull()
})
