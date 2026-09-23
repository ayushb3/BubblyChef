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
// minimal real parser for the shapes this suite needs: a flat numbered or
// bulleted list, a resumed ordered list (`start`), and a remark-gfm task
// list — calling the same `components` prop react-markdown would, with the
// same extra props (`start`, `className`) real react-markdown passes through
// from the parsed AST, so the fix's own prop-spreading is exercised for real.
type ListComponent = React.ElementType
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({
    children,
    components,
  }: {
    children: string
    components?: Record<string, ListComponent>
  }) => {
    const Ol = components?.ol ?? 'ol'
    const Ul = components?.ul ?? 'ul'
    const Li = components?.li ?? 'li'
    const lines = children.split('\n').filter((l) => l.trim())

    const orderedMatches = lines
      .map((l) => l.match(/^(\d+)\.\s(.*)/))
      .filter((m): m is RegExpMatchArray => m !== null)
    const taskMatches = lines
      .map((l) => l.match(/^-\s\[[ x]\]\s(.*)/))
      .filter((m): m is RegExpMatchArray => m !== null)
    const unordered = lines.filter((l) => /^-\s/.test(l) && !/^-\s\[/.test(l))

    if (orderedMatches.length > 0) {
      const firstNumber = Number(orderedMatches[0][1])
      return (
        // remark-gfm only sets `start` when a list doesn't begin at 1.
        <Ol start={firstNumber !== 1 ? firstNumber : undefined}>
          {orderedMatches.map((m, i) => (
            <Li key={i}>{m[2]}</Li>
          ))}
        </Ol>
      )
    }
    if (taskMatches.length > 0) {
      return (
        <Ul className="contains-task-list">
          {taskMatches.map((m, i) => (
            <Li key={i} className="task-list-item">
              {m[1]}
            </Li>
          ))}
        </Ul>
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

  // Regression guard for the fixed PR review: the first pass destructured
  // only `children` off react-markdown's component props and dropped
  // everything else, so a resumed ordered list's `start` never reached the
  // DOM and every such list silently renumbered from 1.
  it('passes a resumed ordered list\'s `start` through to the <ol>', () => {
    render(<MessageBubble message={assistantMessage('4. Continue chopping\n5. Add to the pot')} />)

    const list = screen.getByRole('list')
    expect(list.tagName).toBe('OL')
    expect(list).toHaveAttribute('start', '4')
  })

  // Same root cause: dropping `className` lost remark-gfm's own
  // "contains-task-list" marker, so a task list got `list-disc` on top of
  // its checkboxes — a stray bullet next to every item.
  it('does not add a bullet class to a task list (checkboxes are the marker)', () => {
    render(
      <MessageBubble
        message={assistantMessage('- [ ] Buy milk\n- [x] Buy eggs')}
      />,
    )

    const list = screen.getByRole('list')
    expect(list.tagName).toBe('UL')
    expect(list.className).not.toContain('list-disc')
    expect(list.className).toContain('contains-task-list')
  })
})
