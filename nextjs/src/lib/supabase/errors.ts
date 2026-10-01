/**
 * PostgREST reports "zero rows" as error PGRST116 when a query ends in
 * `.single()` (it asked for exactly one row and got none). For the write routes
 * that read a row back with `.update().select().single()`, that means the row
 * is missing or isn't the caller's: a 404, not a server failure (#682).
 */
export const PGRST_NO_ROWS = 'PGRST116'

export function isNoRowError(error: { code?: string } | null | undefined): boolean {
  return error?.code === PGRST_NO_ROWS
}
