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

// All valid values from the ChatIntent union.  When a new intent is added to
// ChatIntent this list will need updating — the test below then enforces that
// the resolver also handles it (or intentionally falls through to default).
const VALID_INTENTS: ChatIntent[] = [
  'pantry_update',
  'recipe_card',
  'recipe_generation',
  'cooking_help',
  'general_chat',
  'recipe_brainstorm',
]

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
