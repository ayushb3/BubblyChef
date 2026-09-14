/**
 * Tests for #341 (hide resolved clarification pills) and #342 (strip
 * combined context prefix from reply bubbles).
 *
 * #341 — filterResolvedTerms: once a term's suggestions appear in the
 * merged actions list, that term's pill row must not be passed to the
 * component. Tested at the pure helper level since the filter runs inside
 * useChat's onDone before writing to state.
 *
 * #342 — the frontend regex: the "(still with/don't know...)" prefix emitted
 * by review_gate must be stripped even when both clauses appear in one
 * combined parenthetical. Tested directly against the regex used in useChat.
 */

import { filterResolvedTerms } from '@/types/chat'
import type { PantryProposalAction, TermSuggestion } from '@/types/chat'

// ─── helpers ──────────────────────────────────────────────────────────────────

function action(name: string): PantryProposalAction {
  return { action_type: 'add', item: { name }, confidence: 0.9 }
}

function term(t: string, suggestions: string[]): TermSuggestion {
  return { term: t, suggestions }
}

// ─── filterResolvedTerms (#341) ────────────────────────────────────────────────

describe('filterResolvedTerms (#341)', () => {
  const veggiesTerm = term('vegetables', ['onion', 'broccoli', 'carrot', 'spinach'])
  const dairyTerm = term('dairy products', ['milk', 'yogurt', 'butter', 'cheese'])

  it('keeps all terms when no actions are present', () => {
    expect(filterResolvedTerms([veggiesTerm, dairyTerm], [])).toEqual([veggiesTerm, dairyTerm])
  })

  it('removes a term when any of its suggestions appears in actions', () => {
    const result = filterResolvedTerms(
      [veggiesTerm, dairyTerm],
      [action('onion'), action('broccoli')],
    )
    // "onion" and "broccoli" are in veggiesTerm.suggestions → drop it
    // "milk"/"yogurt" etc. are not in actions → keep dairyTerm
    expect(result).toEqual([dairyTerm])
  })

  it('removes both terms when both have suggestions in actions', () => {
    const result = filterResolvedTerms(
      [veggiesTerm, dairyTerm],
      [action('broccoli'), action('milk')],
    )
    expect(result).toHaveLength(0)
  })

  it('keeps a term whose suggestions do not appear in any action', () => {
    // Actions are eggs + apples — neither is a suggestion for veggies/dairy
    const result = filterResolvedTerms(
      [veggiesTerm, dairyTerm],
      [action('eggs'), action('apples')],
    )
    expect(result).toEqual([veggiesTerm, dairyTerm])
  })

  it('is case-insensitive for both suggestions and action names', () => {
    const mixedAction = action('Onion') // capitalised in the actions list
    const result = filterResolvedTerms([veggiesTerm], [mixedAction])
    // "Onion".toLowerCase() === "onion" which is in suggestions
    expect(result).toHaveLength(0)
  })

  it('keeps a term with no suggestions regardless of actions', () => {
    const emptyTerm = term('stuff', [])
    const result = filterResolvedTerms([emptyTerm], [action('onion')])
    // No suggestions → no possible overlap → never resolved by this logic
    expect(result).toEqual([emptyTerm])
  })

  it('returns empty array when starting with no terms', () => {
    expect(filterResolvedTerms([], [action('onion')])).toEqual([])
  })
})

// ─── context-prefix regex (#342) ──────────────────────────────────────────────

/**
 * The regex from useChat.ts onDone content-cleanup step.
 * Extracted here for isolated testing — the point is the regex shape,
 * not the full streaming machinery.
 */
const CONTEXT_PREFIX_RE = /^\([^)]*(?:still with|still don't know)[^)]*\)\s*/i

function stripPrefix(s: string): string {
  return s.replace(CONTEXT_PREFIX_RE, '').trim()
}

describe('context-prefix regex (#342)', () => {
  it('strips a "still with" only prefix', () => {
    const input =
      '(still with eggs, apples from earlier in this chat.) I found 2 items.'
    expect(stripPrefix(input)).toBe('I found 2 items.')
  })

  it("strips a \"still don't know\" only prefix", () => {
    const input =
      "(still don't know what you meant by vegetables.) I couldn't add that."
    expect(stripPrefix(input)).toBe("I couldn't add that.")
  })

  it('strips a combined two-clause prefix (the bug case)', () => {
    const input =
      '(still with eggs, apples, onion, broccoli, cheese, milk from earlier in this chat;' +
      " still don't know what you meant by vegetables, dairy products.) I found 2 items. Please review..."
    expect(stripPrefix(input)).toBe('I found 2 items. Please review...')
  })

  it('does not strip a normal sentence starting with a parenthetical', () => {
    // A parenthetical that does NOT contain "still with" or "still don't know"
    const input = '(Note: this is optional.) Here is your recipe.'
    expect(stripPrefix(input)).toBe('(Note: this is optional.) Here is your recipe.')
  })

  it('handles trailing whitespace after the closing paren', () => {
    const input =
      "(still with milk from earlier.)   The updated list looks good."
    expect(stripPrefix(input)).toBe('The updated list looks good.')
  })

  it('is case-insensitive', () => {
    const input = '(STILL WITH milk from earlier.) The items are below.'
    expect(stripPrefix(input)).toBe('The items are below.')
  })

  it('does not strip when the prefix is not at the start', () => {
    const input = 'Here is a note. (still with eggs.) Some text.'
    // The regex anchors with ^ so mid-string occurrences are untouched.
    expect(stripPrefix(input)).toBe('Here is a note. (still with eggs.) Some text.')
  })
})
