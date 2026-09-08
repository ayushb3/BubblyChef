/**
 * #340 — inline qty/unit clarification on pantry proposal action rows.
 *
 * Three things to pin:
 *  1. An action with `unit: "item"` shows the inline editor.
 *  2. An action with a real parsed unit does NOT show the editor.
 *  3. Editing qty/unit and then approving sends the edited values, not the
 *     original backend defaults.
 *
 * Tests 1 & 2 are component-level (RTL render of PantryProposalCard).
 * Test 3 is hook-level (renderHook of useChat) so it exercises the full
 * state path without needing to mount the full chat page.
 */

import { act, renderHook } from '@testing-library/react'
import { render, screen, fireEvent } from '@testing-library/react'
import PantryProposalCard from '@/components/chat/PantryProposalCard'
import { useChat } from '@/hooks/useChat'
import type { PantryProposalData, ChatResponse, PantryProposalAction } from '@/types/chat'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const streamChatMessage = jest.fn()
const applyPantryProposal = jest.fn()

jest.mock('@/lib/api/chat', () => ({
  streamChatMessage: (...args: unknown[]) => streamChatMessage(...args),
  fetchChatHistory: jest.fn().mockResolvedValue([]),
  applyPantryProposal: (...args: unknown[]) => applyPantryProposal(...args),
}))

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}))

global.fetch = jest.fn().mockResolvedValue({ ok: true })

beforeEach(() => {
  streamChatMessage.mockReset()
  applyPantryProposal.mockReset()
  applyPantryProposal.mockResolvedValue({
    success: true,
    appliedCount: 1,
    failedCount: 0,
    errors: [],
  })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProposal(actions: PantryProposalAction[]): PantryProposalData {
  return { actions }
}

function baseResponse(overrides: Partial<ChatResponse>): ChatResponse {
  return {
    request_id: 'req-1',
    workflow_id: 'wf-1',
    conversation_id: 'conv-1',
    intent: 'pantry_update',
    assistant_message: 'Please review before updating your pantry.',
    proposal: null,
    confidence: { overall: 0.8 },
    requires_review: true,
    next_action: 'review_proposal',
    ...overrides,
  }
}

/** Fire the onDone callback for the last streamChatMessage call. */
function respondWith(response: ChatResponse) {
  const [, , onDone] = streamChatMessage.mock.calls[streamChatMessage.mock.calls.length - 1]
  act(() => { onDone(response) })
}

// ─── 1. unit:"item" shows the inline editor ───────────────────────────────────

describe('ActionRow inline qty editor visibility', () => {
  it('shows the qty editor when unit is "item"', () => {
    const proposal = makeProposal([
      { action_type: 'add', item: { name: 'Eggs', quantity: 12, unit: 'item' }, confidence: 0.75 },
    ])
    render(
      <PantryProposalCard
        proposal={proposal}
        onApprove={jest.fn()}
        onReject={jest.fn()}
        state="pending"
      />
    )
    // The "how much?" label only appears when the editor is shown
    expect(screen.getByText('how much?')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /quantity for eggs/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /unit for eggs/i })).toBeInTheDocument()
  })

  it('shows the qty editor when quantity is null/undefined', () => {
    const proposal = makeProposal([
      { action_type: 'add', item: { name: 'Flour', quantity: undefined, unit: 'bag' }, confidence: 0.8 },
    ])
    render(
      <PantryProposalCard
        proposal={proposal}
        onApprove={jest.fn()}
        onReject={jest.fn()}
        state="pending"
      />
    )
    expect(screen.getByText('how much?')).toBeInTheDocument()
  })

  it('does NOT show the qty editor when unit is a real parsed unit', () => {
    const proposal = makeProposal([
      { action_type: 'add', item: { name: 'Milk', quantity: 2, unit: 'litres' }, confidence: 0.95 },
    ])
    render(
      <PantryProposalCard
        proposal={proposal}
        onApprove={jest.fn()}
        onReject={jest.fn()}
        state="pending"
      />
    )
    expect(screen.queryByText('how much?')).not.toBeInTheDocument()
    // Quantity is shown as static text alongside the item name instead
    expect(screen.getByText(/2 litres/)).toBeInTheDocument()
  })

  it('shows real-unit item alongside an item-unit item correctly', () => {
    const proposal = makeProposal([
      { action_type: 'add', item: { name: 'Milk', quantity: 2, unit: 'litres' }, confidence: 0.95 },
      { action_type: 'add', item: { name: 'Eggs', quantity: 12, unit: 'item' }, confidence: 0.75 },
    ])
    render(
      <PantryProposalCard
        proposal={proposal}
        onApprove={jest.fn()}
        onReject={jest.fn()}
        state="pending"
      />
    )
    // Editor only for Eggs
    expect(screen.getByText('how much?')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /quantity for eggs/i })).toBeInTheDocument()
    // No second editor for Milk
    expect(screen.queryByRole('spinbutton', { name: /quantity for milk/i })).not.toBeInTheDocument()
  })
})

