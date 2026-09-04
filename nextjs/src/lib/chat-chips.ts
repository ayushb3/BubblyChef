/**
 * Intent-aware chip resolver for the chat screen.
 *
 * Extracted from app/chat/page.tsx so it can be unit-tested without pulling
 * in the full component tree (react-markdown, next/navigation, framer-motion).
 *
 * `COOKING_CHIPS` is the single source of truth for cooking-help suggestions.
 * It is consumed by:
 *   - `resolveChips` (post-reply chips under the last assistant message)
 *   - the empty-state suggestion row in ChatSurface (COOKING_SUGGESTIONS / COOKING_SUGGESTION_TONES)
 */

import type { ChipConfig } from '@/components/chat/PostMessageChips'

export { type ChipConfig }

/**
 * Cooking-help chips — substitution / prep / timing.
 * Covers the `cooking_help` intent that the backend emits during a pinned
 * cook session.
 *
 * `message` is clean prose — this is what lands in the chat bubble and is
 * sent to the LLM.  `suggestion` is the emoji-decorated string shown in the
 * empty-state chip row (a display surface, not a prompt).  `emoji` is
 * rendered separately by PostMessageChips so it must not also appear in
 * `message`.
 */
export const COOKING_CHIPS: ChipConfig[] = [
  { label: 'What can I substitute?', message: 'What can I substitute?', suggestion: 'What can I substitute? 🔁', tone: 'primary', emoji: '🔁' },
  { label: 'How do I prep this?', message: 'How do I prep this?', suggestion: 'How do I prep this? 🔪', tone: 'accent', emoji: '🔪' },
  { label: 'How long does this take?', message: 'How long does this take?', suggestion: 'How long does this take? ⏱️', tone: 'fresh', emoji: '⏱️' },
]

/**
 * Resolve follow-up chip suggestions from the assistant message's intent.
 *
 * Every case maps to a real value in the `ChatIntent` union (types/chat.ts).
 * The dead `cooking_question` value that was never emitted by the backend has
 * been removed — the correct wire value is `cooking_help` (#304).
 */
export function resolveChips(intent: string | undefined): ChipConfig[] {
  switch (intent) {
    case 'recipe_generation':
    case 'recipe_card':
      return [
        { label: 'Try another recipe', message: 'Give me a different recipe', tone: 'accent', emoji: '🔄' },
        { label: 'Tell me more', message: 'Tell me more about that recipe', tone: 'primary', emoji: '💬' },
      ]
    case 'pantry_update':
      return [
        { label: 'Add more items', message: 'I have more items to add to my pantry', tone: 'fresh', emoji: '➕' },
        { label: 'What expires soon?', message: 'What items in my pantry are expiring soon?', tone: 'expiring', emoji: '⏰' },
      ]
    case 'cooking_help':
      return COOKING_CHIPS
    case 'recipe_brainstorm':
      return [
        { label: 'Explore this idea', message: 'Tell me more about this recipe idea', tone: 'accent', emoji: '✨' },
        { label: 'Try a different direction', message: 'Give me some different recipe ideas', tone: 'primary', emoji: '🔀' },
      ]
    default:
      return [
        { label: 'Try another', message: 'Give me a different answer', tone: 'accent', emoji: '🔄' },
        { label: 'Tell me more', message: 'Tell me more about that', tone: 'primary', emoji: '💬' },
      ]
  }
}
