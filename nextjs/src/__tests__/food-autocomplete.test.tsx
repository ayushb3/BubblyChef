/**
 * Issue #398 — ingredient-name autocomplete on the manual "Type" pantry-add
 * row. Covers the combobox itself: matching suggestions appear as the user
 * types, selecting one (by mouse or keyboard) reports the full catalog
 * entry back to the caller, and Escape/ArrowUp/ArrowDown behave like a
 * standard combobox.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import FoodAutocomplete from '@/components/pantry/FoodAutocomplete'
import * as foodsApi from '@/lib/api/foods'
import type { FoodCatalogEntry } from '@/lib/api/foods'

jest.mock('@/lib/api/foods')

const mockSearchFoods = foodsApi.searchFoods as jest.MockedFunction<typeof foodsApi.searchFoods>

const MILK: FoodCatalogEntry = {
  canonical: 'milk',
  category: 'dairy',
  icon_slug: null,
  valid_units: ['gallon', 'quart', 'cup'],
  expiry_days: 10,
  default_location: 'fridge',
  emoji: '🥛',
}

const OAT_MILK: FoodCatalogEntry = {
  canonical: 'oat milk',
  category: 'dairy',
  icon_slug: null,
  valid_units: ['quart', 'container'],
  expiry_days: 14,
  default_location: 'fridge',
  emoji: '🥛',
}

function renderCombobox(onSelect = jest.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper() {
    const [value, setValue] = React.useState('')
    return (
      <FoodAutocomplete value={value} onChange={setValue} onSelect={onSelect} ariaLabel="Item name" />
    )
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Wrapper />
    </QueryClientProvider>,
  )
  return { onSelect }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSearchFoods.mockResolvedValue([MILK, OAT_MILK])
})

describe('FoodAutocomplete (#398)', () => {
  it('shows matching suggestions once the user types enough characters', async () => {
    renderCombobox()
    const input = screen.getByRole('combobox', { name: 'Item name' })

    fireEvent.change(input, { target: { value: 'mi' } })

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    const optionText = screen.getAllByRole('option').map((el) => el.textContent)
    expect(optionText.some((t) => t?.includes('milk'))).toBe(true)
    expect(optionText.some((t) => t?.includes('oat milk'))).toBe(true)
  })

  it('does not query below the 2-character floor', () => {
    renderCombobox()
    const input = screen.getByRole('combobox', { name: 'Item name' })

    fireEvent.change(input, { target: { value: 'm' } })

    expect(mockSearchFoods).not.toHaveBeenCalled()
  })

  it('calls onSelect with the full catalog entry on click', async () => {
    const { onSelect } = renderCombobox()
    const input = screen.getByRole('combobox', { name: 'Item name' })

    fireEvent.change(input, { target: { value: 'mi' } })
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument())

    const milkOption = screen.getAllByRole('option').find((el) => el.textContent === '🥛milkdairy')
    fireEvent.mouseDown(within(milkOption!).getByRole('button'))

    expect(onSelect).toHaveBeenCalledWith(MILK)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('supports keyboard navigation: ArrowDown to highlight, Enter to select', async () => {
    const { onSelect } = renderCombobox()
    const input = screen.getByRole('combobox', { name: 'Item name' })

    fireEvent.change(input, { target: { value: 'mi' } })
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument())

    // First ArrowDown highlights milk, second highlights oat milk.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith(OAT_MILK)
  })

  it('closes the dropdown on Escape without selecting', async () => {
    renderCombobox()
    const input = screen.getByRole('combobox', { name: 'Item name' })

    fireEvent.change(input, { target: { value: 'mi' } })
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument())

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
