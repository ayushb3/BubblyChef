/**
 * Issue #304 — the chip resolver had a dead `cooking_question` branch that no
 * backend intent ever emits. The real wire value is `cooking_help`.
 *
 * These tests assert:
 *   (a) `cooking_help` resolves to the cooking chips (substitution / prep /
 *       timing), not the generic brainstorm fallback ("Try another").
 *   (b) Every named case in resolveChips corresponds to a value that actually
 *       exists in the `ChatIntent` union — no phantom intent strings left
 *       in the resolver.
 */

import { resolveChips, COOKING_CHIPS } from '@/lib/chat-chips'
import type { ChatIntent } from '@/types/chat'

// Derive VALID_INTENTS from the ChatIntent union via an exhaustive Record.
// tsc errors if a union member is missing from the object literal, so adding
// a new intent without updating this file causes a type error rather than a
// silent false pass (the exact failure mode this PR exists to fix).
const INTENT_SET: Record<ChatIntent, true> = {
  pantry_update: true,
  recipe_card: true,
  recipe_generation: true,
  cooking_help: true,
  general_chat: true,
  recipe_brainstorm: true,
}
const VALID_INTENTS = Object.keys(INTENT_SET) as ChatIntent[]

// ─── cooking_help resolves to the cooking chips ───────────────────────────────

describe('resolveChips — cooking_help intent (#304)', () => {
  it('returns COOKING_CHIPS (not the brainstorm fallback) for cooking_help', () => {
    const chips = resolveChips('cooking_help')
    expect(chips).toBe(COOKING_CHIPS)
  })

  it('does not include "Try another" in the cooking_help chips', () => {
    const chips = resolveChips('cooking_help')
    const labels = chips.map((c) => c.label)
    expect(labels).not.toContain('Try another')
    // Double-check it also isn't buried in messages
    const messages = chips.map((c) => c.message)
    expect(messages.join(' ')).not.toMatch(/try another/i)
  })

  it('cooking_help chips cover substitution, prep, and timing', () => {
    const chips = resolveChips('cooking_help')
    const labels = chips.map((c) => c.label)
    expect(labels).toContain('What can I substitute?')
    expect(labels).toContain('How do I prep this?')
    expect(labels).toContain('How long does this take?')
  })

  it('COOKING_CHIPS has exactly the three cooking chip entries', () => {
    expect(COOKING_CHIPS).toHaveLength(3)
  })

  // ── emoji-in-message guard (#313) ────────────────────────────────────────────
  // The `message` field is sent to the LLM and shown in the chat bubble.
  // Emojis belong in `emoji` (rendered separately by PostMessageChips) or in
  // `suggestion` (empty-state display string only) — never appended to `message`.
  it('no COOKING_CHIPS message contains an emoji character', () => {
    // Unicode emoji regex — covers the common Emoji_Presentation + modifier
    // sequences used in this component.
    const emojiPattern = /\p{Emoji_Presentation}/u
    COOKING_CHIPS.forEach((chip) => {
      expect(chip.message).not.toMatch(emojiPattern)
    })
  })

  // ── empty-state composition guard (#313) ────────────────────────────────────
  // The empty-state row renders `chip.suggestion ?? chip.message`.  It must
  // produce the same three strings, in the same order, with the same tones, as
  // before the emoji fix landed — the user must see no visual change there.
  it('empty-state suggestions compose to the exact expected strings', () => {
    const emptyStateSuggestions = COOKING_CHIPS.map((c) => c.suggestion ?? c.message)
    expect(emptyStateSuggestions).toEqual([
      'What can I substitute? 🔁',
      'How do I prep this? 🔪',
      'How long does this take? ⏱️',
    ])
  })

  it('empty-state suggestion tones are primary / accent / fresh', () => {
    const tones = COOKING_CHIPS.map((c) => c.tone ?? 'primary')
    expect(tones).toEqual(['primary', 'accent', 'fresh'])
  })
})

// ─── No dead intent strings in the resolver ───────────────────────────────────

describe('resolveChips — no phantom intents in the switch (#304)', () => {
  /**
   * Probe the resolver with every value in the ChatIntent union and confirm
   * each one either has its own case or falls through to the default.
   * The critical assertion is that the dead `cooking_question` case is gone:
   * if it were still present, passing `cooking_question` would return chips
   * OTHER THAN the default fallback — and `cooking_question` is not a member
   * of ChatIntent, so the resolver would be silently wrong.
   */

  // Values NOT in the ChatIntent union — if any of these produce non-default
  // chips the resolver has a dead / phantom branch.
  const PHANTOM_INTENTS = ['cooking_question', 'chat', 'recipe', 'unknown_intent']

  const DEFAULT_LABELS = ['Try another', 'Tell me more']

  it.each(PHANTOM_INTENTS)(
    'phantom intent "%s" falls through to the default chips',
    (phantom) => {
      const chips = resolveChips(phantom)
      const labels = chips.map((c) => c.label)
      expect(labels).toEqual(DEFAULT_LABELS)
    },
  )

  it('undefined intent falls through to the default chips', () => {
    const chips = resolveChips(undefined)
    const labels = chips.map((c) => c.label)
    expect(labels).toEqual(DEFAULT_LABELS)
  })

  it('every ChatIntent value produces a non-empty chip array', () => {
    VALID_INTENTS.forEach((intent) => {
      expect(resolveChips(intent).length).toBeGreaterThan(0)
    })
  })

  it('general_chat falls through to the default (no dedicated branch needed)', () => {
    // general_chat is a valid intent but intentionally falls to default chips.
    const chips = resolveChips('general_chat')
    const labels = chips.map((c) => c.label)
    expect(labels).toEqual(DEFAULT_LABELS)
  })
})
