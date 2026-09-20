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

import {
  resolveChips,
  resolveStaticChips,
  sanitiseFollowUps,
  COOKING_CHIPS,
  MAX_FOLLOW_UP_CHIPS,
  MIN_FOLLOW_UP_CHIPS,
  MAX_FOLLOW_UP_LENGTH,
} from '@/lib/chat-chips'
import { getFollowUpSuggestions } from '@/types/chat'
import type { ChatIntent, ChatResponse } from '@/types/chat'

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

// ─── Context-aware follow-ups (#498) ──────────────────────────────────────────
//
// `resolveChips(intent, suggestions?)` prefers the backend's
// `metadata.follow_up_suggestions` when at least one survives sanitising,
// tops the row up to MIN_FOLLOW_UP_CHIPS from the static set, and falls back
// to the static set entirely otherwise. It never returns an empty array.

const CHICKEN_SUGGESTIONS = [
  'What internal temperature?',
  'How long should it rest?',
  'Can I use a thermometer?',
]

function envelope(metadata: Record<string, unknown> | null | undefined): ChatResponse {
  return {
    request_id: 'r',
    workflow_id: 'w',
    conversation_id: null,
    intent: 'cooking_help',
    assistant_message: 'Chicken is done at 74°C.',
    proposal: null,
    confidence: { overall: 1 },
    requires_review: false,
    next_action: 'none',
    metadata,
  } as ChatResponse
}

describe('resolveChips — prefers backend follow-up suggestions (#498)', () => {
  it('renders the suggestions as chips instead of the static cooking set', () => {
    const chips = resolveChips('cooking_help', CHICKEN_SUGGESTIONS)
    expect(chips.map((c) => c.label)).toEqual(CHICKEN_SUGGESTIONS)
    expect(chips.map((c) => c.message)).toEqual(CHICKEN_SUGGESTIONS)
    expect(chips.map((c) => c.label)).not.toContain('What can I substitute?')
  })

  it('gives every contextual chip a tone and an emoji, with no emoji in message', () => {
    const chips = resolveChips('cooking_help', CHICKEN_SUGGESTIONS)
    chips.forEach((chip) => {
      expect(chip.tone).toBeDefined()
      expect(chip.emoji).toBeDefined()
      expect(chip.message).not.toMatch(/\p{Emoji_Presentation}/u)
    })
  })

  it('applies to every intent, not only cooking_help', () => {
    ;['general_chat', 'recipe_brainstorm', 'pantry_update', undefined].forEach((intent) => {
      const chips = resolveChips(intent, ['Follow up one?', 'Follow up two?'])
      expect(chips.map((c) => c.label)).toEqual(['Follow up one?', 'Follow up two?'])
    })
  })

  it('caps the row at MAX_FOLLOW_UP_CHIPS even when the model returns more', () => {
    const many = ['One?', 'Two?', 'Three?', 'Four?', 'Five?']
    const chips = resolveChips('cooking_help', many)
    expect(chips).toHaveLength(MAX_FOLLOW_UP_CHIPS)
    expect(chips.map((c) => c.label)).toEqual(many.slice(0, MAX_FOLLOW_UP_CHIPS))
  })

  it('tops a single usable suggestion up to MIN_FOLLOW_UP_CHIPS from the static set', () => {
    const chips = resolveChips('cooking_help', ['What internal temperature?'])
    expect(chips).toHaveLength(MIN_FOLLOW_UP_CHIPS)
    expect(chips[0].label).toBe('What internal temperature?')
    expect(chips[1]).toBe(COOKING_CHIPS[0])
  })

  it('does not top up with a static chip that duplicates a suggestion', () => {
    const chips = resolveChips('cooking_help', ['what can i substitute?'])
    expect(chips.map((c) => c.label.toLowerCase())).toEqual([
      'what can i substitute?',
      'how do i prep this?',
    ])
  })
})

