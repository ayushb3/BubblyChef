'use client'

import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { reactionVariants, useMotionConfig } from '@/lib/motion'
import { getAiErrorKind } from '@/types/chat'
import type { ChatMessage } from '@/types/chat'

interface MessageBubbleProps {
  message: ChatMessage
  /**
   * The reply is still arriving: a block caret follows the text (it blinks in
   * 2 steps over 1 s; held still under reduced motion). Pass it only for the
   * last assistant message while the stream is open.
   */
  streaming?: boolean
}

/**
 * The chat bubble (signature component #5, issue #746), drawn to the Signature
 * "ChatBubble" board.
 *
 * - Bubbles' reply: an accent tint with a 2 px accent edge, a square bottom-left
 *   "tail" corner toward the mascot, at most 82% wide.
 * - Your message: the theme primary with a 2 px ink edge, a square bottom-right
 *   corner, at most 80% wide. Ink text on both, never white.
 * - An AI-error reply (`metadata.ai_error_kind`): surface fill and a dashed ink
 *   edge, a dizzy-face marker and one wiggle on arrival. The single "Try again"
 *   pill under it is the page's (`PostMessageChips`), not this component's.
 *
 * Markdown rendering is unchanged. The mascot beside a reply is the caller's.
 */

/** Bubbles' bubble: accent tint (over the surface, so it stays opaque) + accent edge. */
export const ASSISTANT_BUBBLE_CLASS =
  'border-[color:var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_30%,var(--color-surface))] rounded-[16px_16px_16px_6px] max-w-[82%]'

const BUBBLE_BASE =
  'relative min-w-0 border-2 px-3.5 py-2.5 text-sm leading-5 text-[color:var(--color-text)] break-words [overflow-wrap:anywhere]'

const USER_BUBBLE_CLASS =
  'border-[color:var(--color-text)] bg-[var(--color-primary)] rounded-[16px_16px_6px_16px] max-w-[80%] font-semibold'

const ERROR_BUBBLE_CLASS =
  'border-dashed border-[color:var(--color-text)] bg-[var(--color-surface)] rounded-[16px_16px_16px_6px] max-w-[82%]'

export function bubbleClass(kind: 'user' | 'assistant' | 'error'): string {
  const fill =
    kind === 'user' ? USER_BUBBLE_CLASS : kind === 'error' ? ERROR_BUBBLE_CLASS : ASSISTANT_BUBBLE_CLASS
  return `${BUBBLE_BASE} ${fill}`
}

export default function MessageBubble({ message, streaming = false }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isError = !isUser && getAiErrorKind(message.response) !== null
  const { reduced } = useMotionConfig()
  const wiggle = reactionVariants(reduced).wiggle

  // Springs up 8 px with a fade in 220 ms; yours comes in from the right.
  // Reduced motion: a fade only.
  const enter = reduced
    ? { opacity: 0 }
    : { opacity: 0, y: 8, x: isUser ? 12 : 0 }

  return (
    <motion.div
      initial={enter}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{ duration: reduced ? 0.15 : 0.22, ease: 'easeOut' }}
      className={`flex flex-col gap-1 min-w-0 ${isUser ? 'items-end' : 'items-start'}`}
      data-testid={isUser ? 'chat-message-user' : 'chat-message-assistant'}
    >
      <motion.div
        data-bubble={isUser ? 'user' : 'assistant'}
        data-variant={isError ? 'error' : undefined}
        // One wiggle on an error reply's arrival, then still.
        variants={isError ? wiggle : undefined}
        initial={isError ? 'idle' : undefined}
        animate={isError ? 'play' : undefined}
        className={bubbleClass(isUser ? 'user' : isError ? 'error' : 'assistant')}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <div className={isError ? 'flex items-start gap-2' : undefined}>
            {isError && (
              <span aria-hidden="true" className="flex-none text-base leading-5">
                😵‍💫
              </span>
            )}
            <div className="min-w-0">
              <div
                className={[
                  'prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-code:bg-[var(--color-bg)] prose-code:text-[var(--color-primary-dark)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-[var(--color-bg)] prose-pre:border prose-pre:border-[var(--color-border)] prose-pre:rounded-xl prose-a:text-[var(--color-primary-dark)] prose-a:underline prose-headings:text-[var(--color-text)] prose-strong:text-[var(--color-text)]',
                  // While streaming, the last paragraph runs inline so the caret
                  // sits right after the last word instead of on its own line.
                  streaming ? 'inline [&>p:last-child]:inline' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    // The `prose-ol:`/`prose-ul:` utilities above only take effect
                    // with the `@tailwindcss/typography` plugin loaded, which this
                    // project deliberately doesn't add as a dependency — without
                    // it, `.prose` supplies no base styling at all, so Tailwind's
                    // preflight (which zeroes out list markers) went unopposed and
                    // every numbered/bulleted list in chat rendered with no
                    // markers (issue #566). Style list elements directly instead.
                    // `node` is react-markdown's own extra prop, not a valid DOM
                    // attribute — dropped rather than spread. Everything else
                    // (`start` on a resumed `<ol>`, remark-gfm's own
                    // `className` — e.g. "contains-task-list" on a task list's
                    // wrapper, "task-list-item" on a checkbox `<li>`) must pass
                    // through: dropping `start` renumbers a resumed list from 1,
                    // and dropping `className` loses remark-gfm's own markup.
                    // A task list already has its own checkbox marker, so
                    // `list-decimal`/`list-disc` is skipped for
                    // "contains-task-list" — otherwise every checkbox item also
                    // grew a stray bullet/number next to it.
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to keep it out of `...props`
                    ol: ({ node: _node, className, ...props }) => (
                      <ol
                        className={[
                          'list-outside pl-5 my-1 space-y-0.5',
                          className?.includes('contains-task-list') ? '' : 'list-decimal',
                          className ?? '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        {...props}
                      />
                    ),
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to keep it out of `...props`
                    ul: ({ node: _node, className, ...props }) => (
                      <ul
                        className={[
                          'list-outside pl-5 my-1 space-y-0.5',
                          className?.includes('contains-task-list') ? '' : 'list-disc',
                          className ?? '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        {...props}
                      />
                    ),
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to keep it out of `...props`
                    li: ({ node: _node, className, ...props }) => (
                      <li className={['pl-0.5', className ?? ''].filter(Boolean).join(' ')} {...props} />
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
              {streaming && (
                <span
                  data-testid="stream-caret"
                  aria-hidden="true"
                  className="ml-0.5 inline-block h-4 w-2 bg-[var(--color-text)] align-[-3px] animate-[caret-blink_1s_step-end_infinite] motion-reduce:animate-none"
                />
              )}
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
