/**
 * SpringButton as a keycap (issue #741, Goal 3 signature #2). The press itself
 * is CSS (`:active`), which jsdom can't evaluate, so these tests assert the
 * behaviour that is observable here (taps, disabled, loading, ref, legacy
 * callers) plus the class contract that carries the press: it only exists
 * behind `motion-safe:`/`enabled:`, so a disabled key and a reduced-motion user
 * never get the drop. The rendered press is verified in a real browser.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import SpringButton from '@/components/ui/SpringButton'

let mockReduced = false
jest.mock('framer-motion', () => ({
  ...jest.requireActual('framer-motion'),
  useReducedMotion: () => mockReduced,
}))

beforeEach(() => {
  mockReduced = false
})

describe('SpringButton keycap (#741)', () => {
  it('fires once per tap', () => {
    const onClick = jest.fn()
    render(<SpringButton onClick={onClick}>Plan dinner</SpringButton>)
    fireEvent.click(screen.getByRole('button', { name: 'Plan dinner' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire when disabled, and is announced as disabled', () => {
    const onClick = jest.fn()
    render(
      <SpringButton onClick={onClick} disabled>
        Plan dinner
      </SpringButton>,
    )
    const btn = screen.getByRole('button', { name: 'Plan dinner' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('has a 44px minimum height and a pill shape', () => {
    render(<SpringButton>Go</SpringButton>)
    const cls = screen.getByRole('button').className
    expect(cls).toContain('min-h-[44px]')
    expect(cls).toContain('rounded-full')
  })

  it('only sinks when enabled and motion is allowed; reduced motion darkens instead', () => {
    render(<SpringButton>Go</SpringButton>)
    const cls = screen.getByRole('button').className
    // the sink is gated on motion-safe + enabled, never a bare active: translate
    expect(cls).toContain('motion-safe:active:enabled:translate-y-[2px]')
    expect(cls).not.toMatch(/(^|\s)active:translate/)
    expect(cls).toContain('motion-reduce:active:enabled:brightness-90')
    expect(cls).toContain('disabled:shadow-none!')
  })

  it('primary and secondary use the theme primary and surface fills', () => {
    const { rerender } = render(<SpringButton>Go</SpringButton>)
    expect(screen.getByRole('button').className).toContain('bg-[var(--color-primary)]')
    expect(screen.getByRole('button')).toHaveAttribute('data-keycap', 'primary')
    rerender(<SpringButton variant="secondary">Go</SpringButton>)
    expect(screen.getByRole('button').className).toContain('bg-[var(--color-surface)]')
    expect(screen.getByRole('button')).toHaveAttribute('data-keycap', 'secondary')
  })

  it('danger is the rose fill with its dark-red text, not ink and not white', () => {
    render(<SpringButton variant="danger">Delete</SpringButton>)
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn.className).toContain('bg-[var(--color-expired)]')
    expect(btn.className).toContain('text-[color:var(--color-expired-text)]!')
    expect(btn.className).not.toContain('text-[color:var(--color-text)]!')
    expect(btn).toHaveAttribute('data-keycap', 'danger')
  })

  it('an explicit variant fills even when a className is passed (layout only)', () => {
    render(
      <SpringButton variant="danger" className="px-4 py-2 text-sm">
        Delete
      </SpringButton>,
    )
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn.className).toContain('bg-[var(--color-expired)]')
    expect(btn.className).toContain('px-4')
  })

  it("ink={false} keeps the caller's text colour but keeps the keycap look", () => {
    const { rerender } = render(<SpringButton className="text-white">Go</SpringButton>)
    expect(screen.getByRole('button').className).toContain('text-[color:var(--color-text)]!')
    rerender(
      <SpringButton ink={false} className="text-white">
        Go
      </SpringButton>,
    )
    const cls = screen.getByRole('button').className
    expect(cls).not.toContain('text-[color:var(--color-text)]!')
    expect(cls).toContain('text-white')
    expect(cls).toContain('border-[color:var(--color-text)]!')
    expect(cls).toContain('shadow-[0_3px_0_var(--color-text)]!')
  })

  it('full width stretches the key', () => {
    render(<SpringButton fullWidth>Put away 11 items</SpringButton>)
    expect(screen.getByRole('button').className).toContain('w-full')
  })

  it('small keeps a 44px hit area around a 36px key', () => {
    render(<SpringButton size="sm">Fix</SpringButton>)
    const cls = screen.getByRole('button').className
    expect(cls).toContain('min-h-[36px]!')
    expect(cls).toContain('before:-inset-y-1')
  })

  it('a legacy caller keeps its own fill, padding and radius class and still gets the keycap', () => {
    render(
      <SpringButton className="bg-green-100 px-4 py-2 rounded-xl" style={{ background: 'tomato' }}>
        Legacy
      </SpringButton>,
    )
    const btn = screen.getByRole('button', { name: 'Legacy' })
    expect(btn.className).toContain('bg-green-100')
    expect(btn.className).toContain('px-4')
    expect(btn.style.background).toBe('tomato')
    // chrome layered on top, and no variant fill competing with the caller's
    expect(btn.className).toContain('border-[color:var(--color-text)]!')
    expect(btn.className).toContain('rounded-full!')
    expect(btn.className).not.toContain('bg-[var(--color-primary)]')
  })

  it('variant="plain" is not a key: no border, shadow or sink', () => {
    render(
      <SpringButton variant="plain" className="text-xs">
        Skip
      </SpringButton>,
    )
    const btn = screen.getByRole('button', { name: 'Skip' })
    expect(btn).not.toHaveAttribute('data-keycap')
    expect(btn.className).not.toContain('shadow')
    expect(btn.className).not.toContain('translate-y')
  })

  it('forwards the ref, title, aria-label and type', () => {
    const ref = React.createRef<HTMLButtonElement>()
    render(
      <SpringButton ref={ref} type="submit" title="tip" aria-label="Save the dish">
        Save
      </SpringButton>,
    )
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Save the dish' }))
    expect(ref.current).toHaveAttribute('type', 'submit')
    expect(ref.current).toHaveAttribute('title', 'tip')
  })

  describe('loading', () => {
    it('shows the pixel dots, sets aria-busy and keeps the label', () => {
      render(<SpringButton loading>Planning…</SpringButton>)
      const btn = screen.getByRole('button', { name: 'Planning…' })
      expect(btn).toHaveAttribute('aria-busy', 'true')
      expect(screen.getByTestId('keycap-loading-dots')).toBeInTheDocument()
    })

    it('ignores taps, including a submit button submitting its form', () => {
      const onClick = jest.fn()
      const onSubmit = jest.fn((e: React.FormEvent) => e.preventDefault())
      render(
        <form onSubmit={onSubmit}>
          <SpringButton type="submit" loading onClick={onClick}>
            Saving…
          </SpringButton>
        </form>,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Saving…' }))
      expect(onClick).not.toHaveBeenCalled()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('has no aria-busy and no dots when not loading', () => {
      render(<SpringButton>Plan</SpringButton>)
      expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy')
      expect(screen.queryByTestId('keycap-loading-dots')).not.toBeInTheDocument()
    })

    it('holds the dots still under reduced motion', () => {
      mockReduced = true
      render(<SpringButton loading>Planning…</SpringButton>)
      const raised = () =>
        Array.from(screen.getByTestId('keycap-loading-dots').querySelectorAll('rect')).map((r) =>
          r.getAttribute('y'),
        )
      const before = raised()
      expect(before).toEqual(['2', '0', '2']) // the board's still pose: middle dot up
    })
  })
})
