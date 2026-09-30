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
  saved_recipe_lookup: true,
  meal_plan: true,
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

// ─── Issue #651 — meal_plan pill sets, the stamp, and the cap raise ──────────

describe('resolveChips — meal_plan pill sets (#651, §2)', () => {
  const OPTIONS_FIXED_LABELS = ['Something quicker', 'Make it vegetarian', 'Different ideas']
  const MEAL_UNSAVED_LABELS = ['Save this meal', 'Start cooking', 'Different options']

  it('options stage (proposalType "meal_options"), no model pills → the fixed set, all stamped', () => {
    const chips = resolveChips('meal_plan', undefined, 'meal_options')
    expect(chips.map((c) => c.label)).toEqual(OPTIONS_FIXED_LABELS)
    chips.forEach((c) => expect(c.context).toEqual({ meal_followup: true }))
  })

  it('an absent proposalType behaves like "meal_options" (the stage has not resolved yet)', () => {
    expect(resolveChips('meal_plan')).toEqual(resolveChips('meal_plan', undefined, 'meal_options'))
  })

  it('"Just one dish" is gone from the meal_plan fallback', () => {
    const chips = resolveChips('meal_plan', undefined, 'meal_options')
    expect(chips.map((c) => c.label)).not.toContain('Just one dish')
  })

  it('options stage, 1 model pill → [m1, Different ideas], both stamped (PR #666)', () => {
    const chips = resolveChips('meal_plan', ['Something with less prep'], 'meal_options')
    expect(chips.map((c) => c.label)).toEqual(['Something with less prep', 'Different ideas'])
    chips.forEach((c) => expect(c.context).toEqual({ meal_followup: true }))
  })

  it('options stage, 2 model pills → [m1, m2, Different ideas] (PR #666)', () => {
    const chips = resolveChips('meal_plan', ['Something with salmon', 'Make it spicier'], 'meal_options')
    expect(chips.map((c) => c.label)).toEqual(['Something with salmon', 'Make it spicier', 'Different ideas'])
  })

  it('options stage, 5 model pills → m1-m3 then Different ideas, capped at MAX_FOLLOW_UP_CHIPS and stamped (PR #666)', () => {
    const many = ['A?', 'B?', 'C?', 'D?', 'E?']
    const chips = resolveChips('meal_plan', many, 'meal_options')
    expect(chips.map((c) => c.label)).toEqual([...many.slice(0, 3), 'Different ideas'])
    chips.forEach((c) => expect(c.context).toEqual({ meal_followup: true }))
  })

  it('options stage drops a model pill that echoes "Different ideas" (PR #666)', () => {
    const chips = resolveChips('meal_plan', ['different ideas', 'Something with salmon'], 'meal_options')
    expect(chips.map((c) => c.label)).toEqual(['Something with salmon', 'Different ideas'])
  })

  it('meal stage, unsaved, no model pills → the fixed set in order; only "Different options" is stamped', () => {
    const chips = resolveChips('meal_plan', undefined, 'meal')
    expect(chips.map((c) => c.label)).toEqual(MEAL_UNSAVED_LABELS)
    expect(chips.map((c) => c.context?.meal_followup)).toEqual([undefined, undefined, true])
    expect(chips[0]).toMatchObject({ kind: 'action', action: 'save_meal' })
    expect(chips[1]).toMatchObject({ kind: 'action', action: 'open_meal' })
  })

  it('meal stage, saved, no model pills → [Start cooking, Different options]', () => {
    const chips = resolveChips('meal_plan', undefined, 'meal', { mealSaved: true })
    expect(chips.map((c) => c.label)).toEqual(['Start cooking', 'Different options'])
    expect(chips.some((c) => c.action === 'save_meal')).toBe(false)
  })

  it('meal stage, unsaved, 1 model pill → [m1, Save this meal, Start cooking, Different options]; m1 unstamped (#666)', () => {
    const chips = resolveChips('meal_plan', ['Can I prep ahead?'], 'meal')
    expect(chips.map((c) => c.label)).toEqual([
      'Can I prep ahead?',
      'Save this meal',
      'Start cooking',
      'Different options',
    ])
    expect(chips[0].context).toBeUndefined()
    expect(chips[chips.length - 1].context).toEqual({ meal_followup: true })
  })

  it('meal stage, saved, 2 model pills → [m1, m2, Start cooking, Different options] (#666)', () => {
    const chips = resolveChips(
      'meal_plan',
      ['Can I prep ahead?', 'What should I start first?'],
      'meal',
      { mealSaved: true },
    )
    expect(chips.map((c) => c.label)).toEqual([
      'Can I prep ahead?',
      'What should I start first?',
      'Start cooking',
      'Different options',
    ])
    expect(chips.some((c) => c.action === 'save_meal')).toBe(false)
  })

  it('meal stage, unsaved, model pills capped to leave room for both actions and fixed sends (#666)', () => {
    // 2 actions (Save this meal, Start cooking) + 1 fixed send (Different
    // options) leaves only 1 slot for model pills, even though 3 were sent.
    const chips = resolveChips(
      'meal_plan',
      ['Can I prep ahead?', 'What should I start first?', 'How do I store leftovers?'],
      'meal',
    )
    expect(chips.map((c) => c.label)).toEqual([
      'Can I prep ahead?',
      'Save this meal',
      'Start cooking',
      'Different options',
    ])
  })

  it('meal stage drops a model pill that echoes the fixed "Different options" send (PR #666 review)', () => {
    const chips = resolveChips(
      'meal_plan',
      ['different options', 'Can I prep ahead?'],
      'meal',
      { mealSaved: true },
    )
    expect(chips.map((c) => c.label)).toEqual([
      'Can I prep ahead?',
      'Start cooking',
      'Different options',
    ])
  })
})

