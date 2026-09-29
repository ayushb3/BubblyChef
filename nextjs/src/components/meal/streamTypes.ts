/**
 * Issue #653 — local mirror of the stream types from the contract
 * (`docs/plans/2026-09-29-issue-653-meal-cook-along-contract.md`, section 3,
 * `lib/meal-cook-stream.ts`). Frontend is authoring that module in parallel
 * with this components slice, so these are defined here rather than
 * imported, to avoid a race on a file that doesn't exist yet. Field names
 * match the contract exactly. Once `lib/meal-cook-stream.ts` lands, callers
 * should switch to a type-only import from there and this file should be
 * deleted — nothing here has any runtime behaviour to migrate.
 */

import type { Column } from '@/lib/meal-scheduler'

export interface StreamStep {
  key: string
  dish_id: string
  column: Column
  dish_title: string
  step_index: number
  label: string
  text: string
  duration_minutes: number
  hands_on: boolean
  /** Live-plan offset, minutes from `started_at_ms`. */
  start: number
  end: number
}

export type NowCard =
  | { kind: 'active'; step: StreamStep }
  | {
      kind: 'upcoming'
      step: StreamStep
      starts_in_minutes: number
      waiting_on?: StreamStep
    }
  | { kind: 'finished' }
