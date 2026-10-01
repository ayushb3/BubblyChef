'use client'

/**
 * The "add an item" row at the top of the grocery list (issue #497): one
 * free-text field and an Add key. Enter adds too. The field keeps focus after
 * an add, so a run of items is a run of Enters. The amount and unit are edited
 * on the line afterwards.
 */

import { useState, type FormEvent } from 'react'
import SpringButton from '@/components/ui/SpringButton'
import { PIXEL_INK } from '@/components/ui/PixelPanel'

export default function GroceryAddForm({ onAdd }: { onAdd: (name: string) => void }) {
  const [text, setText] = useState('')
  const empty = text.trim() === ''

  function submit(e: FormEvent) {
    e.preventDefault()
    if (empty) return
    onAdd(text)
    setText('')
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Add an item"
        placeholder="Add an item, like paper towels"
        maxLength={100}
        enterKeyHint="done"
        autoComplete="off"
        className="min-h-[44px] min-w-0 flex-1 rounded-xl border-2 bg-[var(--color-surface)] px-3 text-[14px] font-bold text-[color:var(--color-text)] placeholder:font-semibold placeholder:text-[color:var(--color-muted)]"
        style={{ borderColor: PIXEL_INK }}
      />
      <SpringButton type="submit" variant="primary" disabled={empty} className="shrink-0 px-5">
        Add
      </SpringButton>
    </form>
  )
}
