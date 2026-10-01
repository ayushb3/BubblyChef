/**
 * Issue #497: an "Add to list" key on the storage row's icon strip (issue #813's
 * one row of icon-only keys). It is only there when the row can act on it, and
 * the three existing keys keep their order and behaviour.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import ResolveActions from '@/components/pantry/ResolveActions'

function renderActions(props: Partial<React.ComponentProps<typeof ResolveActions>> = {}) {
  const onResolve = jest.fn()
  const onAddToList = jest.fn()
  const view = render(
    <ResolveActions
      itemName="spinach"
      onResolve={onResolve}
      onAddToList={onAddToList}
      variant="pills"
      cookHref="/chat?use=spinach"
      {...props}
    />,
  )
  return { onResolve, onAddToList, ...view }
}

describe('ResolveActions: Add to list key', () => {
  it('is an icon-only key named for assistive tech, with a hover title', () => {
    renderActions()
    const key = screen.getByRole('button', { name: 'Add spinach to grocery list' })
    expect(key).toHaveAttribute('title', 'Add to list')
    expect(key).toHaveTextContent('🛒')
    expect(screen.queryByText(/add to list/i)).not.toBeInTheDocument()
  })

  it('fires onAddToList once, and resolves nothing', () => {
    const { onAddToList, onResolve } = renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Add spinach to grocery list' }))
    expect(onAddToList).toHaveBeenCalledTimes(1)
    expect(onResolve).not.toHaveBeenCalled()
  })

  it('sits in the same row, after cook and before used it and tossed', () => {
    renderActions()
    const cook = screen.getByRole('link', { name: /Cook something with/ })
    const add = screen.getByRole('button', { name: /grocery list/ })
    const used = screen.getByRole('button', { name: /as used up/ })
    const tossed = screen.getByRole('button', { name: /as tossed/ })
    const row = cook.parentElement as HTMLElement
    expect(Array.from(row.children)).toEqual([cook, add, used, tossed])
  })

  it('is a 44px target and is off while a resolve is in flight', () => {
    const { rerender } = renderActions()
    expect(screen.getByRole('button', { name: /grocery list/ }).className).toMatch(/min-h-\[44px\]/)
    expect(screen.getByRole('button', { name: /grocery list/ }).className).toMatch(/min-w-\[44px\]/)
    rerender(
      <ResolveActions itemName="spinach" onResolve={jest.fn()} onAddToList={jest.fn()} pending />,
    )
    expect(screen.getByRole('button', { name: /grocery list/ })).toBeDisabled()
  })

  it('is absent when the row has no list to add to', () => {
    renderActions({ onAddToList: undefined })
    expect(screen.queryByRole('button', { name: /grocery list/ })).not.toBeInTheDocument()
  })

  it('stays out of the way of the Tossed confirm', () => {
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: /as tossed/ }))
    expect(screen.queryByRole('button', { name: /grocery list/ })).not.toBeInTheDocument()
  })
})