describe('resolveChips — static fallback is the safety net (#498)', () => {
  it('no suggestions argument → the static set (unchanged behaviour)', () => {
    expect(resolveChips('cooking_help')).toBe(COOKING_CHIPS)
  })

  it.each([undefined, null, [], 'not an array', 42, {}])(
    'suggestions %p → the static set',
    (bad) => {
      expect(resolveChips('cooking_help', bad)).toBe(COOKING_CHIPS)
      expect(resolveChips('general_chat', bad).map((c) => c.label)).toEqual([
        'Try another',
        'Tell me more',
      ])
    },
  )

  it('one 200-char suggestion → dropped, static set renders', () => {
    const chips = resolveChips('cooking_help', ['x'.repeat(200)])
    expect(chips).toBe(COOKING_CHIPS)
  })

  it('all-junk suggestions (empty, whitespace, non-strings, links) → static set', () => {
    const junk = ['', '   ', 7, null, 'see https://example.com', 'www.example.com/x', '**']
    expect(resolveChips('cooking_help', junk)).toBe(COOKING_CHIPS)
  })

  it('never returns an empty array for any intent and any suggestions input', () => {
    const inputs: unknown[] = [undefined, [], [''], ['x'.repeat(61)], [1, 2], ['ok?']]
    const intents = [...VALID_INTENTS, undefined]
    intents.forEach((intent) =>
      inputs.forEach((input) => {
        expect(resolveChips(intent, input).length).toBeGreaterThan(0)
      }),
    )
  })

  it('resolveStaticChips matches resolveChips with no suggestions for every intent', () => {
    VALID_INTENTS.forEach((intent) => {
      expect(resolveChips(intent)).toEqual(resolveStaticChips(intent))
    })
  })
})

describe('sanitiseFollowUps (#498)', () => {
  it('strips markdown, links and emoji, and collapses whitespace', () => {
    expect(
      sanitiseFollowUps([
        '**What  internal temperature?**',
        '- How long should it rest? 🍗',
        '1. `Can` I _use_ a [thermometer](x)?',
      ]),
    ).toEqual(['What internal temperature?', 'How long should it rest?', 'Can I use a thermometer?'])
  })

  it('drops empties, over-length strings, URLs and non-strings', () => {
    expect(
      sanitiseFollowUps(['', ' ', 'y'.repeat(MAX_FOLLOW_UP_LENGTH + 1), 'http://a.b', 3, 'ok?']),
    ).toEqual(['ok?'])
  })

  it('keeps a string exactly at the length cap', () => {
    const atCap = 'z'.repeat(MAX_FOLLOW_UP_LENGTH)
    expect(sanitiseFollowUps([atCap])).toEqual([atCap])
  })

  it('dedupes case-insensitively, keeping the first spelling', () => {
    expect(sanitiseFollowUps(['How long?', 'how long?', 'HOW LONG?', 'Rest?'])).toEqual([
      'How long?',
      'Rest?',
    ])
  })

  it('caps at MAX_FOLLOW_UP_CHIPS', () => {
    expect(sanitiseFollowUps(['a?', 'b?', 'c?', 'd?'])).toHaveLength(MAX_FOLLOW_UP_CHIPS)
  })

  it('returns [] for non-array input without throwing', () => {
    expect(sanitiseFollowUps(undefined)).toEqual([])
    expect(sanitiseFollowUps('a?')).toEqual([])
    expect(sanitiseFollowUps({ 0: 'a?' })).toEqual([])
  })
})

describe('getFollowUpSuggestions (#498)', () => {
  it('reads metadata.follow_up_suggestions and keeps only strings', () => {
    expect(getFollowUpSuggestions(envelope({ follow_up_suggestions: ['a?', 1, 'b?'] }))).toEqual([
      'a?',
      'b?',
    ])
  })

  it('returns [] when metadata is absent, null, or the field is not an array', () => {
    expect(getFollowUpSuggestions(envelope(undefined))).toEqual([])
    expect(getFollowUpSuggestions(envelope(null))).toEqual([])
    expect(getFollowUpSuggestions(envelope({ follow_up_suggestions: 'nope' }))).toEqual([])
    expect(getFollowUpSuggestions(envelope({ brainstorm_ideas: ['x'] }))).toEqual([])
    expect(getFollowUpSuggestions(undefined)).toEqual([])
  })

  it('end to end: envelope with no suggestions → static chips still render', () => {
    const chips = resolveChips('cooking_help', getFollowUpSuggestions(envelope({})))
    expect(chips).toBe(COOKING_CHIPS)
  })

  it('end to end: envelope with suggestions → contextual chips render', () => {
    const chips = resolveChips(
      'cooking_help',
      getFollowUpSuggestions(envelope({ follow_up_suggestions: CHICKEN_SUGGESTIONS })),
    )
    expect(chips.map((c) => c.label)).toEqual(CHICKEN_SUGGESTIONS)
  })
})
