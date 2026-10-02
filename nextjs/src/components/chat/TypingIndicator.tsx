'use client'

import { motion } from 'framer-motion'
import BubblesMascot from '@/components/ui/BubblesMascot'
import { bubbleClass } from '@/components/chat/MessageBubble'
import { useMotionConfig, useSteppedFrame } from '@/lib/motion'

/**
 * Before the first token (issue #746, Signature "ChatBubble" board): Bubbles'
 * bubble holds three stepped pixel dots, one raised at a time over 3 frames of
 * 160 ms (a small piece of the world, so it steps rather than glides). Under
 * reduced motion the dots hold the board's still pose. The bubble is a polite
 * status region named "Bubbly is typing".
 */
export default function TypingIndicator() {
  const { reduced } = useMotionConfig()
  const frame = useSteppedFrame(3, 160)
  // Reduced motion holds frame 0, which would raise the first dot; the board's
  // still pose raises the middle one.
  const raised = reduced ? 1 : frame

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
      transition={{ duration: reduced ? 0.15 : 0.22, ease: 'easeOut' }}
      className="flex items-end gap-2"
    >
      <BubblesMascot
        size={36}
        state="thinking"
        animate={true}
        className="flex-shrink-0 mb-1"
      />
      <div className={bubbleClass('assistant')}>
        <span role="status" className="flex h-5 items-center">
          <svg
            width="33"
            height="12"
            viewBox="0 0 11 4"
            shapeRendering="crispEdges"
            aria-hidden="true"
            className="block fill-current"
          >
            {[0, 4, 8].map((x, i) => (
              <rect
                key={x}
                data-testid="typing-dot"
                x={x}
                y={i === raised ? 0 : 2}
                width="2"
                height="2"
              />
            ))}
          </svg>
          <span className="sr-only">Bubbly is typing</span>
        </span>
      </div>
    </motion.div>
  )
}
