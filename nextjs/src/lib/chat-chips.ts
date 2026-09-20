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

// ─── Context-aware follow-ups (issue #498) ────────────────────────────────────

/** Hard cap on chips in the row — "a nudge, not a menu". */
export const MAX_FOLLOW_UP_CHIPS = 3
/** Below this the row is topped up from the static per-intent set. */
export const MIN_FOLLOW_UP_CHIPS = 2
/** Longest suggestion (after cleaning) that still fits a tappable pill. */
export const MAX_FOLLOW_UP_LENGTH = 60

const FOLLOW_UP_TONES: NonNullable<ChipConfig['tone']>[] = ['primary', 'accent', 'fresh']
const FOLLOW_UP_EMOJI = ['💡', '🍳', '✨']

const URL_PATTERN = /(https?:\/\/|www\.)/i
const EMOJI_PATTERN = /\p{Extended_Pictographic}️?/gu

/**
 * Strip the markdown a model is likely to leak into a one-line suggestion:
 * links (keep the text), emphasis/code markers, list/heading prefixes.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/[*_`~]+/g, '')
}

/**
 * Turn raw model output into chip-safe strings: strings only, markdown and
 * emoji stripped, whitespace collapsed, no links, 1–60 chars, case-insensitive
 * dedupe, capped at `MAX_FOLLOW_UP_CHIPS`. Pure; never throws on junk input.
 */
export function sanitiseFollowUps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    if (URL_PATTERN.test(item)) continue
    const text = stripMarkdown(item).replace(EMOJI_PATTERN, '').replace(/\s+/g, ' ').trim()
    if (text.length === 0 || text.length > MAX_FOLLOW_UP_LENGTH) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= MAX_FOLLOW_UP_CHIPS) break
  }
  return out
}

/**
 * Today's fixed per-intent chip set — the safety net when the backend sends
 * no usable suggestions. Never returns an empty array.
 */
export function resolveStaticChips(intent: string | undefined): ChipConfig[] {
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

/**
 * Resolve the follow-up chips for an assistant message.
 *
 * Prefers the backend's context-aware `follow_up_suggestions` (issue #498)
 * when at least one survives `sanitiseFollowUps`; tops the row up from the
 * static per-intent set to `MIN_FOLLOW_UP_CHIPS` (skipping label duplicates);
 * and falls back entirely to the static set otherwise. Never returns an empty
 * array — an LLM that returns nothing (or junk) must not leave the user with
 * no chips.
 *
 * Every static case maps to a real value in the `ChatIntent` union
 * (types/chat.ts). The dead `cooking_question` value that was never emitted by
 * the backend has been removed — the correct wire value is `cooking_help` (#304).
 */
export function resolveChips(intent: string | undefined, suggestions?: unknown): ChipConfig[] {
  const staticChips = resolveStaticChips(intent)
  const contextual = sanitiseFollowUps(suggestions)
  if (contextual.length === 0) return staticChips

  const chips: ChipConfig[] = contextual.map((text, i) => ({
    label: text,
    message: text,
    tone: FOLLOW_UP_TONES[i % FOLLOW_UP_TONES.length],
    emoji: FOLLOW_UP_EMOJI[i % FOLLOW_UP_EMOJI.length],
  }))
  const labels = new Set(chips.map((c) => c.label.toLowerCase()))
  for (const chip of staticChips) {
    if (chips.length >= MIN_FOLLOW_UP_CHIPS) break
    if (labels.has(chip.label.toLowerCase())) continue
    chips.push(chip)
  }
  return chips
}