// ─── 2. onActionsChange fires with edited values ──────────────────────────────

describe('ActionRow inline qty editor — onChange', () => {
  it('calls onActionsChange with updated quantity and unit on blur', () => {
    const proposal = makeProposal([
      { action_type: 'add', item: { name: 'Eggs', quantity: 12, unit: 'item' }, confidence: 0.75 },
    ])
    const onActionsChange = jest.fn()
    render(
      <PantryProposalCard
        proposal={proposal}
        onApprove={jest.fn()}
        onReject={jest.fn()}
        state="pending"
        onActionsChange={onActionsChange}
      />
    )

    const qtyInput = screen.getByRole('spinbutton', { name: /quantity for eggs/i })
    const unitInput = screen.getByRole('textbox', { name: /unit for eggs/i })

    fireEvent.change(qtyInput, { target: { value: '2' } })
    fireEvent.blur(qtyInput)

    expect(onActionsChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({ name: 'Eggs', quantity: 2 }),
        }),
      ])
    )

    fireEvent.change(unitInput, { target: { value: 'dozen' } })
    fireEvent.blur(unitInput)

    expect(onActionsChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({ name: 'Eggs', quantity: 2, unit: 'dozen' }),
        }),
      ])
    )
  })
})

// ─── 3. Edited values reach the DB write via useChat ─────────────────────────

