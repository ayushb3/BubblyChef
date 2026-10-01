/**
 * Issue #497: "Add to list" on the storage list's rows. A row that shows the
 * icon strip (food that needs using) gets a cart key; the sheet reports the add
 * with a line that links to the grocery page, or says it failed. Rows without
 * the strip stay as they were (their add is in the edit sheet).
 */
import React, { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import StorageSheet, { type StorageView } from '@/components/kitchen/StorageSheet'
import type { PlaceKey, StoredItem } from '@/lib/kitchen/places'
import { getDefaultKitchenTheme } from '@/lib/kitchen/themes'

const TODAY = '2026-10-01'
const palette = getDefaultKitchenTheme().wall

const ITEMS: StoredItem[] = [
  {
    id: 'r',
    name: 'romaine',
    location: 'fridge',
    category: 'produce',
    quantity: 1,
    unit: 'head',
    expiry_date: '2026-10-01',
  },
  {
    id: 'm',
    name: 'milk',
    location: 'fridge',
    category: 'dairy',
    quantity: 1,
    unit: 'L',
    expiry_date: null,
  },
]

function Harness({ onAddToList }: { onAddToList?: (item: StoredItem) => Promise<void> | void }) {
  const [place, setPlace] = useState<PlaceKey>('fridge')
  const [view, setView] = useState<StorageView>('list')
  return (
    <StorageSheet
      open
      place={place}
      view={view}
      items={ITEMS}
      status="ready"
      palette={palette}
      today={TODAY}
      onPlaceChange={setPlace}
      onViewChange={setView}
      onClose={jest.fn()}
      onEdit={jest.fn()}
      onAdd={jest.fn()}
      onMove={jest.fn()}
      onResolve={jest.fn()}
      onAddToList={onAddToList}
      onRetry={jest.fn()}
    />
  )
}

const rowOf = (label: RegExp | string) => screen.getByRole('button', { name: label }).closest('li')!

describe('Storage list: Add to list', () => {
  it('shows the cart key on a row with the icon strip', () => {
    render(<Harness onAddToList={jest.fn()} />)
    expect(
      within(rowOf(/^Romaine/)).getByRole('button', { name: 'Add romaine to grocery list' }),
    ).toBeInTheDocument()
  })

  it('adds that item, then says so with a link to the list', async () => {
    const onAddToList = jest.fn().mockResolvedValue(undefined)
    render(<Harness onAddToList={onAddToList} />)
    fireEvent.click(
      within(rowOf(/^Romaine/)).getByRole('button', { name: 'Add romaine to grocery list' }),
    )

    expect(onAddToList).toHaveBeenCalledWith(expect.objectContaining({ id: 'r', name: 'romaine' }))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Romaine added to your grocery list.')
    expect(within(status).getByRole('link', { name: /view list/i })).toHaveAttribute('href', '/grocery')
  })

  it('says it could not add when the add fails', async () => {
    render(<Harness onAddToList={jest.fn().mockRejectedValue(new Error('nope'))} />)
    fireEvent.click(
      within(rowOf(/^Romaine/)).getByRole('button', { name: 'Add romaine to grocery list' }),
    )
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t add romaine to your grocery list/i),
    )
  })

  it('has no cart key when the sheet is not given a list to add to', () => {
    render(<Harness />)
    expect(screen.queryByRole('button', { name: /grocery list/i })).not.toBeInTheDocument()
  })
})
