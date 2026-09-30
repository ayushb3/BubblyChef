-- Issue #654: server-side idempotency for POST /v1/meals/cook/confirm. The client's
-- MealCookSession.cook_id is sent as cook_ref. The confirm claims it with a
-- conditional UPDATE (status 'claimed') before any deduction, and stamps 'applied'
-- after the deductions and the recipe marks. A replayed ref never deducts twice:
-- 'applied' replays as already_confirmed; 'claimed' under 30 s old (probably still
-- writing) is refused as confirm_in_progress, and older (a confirm that failed
-- partway) as confirm_incomplete.
--
-- Additive only: two nullable columns, no backfill, no index (read by primary
-- key), no RLS change -- the existing own-rows policy on `meals` covers them.
-- Not applied by the agent that wrote it -- the orchestrator applies this via
-- `supabase db push --linked`.

ALTER TABLE meals ADD COLUMN IF NOT EXISTS last_cook_ref TEXT;
ALTER TABLE meals ADD COLUMN IF NOT EXISTS last_cook_status TEXT
  CHECK (last_cook_status IS NULL OR last_cook_status IN ('claimed', 'applied'));

COMMENT ON COLUMN meals.last_cook_ref IS
  'cook_ref of the most recent meal cook confirm (issue #654). Written only by the AI service confirm route.';
COMMENT ON COLUMN meals.last_cook_status IS
  'claimed = the confirm claimed last_cook_ref and may be mid-write; applied = its deductions and recipe marks finished (issue #654).';