describe('useChat — edited qty/unit flows through to applyPantryProposal', () => {
  it('sends edited actions when the user changes qty/unit before approving', async () => {
    const { result } = renderHook(() => useChat())

    // Simulate a chat response with a "1 item" default for eggs
    const response = baseResponse({
      proposal: {
        actions: [
          { action_type: 'add', item: { name: 'Eggs', quantity: 1, unit: 'item' }, confidence: 0.75 },
        ],
      },
    })

    act(() => { result.current.sendMessage('add a dozen eggs') })
    respondWith(response)

    const msgId = result.current.messages[1].id

    // Simulate the user editing the qty/unit inline (what PantryProposalCard
    // would call via onActionsChange after the user types "12" and "dozen")
    const editedActions: PantryProposalAction[] = [
      { action_type: 'add', item: { name: 'Eggs', quantity: 12, unit: 'dozen' }, confidence: 0.75 },
    ]
    act(() => {
      result.current.updateProposalActions(msgId, editedActions)
    })

    // Approve — should send the edited actions, not the original backend ones
    await act(async () => {
      await result.current.approveProposal(msgId)
    })

    expect(applyPantryProposal).toHaveBeenCalledTimes(1)
    const [, sentActions] = applyPantryProposal.mock.calls[0] as [string, PantryProposalAction[]]
    expect(sentActions).toHaveLength(1)
    expect(sentActions[0].item.quantity).toBe(12)
    expect(sentActions[0].item.unit).toBe('dozen')
  })

  it('sends original backend values when the user does not edit', async () => {
    const { result } = renderHook(() => useChat())

    const response = baseResponse({
      proposal: {
        actions: [
          { action_type: 'add', item: { name: 'Milk', quantity: 2, unit: 'litres' }, confidence: 0.9 },
        ],
      },
    })

    act(() => { result.current.sendMessage('add 2 litres of milk') })
    respondWith(response)

    const msgId = result.current.messages[1].id

    // No updateProposalActions call — user did not edit anything

    await act(async () => {
      await result.current.approveProposal(msgId)
    })

    expect(applyPantryProposal).toHaveBeenCalledTimes(1)
    const [, sentActions] = applyPantryProposal.mock.calls[0] as [string, PantryProposalAction[]]
    expect(sentActions[0].item.quantity).toBe(2)
    expect(sentActions[0].item.unit).toBe('litres')
  })

  it('updateProposalActions is a no-op when msgId has no pending proposal', () => {
    const { result } = renderHook(() => useChat())
    // Should not throw for an unknown msgId
    act(() => {
      result.current.updateProposalActions('unknown-id', [
        { action_type: 'add', item: { name: 'Apples', quantity: 3 }, confidence: 0.8 },
      ])
    })
    // Nothing in pendingProposals state to assert, but the hook stays stable
    expect(result.current.messages).toHaveLength(0)
  })

  /**
   * #340 code-review finding #1/#2: edit-then-merge desync.
   *
   * Repro sequence:
   *   turn 1 → backend returns Eggs with "1 item" (meaningless default)
   *   user edits Eggs to "12 dozen" via inline editor
   *   turn 2 → backend merges a new item (Milk) into the same card
   *
   * Before the fix: the merged card displayed Eggs as "1 item" (editor
   * re-open, visual edit lost) even though approve would write "12 dozen".
   * After the fix: both the DISPLAYED rows AND the applied actions must
   * reflect the edit (Eggs = 12 dozen, Milk = 2 litres).
   */
  it('edit-then-merge: displayed proposal and applied actions both reflect the user edit', async () => {
    const { result } = renderHook(() => useChat())

    // Turn 1: Eggs with the backend's "1 item" default
    const turn1Response = baseResponse({
      request_id: 'req-turn1',
      workflow_id: 'wf-turn1',
      assistant_message: 'Got eggs. Review before adding.',
      proposal: {
        actions: [
          { action_type: 'add', item: { name: 'Eggs', quantity: 1, unit: 'item' }, confidence: 0.75 },
        ],
      },
    })

    act(() => { result.current.sendMessage('add a dozen eggs') })
    respondWith(turn1Response)

    const turn1AssistantId = result.current.messages[1].id

    // User edits Eggs inline: 1 item → 12 dozen
    const editedActions: PantryProposalAction[] = [
      { action_type: 'add', item: { name: 'Eggs', quantity: 12, unit: 'dozen' }, confidence: 0.75 },
    ]
    act(() => {
      result.current.updateProposalActions(turn1AssistantId, editedActions)
    })

    // Turn 2: a new item (Milk) triggers a merge into the existing card
    const turn2Response = baseResponse({
      request_id: 'req-turn2',
      workflow_id: 'wf-turn2',
      assistant_message: '(Still with eggs from earlier.) Got milk too.',
      proposal: {
        actions: [
          { action_type: 'add', item: { name: 'Milk', quantity: 2, unit: 'litres' }, confidence: 0.9 },
        ],
      },
    })

    act(() => { result.current.sendMessage('also add 2 litres of milk') })
    respondWith(turn2Response)

    // The card migrated to turn2 — verify the hook state
    const turn2AssistantId = result.current.messages[3].id
    expect(result.current.proposalStates[turn2AssistantId]).toBe('pending')
    // The old card owner must have its proposal stripped
    expect(result.current.messages[1].response?.proposal).toBeNull()

    // ── Assert the DISPLAYED actions on the merged card ──
    // The merged card's proposal.actions (what PantryProposalCard renders) must
    // show Eggs with the edited values (12 dozen), not the original backend (1 item).
    const turn2Msg = result.current.messages[3]
    const mergedProposal = turn2Msg.response?.proposal as PantryProposalData | null
    expect(mergedProposal?.actions).toHaveLength(2)

    const displayedEggs = mergedProposal?.actions.find(
      (a) => a.item.name.toLowerCase() === 'eggs',
    )
    expect(displayedEggs?.item.quantity).toBe(12)
    expect(displayedEggs?.item.unit).toBe('dozen')

    const displayedMilk = mergedProposal?.actions.find(
      (a) => a.item.name.toLowerCase() === 'milk',
    )
    expect(displayedMilk?.item.quantity).toBe(2)
    expect(displayedMilk?.item.unit).toBe('litres')

    // ── Assert the APPLIED actions reach the DB with the edit ──
    await act(async () => {
      await result.current.approveProposal(turn2AssistantId)
    })

    expect(applyPantryProposal).toHaveBeenCalledTimes(1)
    const [, sentActions] = applyPantryProposal.mock.calls[0] as [string, PantryProposalAction[]]
    expect(sentActions).toHaveLength(2)

    const sentEggs = sentActions.find((a) => a.item.name.toLowerCase() === 'eggs')
    expect(sentEggs?.item.quantity).toBe(12)
    expect(sentEggs?.item.unit).toBe('dozen')

    const sentMilk = sentActions.find((a) => a.item.name.toLowerCase() === 'milk')
    expect(sentMilk?.item.quantity).toBe(2)
    expect(sentMilk?.item.unit).toBe('litres')
  })
})