describe('resolveChips — meal_followup stamp matrix (#651, §2)', () => {
  it('options stage stamps every send pill, fixed and model', () => {
    const chips = resolveChips('meal_plan', ['Something with less prep'], 'meal_options')
    chips.forEach((c) => expect(c.context).toEqual({ meal_followup: true }))
  })

  it('meal stage, no model pills, stamps only the fixed "Different options" send', () => {
    const chips = resolveChips('meal_plan', undefined, 'meal')
    const stamped = chips.filter((c) => c.context?.meal_followup === true)
    expect(stamped.map((c) => c.label)).toEqual(['Different options'])
  })

  it('meal stage never stamps a model pill — it is a cooking question, not an options re-ask', () => {
    const chips = resolveChips('meal_plan', ['Can I prep any of this ahead?'], 'meal')
    expect(chips[0].label).toBe('Can I prep any of this ahead?')
    expect(chips[0].context).toBeUndefined()
  })

  it('every other intent stamps nothing', () => {
    const chips = resolveChips('cooking_help', ['What internal temperature?'])
    chips.forEach((c) => expect(c.context).toBeUndefined())
  })
})

describe('resolveChips — action pills (#651)', () => {
  it('MAX_FOLLOW_UP_CHIPS is 4', () => {
    expect(MAX_FOLLOW_UP_CHIPS).toBe(4)
  })

  it('a model pill duplicating a fixed action label (case-insensitive) is dropped — the action wins', () => {
    const chips = resolveChips('meal_plan', ['save this meal', 'What should I prep first?'], 'meal')
    const saveChips = chips.filter((c) => c.label.toLowerCase() === 'save this meal')
    expect(saveChips).toHaveLength(1)
    expect(saveChips[0].kind).toBe('action')
  })

  it('an action-shaped junk entry in the suggestions array is dropped, leaving only send pills', () => {
    const chips = resolveChips('cooking_help', [{ kind: 'action', action: 'save_meal' }, 'Ok?'])
    expect(chips.map((c) => c.label)).toContain('Ok?')
    chips.forEach((c) => {
      expect(c.kind).not.toBe('action')
      expect(c.action).toBeUndefined()
    })
  })
})

