/**
 * Issue #847 — meal options survive a resume.
 *
 * A restored thread used to stamp `next_action: 'none'` on every turn, and the
 * page only draws option cards for `pick_meal`, so leaving chat after planning
 * dinner brought back the text and chips but not the cards. The latest option
 * set that was never picked restores armed (`pick_meal`); an older set, or one
 * already picked, restores with `none` and the page draws it read-only.
 */
import { buildRestoredThread } from '@/lib/chat-restore'
import type { ConversationHistoryTurn } from '@/types/chat'

const CONV = 'conv-meal-restore'
const AT = '2026-10-01T12:00:00+00:00'

function optionsTurn(label: string): ConversationHistoryTurn {
  return {
    role: 'assistant',
    content: `Options ${label}`,
    intent: 'meal_plan',
    proposal: {
      proposal_type: 'meal_options',
      options: [
        {
          option_id: `${label}-1`,
          title: `Dinner ${label}`,
          blurb: '',
          dishes: [
            { role: 'main', name: 'Main', key_ingredients: [], est_total_minutes: 30, est_hands_on_minutes: 10 },
          ],
          est_total_minutes: 30,
          est_hands_on_minutes: 10,
          coverage: null,
          rescues: [],
        },
      ],
      servings: 2,
      constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
    },
    metadata: { request_id: `req-${label}` },
    created_at: AT,
  } as unknown as ConversationHistoryTurn
}

function mealTurn(): ConversationHistoryTurn {
  return {
    role: 'assistant',
    content: 'Your meal',
    intent: 'meal_plan',
    proposal: {
      proposal_type: 'meal',
      meal_ref: 'ref-1',
      title: 'Dinner A',
      servings: 2,
      constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
      dishes: [],
      missing_ingredients: [],
    },
    metadata: {},
    created_at: AT,
  } as unknown as ConversationHistoryTurn
}

const user = (content: string): ConversationHistoryTurn => ({
  role: 'user',
  content,
  intent: null,
  created_at: AT,
})

const assistantText = (content: string): ConversationHistoryTurn => ({
  role: 'assistant',
  content,
  intent: 'general_chat',
  created_at: AT,
})

const nextActions = (turns: ConversationHistoryTurn[]) =>
  buildRestoredThread(turns, CONV).messages.map((m) => m.response?.next_action)

describe('buildRestoredThread — meal options (#847)', () => {
  it('restores the latest unpicked option set as pick_meal, with the proposal intact', () => {
    const { messages } = buildRestoredThread([user('plan dinner'), optionsTurn('A')], CONV)
    expect(messages[1].response?.next_action).toBe('pick_meal')
    expect(messages[1].response?.proposal).toMatchObject({ proposal_type: 'meal_options' })
  })

  it('restores an already-picked option set as none (the meal turn follows it)', () => {
    expect(
      nextActions([user('plan dinner'), optionsTurn('A'), user('Dinner A'), mealTurn()]),
    ).toEqual([undefined, 'none', undefined, 'none'])
  })

  it('restores an older option set as none and only the newest as pick_meal', () => {
    expect(
      nextActions([
        user('plan dinner'),
        optionsTurn('A'),
        user('Show me different meal options'),
        optionsTurn('B'),
      ]),
    ).toEqual([undefined, 'none', undefined, 'pick_meal'])
  })

  it('a set stays pickable when only a plain reply follows it', () => {
    expect(
      nextActions([user('plan dinner'), optionsTurn('A'), user('thanks'), assistantText('Anytime!')]),
    ).toEqual([undefined, 'pick_meal', undefined, undefined])
  })

  it('a newer set that was picked leaves every earlier set read-only', () => {
    expect(
      nextActions([optionsTurn('A'), optionsTurn('B'), mealTurn()]),
    ).toEqual(['none', 'none', 'none'])
  })

  it('leaves non-option turns on none', () => {
    expect(nextActions([user('hi'), assistantText('hello')])).toEqual([undefined, undefined])
  })
})
