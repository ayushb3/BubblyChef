/**
 * Issue #851 — "Used some": "I used half the milk" no longer means the full edit
 * form. A fourth key on the resolve strip opens quick amounts (a half, a quarter)
 * and a custom amount; the parent subtracts it from the quantity. Using as much
 * as is there is just "Used it".
 */
import { fireEvent, render, screen } from '@testing-library/react'
import ResolveActions from '@/components/pantry/ResolveActions'

function renderActions(props: Partial<React.ComponentProps<typeof ResolveActions>> = {}) {
  const onResolve = jest.fn()
  const onUseSome = jest.fn()
  render(
    <ResolveActions
      itemName="milk"
      onResolve={onResolve}
      variant="pills"
      quantity={2}
      unit="L"
      onUseSome={onUseSome}
      {...props}
    />,
  )
  return { onResolve, onUseSome }
}

const openPicker = () => fireEvent.click(screen.getByRole('button', { name: 'Mark some of milk as used' }))

describe('ResolveActions: Used some (#851)', () => {
  it('adds no key unless the parent can take an amount', () => {
    renderActions({ onUseSome: undefined })
    expect(screen.queryByRole('button', { name: /some of milk/i })).not.toBeInTheDocument()
  })

  it('puts the key between Used it and Tossed', () => {
    renderActions()
    const used = screen.getByRole('button', { name: 'Mark milk as used up' })
    const some = screen.getByRole('button', { name: 'Mark some of milk as used' })
    const tossed = screen.getByRole('button', { name: 'Mark milk as tossed' })
    expect(Array.from(used.parentElement!.children)).toEqual([used, some, tossed])
    expect(some).toHaveAttribute('title', 'Used some')
    expect(some.className).toContain('min-h-[44px]')
  })

  it('"half" uses half the quantity', () => {
    const { onUseSome, onResolve } = renderActions({ quantity: 2, unit: 'L' })
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: /Used half of milk/i }))
    expect(onUseSome).toHaveBeenCalledWith(1)
    expect(onResolve).not.toHaveBeenCalled()
  })

  it('"a quarter" uses a quarter of the quantity', () => {
    const { onUseSome } = renderActions({ quantity: 2, unit: 'L' })
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: /Used a quarter of milk/i }))
    expect(onUseSome).toHaveBeenCalledWith(0.5)
  })

  it('takes a custom amount in the item\'s own unit', () => {
    const { onUseSome } = renderActions({ quantity: 2, unit: 'L' })
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: /Other amount/i }))
    fireEvent.change(screen.getByLabelText(/Amount used, in L/i), { target: { value: '0.3' } })
    fireEvent.click(screen.getByRole('button', { name: /^Use$/ }))
    expect(onUseSome).toHaveBeenCalledWith(0.3)
  })

  it('a custom amount of everything is "Used it"', () => {
    const { onUseSome, onResolve } = renderActions({ quantity: 2, unit: 'L' })
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: /Other amount/i }))
    fireEvent.change(screen.getByLabelText(/Amount used/i), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /^Use$/ }))
    expect(onResolve).toHaveBeenCalledWith('used')
    expect(onUseSome).not.toHaveBeenCalled()
  })

  it('will not take zero, a negative or an empty amount', () => {
    const { onUseSome, onResolve } = renderActions()
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: /Other amount/i }))
    const use = screen.getByRole('button', { name: /^Use$/ })
    expect(use).toBeDisabled()
    for (const bad of ['0', '-1', '']) {
      fireEvent.change(screen.getByLabelText(/Amount used/i), { target: { value: bad } })
      expect(use).toBeDisabled()
    }
    expect(onUseSome).not.toHaveBeenCalled()
    expect(onResolve).not.toHaveBeenCalled()
  })

  it('Cancel puts the keys back without changing anything', () => {
    const { onUseSome, onResolve } = renderActions()
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Mark milk as used up' })).toBeInTheDocument()
    expect(onUseSome).not.toHaveBeenCalled()
    expect(onResolve).not.toHaveBeenCalled()
  })

  it('"Used it" is still one tap and still resolves the whole item', () => {
    const { onResolve } = renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Mark milk as used up' }))
    expect(onResolve).toHaveBeenCalledWith('used')
  })
})
