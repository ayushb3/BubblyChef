/**
 * Issue #801: the `saved` variant of the one recipe card, the row the Recipes
 * tab draws for each saved recipe. It opens, favourites, edits and deletes; the
 * saved-meal row (`compact`) is a different variant and stays as is.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import RecipeCard, { type SavedCardProps } from '@/components/recipes/RecipeCard'

function Saved(props: Partial<SavedCardProps> = {}) {
  return <RecipeCard variant="saved" title="Creamy Tomato Pasta" {...props} />
}

describe('RecipeCard variant="saved"', () => {
  it('shows the title and one meta line: minutes, servings, cuisine, difficulty', () => {
    render(<Saved minutes={35} servings={4} cuisine="Italian" difficulty="Easy" />)
    const card = screen.getByTestId('recipe-card-saved')
    expect(within(card).getByText('Creamy Tomato Pasta')).toBeInTheDocument()
    expect(card).toHaveTextContent('35 min')
    expect(card).toHaveTextContent('Serves 4')
    expect(card).toHaveTextContent('Italian')
    expect(card).toHaveTextContent('Easy')
  })

  it('shows no meta line, and no "0", when nothing is known', () => {
    render(<Saved />)
    const card = screen.getByTestId('recipe-card-saved')
    expect(card).not.toHaveTextContent('min')
    expect(card).not.toHaveTextContent('Serves')
    expect(card).not.toHaveTextContent('0')
  })

  it('caps the tags at three and counts the rest', () => {
    render(<Saved tags={['quick', 'easy', 'vegan', 'dinner', 'spicy']} />)
    const card = screen.getByTestId('recipe-card-saved')
    expect(card).toHaveTextContent('quick')
    expect(card).toHaveTextContent('vegan')
    expect(card).not.toHaveTextContent('dinner')
    expect(card).toHaveTextContent('+2')
  })

  it('opens from the whole text area, named by the recipe', () => {
    const onOpen = jest.fn()
    render(<Saved onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open recipe: Creamy Tomato Pasta' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('has no open control when it is only a header (no onOpen)', () => {
    render(<Saved />)
    expect(screen.queryByRole('button', { name: /^Open recipe/ })).not.toBeInTheDocument()
  })

  it('favourites: the heart says what it will do and reports the toggle', () => {
    const onToggleFavorite = jest.fn()
    const { rerender } = render(<Saved favorite={false} onToggleFavorite={onToggleFavorite} />)
    const heart = screen.getByRole('button', { name: 'Favorite: Creamy Tomato Pasta' })
    expect(heart).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(heart)
    expect(onToggleFavorite).toHaveBeenCalledTimes(1)

    rerender(<Saved favorite onToggleFavorite={onToggleFavorite} />)
    expect(screen.getByRole('button', { name: 'Unfavorite: Creamy Tomato Pasta' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('the overflow menu offers Edit and Delete, closes after a pick and on Escape', async () => {
    const onEdit = jest.fn()
    const onDelete = jest.fn()
    render(<Saved onEdit={onEdit} onDelete={onDelete} />)
    const more = screen.getByRole('button', { name: 'More options for Creamy Tomato Pasta' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument()

    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    // The menu leaves with a short exit animation.
    await waitFor(() => expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument())

    fireEvent.click(more)
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
    expect(onDelete).toHaveBeenCalledTimes(1)

    fireEvent.click(more)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument())
    expect(more).toHaveFocus()
  })

  it('busy disables the heart and the menu but not the open control', () => {
    render(<Saved busy onOpen={jest.fn()} onToggleFavorite={jest.fn()} onEdit={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'Favorite: Creamy Tomato Pasta' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'More options for Creamy Tomato Pasta' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open recipe: Creamy Tomato Pasta' })).toBeEnabled()
  })

  it('draws the photo on the tile, and falls back to the emoji when it fails to load', () => {
    const { container } = render(<Saved thumbnailUrl="https://example.com/pasta.jpg" />)
    const img = container.querySelector('img') as HTMLImageElement
    expect(img).toHaveAttribute('src', 'https://example.com/pasta.jpg')
    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('recipe-card-saved')).toHaveTextContent('🍳')
  })

  it('keeps a very long title inside a list row (clamped, not overflowing)', () => {
    const long = 'Slow-roasted '.repeat(20).trim()
    render(<Saved title={long} onOpen={jest.fn()} />)
    expect(screen.getByText(long)).toHaveClass('line-clamp-2')
  })

  it('shows the whole title when the card is the opened recipe header (no onOpen)', () => {
    const long = 'Slow-roasted '.repeat(20).trim()
    render(<Saved title={long} />)
    expect(screen.getByText(long)).not.toHaveClass('line-clamp-2')
  })
})
