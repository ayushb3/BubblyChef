'use client'

/**
 * "What's for dinner?" (issue #854): a pill text field under the kitchen wall, so
 * Home has somewhere to type straight away. The door on the wall stays as it is.
 *
 * Submitting (Enter or the key) opens /chat and sends the text as the first
 * message, through the same `?ask=` seed a starter pill uses (`askHref`), which
 * the chat page sends once. Submitting it empty opens a fresh chat with the
 * starter chips (`/chat?new=1`, so it doesn't resume the last thread).
 *
 * Contract for `frontend`: no props; it owns its text and navigates with the
 * router. 160 characters is what the chat seed keeps.
 */

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import SpringButton from '@/components/ui/SpringButton'
import { PIXEL_INK } from '@/components/ui/PixelPanel'
import { askHref } from '@/lib/chat-seed'

const PROMPT = "What's for dinner?"
const MAX_LENGTH = 160

export default function DinnerInput() {
  const router = useRouter()
  const [text, setText] = useState('')
  const message = text.trim()
  const empty = message === ''

  function submit(e: FormEvent) {
    e.preventDefault()
    router.push(empty ? '/chat?new=1' : askHref(message))
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 px-4 pt-3" data-testid="dinner-input">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label={PROMPT}
        placeholder={PROMPT}
        maxLength={MAX_LENGTH}
        enterKeyHint="send"
        autoComplete="off"
        className="min-h-[44px] min-w-0 flex-1 rounded-full border-2 bg-[var(--color-surface)] px-4 text-[14px] font-bold text-[color:var(--color-text)] placeholder:font-semibold placeholder:text-[color:var(--color-muted)]"
        style={{ borderColor: PIXEL_INK }}
      />
      <SpringButton
        type="submit"
        variant="primary"
        className="shrink-0 px-5"
        aria-label={empty ? 'Open chat' : 'Ask Bubbly'}
      >
        {empty ? 'Chat' : 'Ask'}
      </SpringButton>
    </form>
  )
}
