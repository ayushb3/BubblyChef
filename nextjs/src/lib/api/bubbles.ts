/**
 * Bubbles balance client — stub (issue #521).
 *
 * Issue #520 (Bubbles ledger, open — only the DB migration has merged so
 * far) will put the real client here: a `GET /api/bubbles` route returning
 * `{ balance, recent }`, and a `useBubbles()` React Query hook with query
 * key `['bubbles']`. This file exists now so that landing #520's frontend
 * half replaces this stub in place rather than adding a second hook
 * elsewhere.
 *
 * stub, replaced by issue #520's GET /api/bubbles + useQuery(['bubbles'])
 */

export interface UseBubblesResult {
  balance: number
  isLoading: boolean
}

export function useBubbles(): UseBubblesResult {
  return { balance: 0, isLoading: false }
}
