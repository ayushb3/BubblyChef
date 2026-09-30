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

import type { ChipConfig, ChipAction } from '@/components/chat/PostMessageChips'

export { type ChipConfig, type ChipAction }

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

// ─── Context-aware follow-ups (issue #498, capped at 4 for #651) ─────────────

/** Hard cap on chips in the row — "a nudge, not a menu". Was 3; issue #651
 *  raised it to 4 so a meal-stage row can hold a model pill alongside its
 *  fixed action pills. */
export const MAX_FOLLOW_UP_CHIPS = 4
/** Below this the row is topped up from the static per-intent set. */
export const MIN_FOLLOW_UP_CHIPS = 2
/** Longest suggestion (after cleaning) that still fits a tappable pill. */
export const MAX_FOLLOW_UP_LENGTH = 60

const FOLLOW_UP_TONES: NonNullable<ChipConfig['tone']>[] = ['primary', 'accent', 'fresh']
const FOLLOW_UP_EMOJI = ['💡', '🍳', '✨']

/**
 * Client-set request context stamped on a meal-stage pill (issue #651, §1c):
 * routes the tap straight back to `meal_plan` on the backend, bypassing the
 * classifier, and (for the options stage) inherits the retained meal's
 * constraints/servings/titles. Never set from model output — see §2.
 */
const MEAL_FOLLOWUP_CONTEXT = { meal_followup: true } as const

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
 *
 * `proposalType` and `opts.mealSaved` only affect `meal_plan` (issue #651,
 * §2): the option stage (`meal_options`, or no `proposalType` yet) gets one
 * fixed set, the pick stage (`meal`) another, and the meal set's "Save this
 * meal" action is omitted once `opts.mealSaved` is true. Every other intent
 * ignores both.
 */
export function resolveStaticChips(
  intent: string | undefined,
  proposalType?: string,
  opts?: { mealSaved?: boolean },
): ChipConfig[] {
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
    case 'meal_plan':
      if (proposalType === 'meal') {
        const chips: ChipConfig[] = []
        if (!opts?.mealSaved) {
          chips.push({
            label: 'Save this meal',
            message: 'Save this meal',
            tone: 'primary',
            emoji: '💾',
            kind: 'action',
            action: 'save_meal',
          })
        }
        chips.push({
          label: 'Swap a side',
          message: 'Swap a side',
          tone: 'accent',
          emoji: '🔀',
          kind: 'action',
          action: 'open_meal',
        })
        chips.push({
          label: 'Start cooking',
          message: 'Start cooking',
          tone: 'fresh',
          emoji: '🍳',
          kind: 'action',
          action: 'open_meal',
        })
        chips.push({
          label: 'Different options',
          message: 'Show me different meal options',
          tone: 'accent',
          emoji: '🔄',
          context: MEAL_FOLLOWUP_CONTEXT,
        })
        return chips
      }
      // meal_options, or no proposalType yet (the stage hasn't resolved).
      return [
        {
          label: 'Something quicker',
          message: 'Something quicker, under 30 minutes',
          tone: 'fresh',
          emoji: '⚡',
          context: MEAL_FOLLOWUP_CONTEXT,
        },
        {
          label: 'Make it vegetarian',
          message: 'Make it vegetarian',
          tone: 'accent',
          emoji: '🥦',
          context: MEAL_FOLLOWUP_CONTEXT,
        },
        {
          label: 'Different ideas',
          message: 'Show me different meal options',
          tone: 'primary',
          emoji: '🔄',
          context: MEAL_FOLLOWUP_CONTEXT,
        },
      ]
    case 'saved_recipe_lookup':
      return [
        // A chip can only send a message, and "another" isn't something the
        // lookup can answer (it would just repeat the list), so offer the
        // browse list the handler does support.
        { label: 'My saved recipes', message: 'Show me my saved recipes', tone: 'accent', emoji: '📖' },
        { label: 'Generate a new one', message: 'Generate a new recipe instead', tone: 'primary', emoji: '✨' },
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
 * static per-intent set; and falls back entirely to the static set otherwise.
 * Never returns an empty array, never more than `MAX_FOLLOW_UP_CHIPS` — an LLM
 * that returns nothing (or junk) must not leave the user with no chips.
 *
 * Every static case maps to a real value in the `ChatIntent` union
 * (types/chat.ts). The dead `cooking_question` value that was never emitted by
 * the backend has been removed — the correct wire value is `cooking_help` (#304).
 *
 * Issue #651, §2 — the algorithm:
 *  1. Split the fixed set into action chips and send chips.
 *  2. Sanitise the model's suggestions, drop any that duplicate a fixed
 *     action's label (the action wins), and cap at
 *     `MAX_FOLLOW_UP_CHIPS − actions.length`.
 *  3. No usable model chips → the fixed set, unchanged (today's full
 *     fallback — `cooking_help` still gets all 3 `COOKING_CHIPS`).
 *  4. Otherwise: model chips, then fixed send chips topped up (skipping
 *     label duplicates) until the row reaches `MIN_FOLLOW_UP_CHIPS`, then the
 *     action chips appended last.
 *
 * The `meal_followup` stamp (`context: { meal_followup: true }`) is applied
 * to every send chip — model and fixed — under the `meal_plan` *options*
 * stage (`proposalType` `'meal_options'` or absent), and to the fixed
 * "Different options" send only under the *pick* stage (`'meal'`): a
 * pick-stage model chip is a cooking question about the whole meal and goes
 * through the classifier unstamped. No other intent stamps anything.
 */
export function resolveChips(
  intent: string | undefined,
  suggestions?: unknown,
  proposalType?: string,
  opts?: { mealSaved?: boolean },
): ChipConfig[] {
  const fixed = resolveStaticChips(intent, proposalType, opts)
  const actions = fixed.filter((c) => c.kind === 'action')
  const fixedSends = fixed.filter((c) => c.kind !== 'action')

  // Model pills carry the stamp too, but only in the options stage — a
  // pick-stage model pill is a cooking question, not a request to re-run
  // the option stage.
  const stampModel = intent === 'meal_plan' && proposalType !== 'meal'

  const actionLabels = new Set(actions.map((c) => c.label.toLowerCase()))
  const cleaned = sanitiseFollowUps(suggestions).filter(
    (text) => !actionLabels.has(text.toLowerCase()),
  )
  const cap = Math.max(0, MAX_FOLLOW_UP_CHIPS - actions.length)
  const modelChips: ChipConfig[] = cleaned.slice(0, cap).map((text, i) => ({
    label: text,
    message: text,
    tone: FOLLOW_UP_TONES[i % FOLLOW_UP_TONES.length],
    emoji: FOLLOW_UP_EMOJI[i % FOLLOW_UP_EMOJI.length],
    ...(stampModel ? { context: MEAL_FOLLOWUP_CONTEXT } : {}),
  }))

  if (modelChips.length === 0) return fixed

  const labels = new Set(modelChips.map((c) => c.label.toLowerCase()))
  const added: ChipConfig[] = []
  for (const chip of fixedSends) {
    if (modelChips.length + added.length + actions.length >= MIN_FOLLOW_UP_CHIPS) break
    if (labels.has(chip.label.toLowerCase())) continue
    added.push(chip)
    labels.add(chip.label.toLowerCase())
  }

  return [...modelChips, ...added, ...actions]
}
