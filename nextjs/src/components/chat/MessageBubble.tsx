'use client'

import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '@/types/chat'

interface MessageBubbleProps {
  message: ChatMessage
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}
    >
      <div
        className={[
          'relative px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-[var(--color-primary)] text-white rounded-2xl rounded-br-md max-w-[80%]'
            : 'bg-[var(--color-accent)]/30 text-[var(--color-text)] rounded-2xl rounded-bl-md border border-[var(--color-accent)] max-w-[85%]',
        ].join(' ')}
      >
        {/* Speech-bubble tail. User points right, assistant points left toward
            the mascot. Pure CSS border triangles so they inherit the theme. */}
        {isUser ? (
          <span
            aria-hidden
            className="absolute w-0 h-0"
            style={{
              right: '-8px',
              bottom: '10px',
              borderTop: '6px solid transparent',
              borderBottom: '6px solid transparent',
              borderLeft: '8px solid var(--color-primary)',
            }}
          />
        ) : (
          <>
            {/* Outer triangle = the bubble's 1px accent border. */}
            <span
              aria-hidden
              className="absolute w-0 h-0"
              style={{
                left: '-8px',
                bottom: '10px',
                borderTop: '6px solid transparent',
                borderBottom: '6px solid transparent',
                borderRight: '8px solid var(--color-accent)',
              }}
            />
            {/* Inner triangle = the bubble's accent/30 fill composited over the
                page background, so the tail matches the bubble exactly. */}
            <span
              aria-hidden
              className="absolute w-0 h-0"
              style={{
                left: '-7px',
                bottom: '11px',
                borderTop: '5px solid transparent',
                borderBottom: '5px solid transparent',
                borderRight:
                  '8px solid color-mix(in srgb, var(--color-accent) 30%, var(--color-bg))',
              }}
            />
          </>
        )}

        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-code:bg-[var(--color-bg)] prose-code:text-[var(--color-primary-dark)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-[var(--color-bg)] prose-pre:border prose-pre:border-[var(--color-border)] prose-pre:rounded-xl prose-a:text-[var(--color-primary-dark)] prose-a:underline prose-headings:text-[var(--color-text)] prose-strong:text-[var(--color-text)]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </motion.div>
  )
}
