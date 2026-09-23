/**
 * Issue #566: chat message bubbles wrap AI markdown in Tailwind `prose`
 * classes (`prose-ol:`/`prose-ul:` variants), but `@tailwindcss/typography`
 * is deliberately not a dependency of this project — without the plugin
 * `.prose` (and its `prose-*` variants) supply no styling at all, so
 * Tailwind's preflight strips list markers and every numbered/bulleted list
 * in chat rendered with no `1.`/`2.` or bullets. Fixed by styling the
 * rendered `<ol>`/`<ul>`/`<li>` elements directly via `list-decimal`/
 * `list-disc` utility classes instead of relying on the plugin.
 *
 * This asserts the actual DOM classes MessageBubble emits, since jsdom
 * doesn't apply real CSS — a screenshot (see the PR body) is the visual
 * proof; this is the regression guard.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import MessageBubble from '@/components/chat/MessageBubble'
import type { ChatMessage } from '@/types/chat'

// react-markdown/remark-gfm ship ESM only; jest runs this suite as CJS, so —
// same pattern as chat-recipe-card-render.test.tsx — they're stubbed out.
// Unlike those suites, this one *does* need to exercise MessageBubble's
// `components.ol`/`ul`/`li` overrides (the actual fix), so the stub is a
// minimal real parser for the one shape this test needs: a flat numbered or
// bulleted list, using the same `components` prop react-markdown would call.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({
    children,
    components,
  }: {
    children: string
    components?: Record<string, React.ComponentType<{ children?: React.ReactNode }>>
  }) => {
    const Ol = components?.ol ?? 'ol'
    const Ul = components?.ul ?? 'ul'
    const Li = components?.li ?? 'li'
    const lines = children.split('\n').filter((l) => l.trim())
    const ordered = lines.filter((l) => /^\d+\.\s/.test(l))
    const unordered = lines.filter((l) => /^-\s/.test(l))
    if (ordered.length > 0) {
      return (
        <Ol>
          {ordered.map((l, i) => (
            <Li key={i}>{l.replace(/^\d+\.\s/, '')}</Li>
          ))}
        </Ol>
      )
    }
    if (unordered.length > 0) {
      return (
        <Ul>
          {unordered.map((l, i) => (
            <Li key={i}>{l.replace(/^-\s/, '')}</Li>
          ))}
        </Ul>
      )
    }
    return <>{children}</>
  },
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }))

function assistantMessage(content: string): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content,
    timestamp: new Date(),
  }
}

describe('MessageBubble list markers (#566)', () => {
  it('gives a numbered list Tailwind classes that actually render markers', () => {
    render(<MessageBubble message={assistantMessage('Steps:\n\n1. Preheat oven\n2. Mix batter\n3. Bake 20 min')} />)

    const list = screen.getByRole('list')
    expect(list.tagName).toBe('OL')
    expect(list.className).toContain('list-decimal')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('gives a bulleted list Tailwind classes that actually render markers', () => {
    render(<MessageBubble message={assistantMessage('Ingredients:\n\n- Flour\n- Sugar\n- Eggs')} />)

    const list = screen.getByRole('list')
    expect(list.tagName).toBe('UL')
    expect(list.className).toContain('list-disc')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })
})