describe('resolveChips — never empty, never over the cap, across meal_plan × suggestions (#651)', () => {
  const PROPOSAL_TYPES: (string | undefined)[] = ['meal_options', 'meal', undefined]
  const SAVED_STATES = [true, false]
  const SUGGESTION_CASES: unknown[] = [
    undefined,
    ['', '   ', 7, null],
    ['Only one?'],
    ['A?', 'B?', 'C?', 'D?', 'E?', 'F?'],
  ]

  it('is never empty and never exceeds MAX_FOLLOW_UP_CHIPS for any combination', () => {
    VALID_INTENTS.forEach((intent) => {
      PROPOSAL_TYPES.forEach((proposalType) => {
        SAVED_STATES.forEach((mealSaved) => {
          SUGGESTION_CASES.forEach((suggestions) => {
            const chips = resolveChips(intent, suggestions, proposalType, { mealSaved })
            expect(chips.length).toBeGreaterThan(0)
            expect(chips.length).toBeLessThanOrEqual(MAX_FOLLOW_UP_CHIPS)
          })
        })
      })
    })
  })

  it('resolveStaticChips matches resolveChips with no suggestions across every meal_plan proposalType/mealSaved combination', () => {
    PROPOSAL_TYPES.forEach((proposalType) => {
      SAVED_STATES.forEach((mealSaved) => {
        expect(resolveChips('meal_plan', undefined, proposalType, { mealSaved })).toEqual(
          resolveStaticChips('meal_plan', proposalType, { mealSaved }),
        )
      })
    })
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

// ─── Issue #651 PR B — fixed-main pill swap ──────────────────────────────────

describe('resolveChips / resolveStaticChips — fixedMain (#651 PR B, §8a)', () => {
  const FIXED_LABELS = ['Quicker sides', 'Lighter sides', 'Different ideas']
  const ORDINARY_LABELS = ['Something quicker', 'Make it vegetarian', 'Different ideas']

  it('swaps the two main-changing pills in place, both stamped', () => {
    const chips = resolveChips('meal_plan', undefined, 'meal_options', { fixedMain: true })
    expect(chips.map((c) => c.label)).toEqual(FIXED_LABELS)
    expect(chips[0]).toMatchObject({ message: 'Quicker sides, under 20 minutes', emoji: '⚡', tone: 'fresh' })
    expect(chips[1]).toMatchObject({ message: 'Make the sides lighter', emoji: '🥗', tone: 'accent' })
    chips.forEach((c) => expect(c.context).toEqual({ meal_followup: true }))
  })

  it('also applies when the proposalType is absent (the stage has not resolved)', () => {
    const chips = resolveChips('meal_plan', undefined, undefined, { fixedMain: true })
    expect(chips.map((c) => c.label)).toEqual(FIXED_LABELS)
  })

  it('leaves the set unchanged without fixedMain', () => {
    expect(resolveChips('meal_plan', undefined, 'meal_options').map((c) => c.label)).toEqual(
      ORDINARY_LABELS,
    )
    expect(
      resolveChips('meal_plan', undefined, 'meal_options', { fixedMain: false }).map((c) => c.label),
    ).toEqual(ORDINARY_LABELS)
  })

  it('a model pill still fills the row, with the reserved "Different ideas" kept', () => {
    const chips = resolveChips('meal_plan', ['Add a green side'], 'meal_options', { fixedMain: true })
    expect(chips.map((c) => c.label)).toEqual(['Add a green side', 'Different ideas'])
  })

  it('has no effect on the meal stage', () => {
    expect(resolveChips('meal_plan', undefined, 'meal', { fixedMain: true })).toEqual(
      resolveChips('meal_plan', undefined, 'meal'),
    )
  })

  it('has no effect on other intents', () => {
    for (const intent of ['recipe_card', 'cooking_help', 'pantry_update', 'saved_recipe_lookup', undefined]) {
      expect(resolveChips(intent, undefined, undefined, { fixedMain: true })).toEqual(
        resolveChips(intent),
      )
    }
  })

  it('keeps mealSaved working alongside fixedMain', () => {
    const chips = resolveChips('meal_plan', undefined, 'meal', { fixedMain: true, mealSaved: true })
    expect(chips.map((c) => c.label)).not.toContain('Save this meal')
  })

  it('resolveStaticChips equals resolveChips with no suggestions, for the fixedMain cases too', () => {
    for (const proposalType of ['meal_options', 'meal', undefined]) {
      for (const opts of [{ fixedMain: true }, { fixedMain: true, mealSaved: true }, { fixedMain: false }]) {
        expect(resolveStaticChips('meal_plan', proposalType, opts)).toEqual(
          resolveChips('meal_plan', undefined, proposalType, opts),
        )
      }
    }
  })
})
