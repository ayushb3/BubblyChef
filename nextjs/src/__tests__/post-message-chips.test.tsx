/**
 * Issue #651 — `PostMessageChips`'s two pill kinds (send vs action) and the
 * ✎ edit affordance on send-kind chips. The resolver's row-building rules
 * (fixed sets, stamping, caps) live in `chat-chip-resolver.test.ts`
 * (`frontend`'s file) — this suite only covers what the component itself
 * does with a given `chips` array.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import PostMessageChips from '@/components/chat/PostMessageChips'
import type { ChipConfig } from '@/components/chat/PostMessageChips'

const SEND_CHIP: ChipConfig = {
  label: 'Something quicker',
  message: 'Something quicker, under 30 minutes',
  context: { meal_followup: true },
}

const ACTION_CHIP: ChipConfig = {
  label: 'Save this meal',
  message: '',
  kind: 'action',
  action: 'save_meal',
}

describe('PostMessageChips', () => {
  it('renders nothing for an empty chip list', () => {
    const { container } = render(
      <PostMessageChips chips={[]} onChipTap={jest.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('calls onChipTap with the whole chip, context included, on a pill tap', () => {
    const onChipTap = jest.fn()
    render(<PostMessageChips chips={[SEND_CHIP]} onChipTap={onChipTap} />)

    fireEvent.click(screen.getByRole('button', { name: 'Something quicker' }))
    expect(onChipTap).toHaveBeenCalledTimes(1)
    expect(onChipTap).toHaveBeenCalledWith(SEND_CHIP)
  })

  it('renders no ✎ when onEditChip is absent', () => {
    render(<PostMessageChips chips={[SEND_CHIP]} onChipTap={jest.fn()} />)
    expect(screen.queryByLabelText(/Edit ".*" before sending/)).not.toBeInTheDocument()
  })

  it('the ✎ button stages the message and never taps the pill', () => {
    const onChipTap = jest.fn()
    const onEditChip = jest.fn()
    render(
      <PostMessageChips chips={[SEND_CHIP]} onChipTap={onChipTap} onEditChip={onEditChip} />,
    )

    const editButton = screen.getByRole('button', {
      name: 'Edit "Something quicker" before sending',
    })
    fireEvent.click(editButton)

    expect(onEditChip).toHaveBeenCalledTimes(1)
    expect(onEditChip).toHaveBeenCalledWith(SEND_CHIP.message)
    expect(onChipTap).not.toHaveBeenCalled()
  })

  it('the ✎ glyph is aria-hidden', () => {
    render(
      <PostMessageChips chips={[SEND_CHIP]} onChipTap={jest.fn()} onEditChip={jest.fn()} />,
    )
    const editButton = screen.getByRole('button', {
      name: 'Edit "Something quicker" before sending',
    })
    const glyph = editButton.querySelector('[aria-hidden="true"]')
    expect(glyph).not.toBeNull()
    expect(glyph?.textContent).toBe('✎')
  })

  it('the ✎ button has at least a 32x32px hit area', () => {
    render(
      <PostMessageChips chips={[SEND_CHIP]} onChipTap={jest.fn()} onEditChip={jest.fn()} />,
    )
    const editButton = screen.getByRole('button', {
      name: 'Edit "Something quicker" before sending',
    })
    expect(editButton.className).toMatch(/\bw-8\b/)
    expect(editButton.className).toMatch(/\bh-8\b/)
  })

  it('an action chip calls onChipAction and never onChipTap', () => {
    const onChipTap = jest.fn()
    const onChipAction = jest.fn()
    render(
      <PostMessageChips
        chips={[ACTION_CHIP]}
        onChipTap={onChipTap}
        onChipAction={onChipAction}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save this meal' }))
    expect(onChipAction).toHaveBeenCalledTimes(1)
    expect(onChipAction).toHaveBeenCalledWith('save_meal')
    expect(onChipTap).not.toHaveBeenCalled()
  })

  it('an action chip renders no ✎, even with onEditChip set', () => {
    render(
      <PostMessageChips
        chips={[ACTION_CHIP]}
        onChipTap={jest.fn()}
        onChipAction={jest.fn()}
        onEditChip={jest.fn()}
      />,
    )
    expect(screen.queryByLabelText(/Edit ".*" before sending/)).not.toBeInTheDocument()
  })

  it('an action chip is not rendered at all when onChipAction is absent', () => {
    render(<PostMessageChips chips={[ACTION_CHIP, SEND_CHIP]} onChipTap={jest.fn()} />)
    expect(screen.queryByRole('button', { name: 'Save this meal' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Something quicker' })).toBeInTheDocument()
  })

  it('align="bubble" (default) keeps the mascot-gutter indent', () => {
    const { container } = render(
      <PostMessageChips chips={[SEND_CHIP]} onChipTap={jest.fn()} />,
    )
    expect(container.firstChild).toHaveClass('ml-11')
  })

  it('align="center" drops the gutter indent and centres the row', () => {
    const { container } = render(
      <PostMessageChips chips={[SEND_CHIP]} onChipTap={jest.fn()} align="center" />,
    )
    expect(container.firstChild).not.toHaveClass('ml-11')
    expect(container.firstChild).toHaveClass('justify-center')
  })
})
