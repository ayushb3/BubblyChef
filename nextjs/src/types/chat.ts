/**
 * Chat types for BubblyChef Next.js frontend.
 * Mirrors the backend ProposalEnvelope + SSE event protocol.
 */

import type { Step } from '@/types/recipes'

export type ChatIntent =
  | 'pantry_update'
  | 'recipe_card'
  | 'recipe_generation'
  | 'cooking_help'
  | 'general_chat'
  | 'recipe_brainstorm'
  | 'saved_recipe_lookup'
  /** Meal-shaped asks ("what's for dinner?") — issue #650 / spec #647. */
  | 'meal_plan'

export type ChatNextAction =
  | 'none'
  | 'request_clarification'
  | 'review_proposal'
  | 'pick_recipe'
  | 'confirm_choice'
  /** The option stage of `meal_plan` — three cards await a pick (issue #650). */
  | 'pick_meal'

// ─── Pantry Proposals ─────────────────────────────────────────────────────────

export interface PantryProposalItem {
  name: string
  category?: string
  storage_location?: string
  quantity?: number
  unit?: string
  brand?: string | null
}

export interface PantryProposalAction {
  action_type: 'add' | 'update' | 'remove' | 'use'
  item: PantryProposalItem
  confidence: number
  reasoning?: string | null
}

export interface PantryProposalData {
  actions: PantryProposalAction[]
  source_text?: string | null
}

/**
 * Everything needed to apply a pantry proposal once the user approves it.
 * A card's identity is the ordered list of persisted turn request ids it spans
 * (issue #444): a merged card covers every turn folded into it.
 */
export interface PendingProposal {
  /** The owning (latest) turn's persisted request_id; sent as `request_id`. */
  requestId: string
  actions: PantryProposalAction[]
  /** Every chain turn, oldest first; sent as `turn_request_ids`. */
  turnRequestIds: string[]
}

/** One row that failed on the latest apply attempt, with the values as sent. */
export interface ProposalReviewFailedRow {
  key: string
  name: string
  quantity?: number | null
  unit?: string | null
}

/**
 * The outcome the AI service records on a persisted pantry turn
 * (`metadata.proposal_review`, issue #444). Server side, so it survives a
 * reload and a second device.
 */
export interface ProposalReview {
  status: 'applied' | 'failed' | 'rejected'
  /** Keys (`proposalActionKey`) of THIS turn's rows that applied; never shrinks. */
  applied_keys: string[]
  failed: ProposalReviewFailedRow[]
  error: string | null
  chain_request_ids: string[]
  updated_at: string
}

// ─── Recipe Data ──────────────────────────────────────────────────────────────

export interface IngredientAvailability {
  name: string
  status: 'have' | 'missing' | 'substitute'
  pantry_item_name?: string | null
  substitute_note?: string | null
}

export interface ChatRecipeData {
  title?: string
  description?: string | null
  prep_time_minutes?: number | null
  cook_time_minutes?: number | null
  total_time_minutes?: number | null
  difficulty?: string | null
  servings?: number | null
  ingredients?: Array<{
    name: string
    quantity?: number | null
    unit?: string | null
    /** Prep note, e.g. "diced" (issue #651 PR B; the wire already carries it). */
    preparation?: string | null
    optional?: boolean
  }>
  instructions?: string[]
  /** Structured steps alongside `instructions` (issue #648) — `null`/absent means not yet structured. */
  steps?: Step[] | null
  cuisine?: string | null
  meal_type?: string | null
  dietary_tags?: string[]
  ingredient_availability?: IngredientAvailability[]
}

/**
 * The in-chat recipe fields sent as `context.meal_fixed_main.recipe` (issue
 * #651 PR B). Built by `fixedMainPayload`, never the raw proposal: no
 * `ingredient_availability`, no `id`.
 */
export interface MealFixedMainRecipe {
  title: string
  description?: string | null
  ingredients: Array<{
    name: string
    quantity?: number | null
    unit?: string | null
    preparation?: string | null
    optional?: boolean
  }>
  instructions: string[]
  steps?: Step[] | null
  prep_time_minutes?: number | null
  cook_time_minutes?: number | null
  total_time_minutes?: number | null
  servings?: number | null
  cuisine?: string | null
  meal_type?: string | null
  difficulty?: string | null
  dietary_tags?: string[]
}

/** `context.meal_fixed_main`: a saved recipe by id, or an in-chat recipe as a payload. */
export type MealFixedMainContext = { recipe_id: string } | { recipe: MealFixedMainRecipe }

// ─── Meal proposals (issue #650 / spec #647) ───────────────────────────────────
//
// Field names match `docs/plans/2026-09-29-issue-650-meal-contract.md`
// exactly. The option stage (`meal_options`) shows three lightweight
// outlines; the pick stage (`meal`) is one full RecipeCard per dish.

/** Echoed constraints — kitchen limits, the mapped exclusive tags, and the
 * RecipeConstraints extraction used to regenerate sides. */
export interface MealProposalConstraints {
  kitchen_limits: string[]
  exclusive_tags: string[]
  recipe_constraints: Record<string, unknown>
}

export interface MealOptionDish {
  role: 'main' | 'side'
  name: string
  key_ingredients: string[]
  /** null when the model gave no estimate. */
  est_total_minutes: number | null
  est_hands_on_minutes: number | null
}

export interface MealOptionCoverage {
  pantry_items_used: number
  to_buy: string[]
}

export interface MealOption {
  /** Stable within the conversation — sent back verbatim on pick. */
  option_id: string
  title: string
  blurb: string
  /** Exactly one main first, then 1-2 sides. */
  dishes: MealOptionDish[]
  /** null when no dish carried an estimate; the time chip is hidden then. */
  est_total_minutes: number | null
  est_hands_on_minutes: number | null
  /** null when the user asked not to use the pantry; the coverage chip is hidden then. */
  coverage: MealOptionCoverage | null
  /** Expiring-soon items this option uses; empty when none. */
  rescues: string[]
}

export interface MealOptionsProposal {
  proposal_type: 'meal_options'
  /** Exactly 3, fewer only if generation fails for some. */
  options: MealOption[]
  servings: number
  constraints: MealProposalConstraints
  /**
   * Set on a make-it-a-meal turn (issue #651 PR B): the main every option
   * shares. `recipe_id` is null for an in-chat (or draft-copy) main.
   */
  fixed_main?: { recipe_id: string | null; title: string } | null
}

export interface MealProposalDish {
  role: 'main' | 'side'
  position: number
  /** Set only on a fixed saved main (issue #651 PR B): the id `POST /api/meals` links. */
  recipe_id?: string | null
  /** The existing RecipeCard shape, including `steps`, at the meal's servings. */
  recipe: ChatRecipeData
}

export interface MealProposal {
  proposal_type: 'meal'
  /**
   * Stamped by the ai-service per pick and kept in the conversation history.
   * Sent to `POST /api/meals` as `source_ref` so Open and Save resolve to one
   * meal even across navigation. Optional: older restored turns lack it.
   */
  meal_ref?: string
  title: string
  servings: number
  constraints: MealProposalConstraints
  dishes: MealProposalDish[]
  missing_ingredients: string[]
}

export function isMealOptionsProposal(
  proposal: unknown,
): proposal is MealOptionsProposal {
  return (
    !!proposal &&
    typeof proposal === 'object' &&
    (proposal as { proposal_type?: unknown }).proposal_type === 'meal_options'
  )
}

export function isMealProposal(proposal: unknown): proposal is MealProposal {
  return (
    !!proposal &&
    typeof proposal === 'object' &&
    (proposal as { proposal_type?: unknown }).proposal_type === 'meal'
  )
}

/** One ingredient of a mid-cook amendment (backend RecipeIngredientAmendment). */
export interface RecipeIngredientAmendment {
  name: string
  quantity: number
  unit: string
  optional: boolean
  notes: string | null
}

/**
 * A mid-cook amendment to the pinned recipe's ingredients (backend
 * RecipeAmendmentProposal, models/proposals.py). `amended_ingredients` is the FULL
 * replacement list, at the scale of the list the request pinned.
 */
export interface RecipeAmendmentProposal {
  proposal_type: 'recipe_amendment'
  is_amendment: boolean
  amended_ingredients: RecipeIngredientAmendment[]
  change_summary: string | null
  recipe_id: string | null
  recipe_title: string | null
}

export function isRecipeAmendmentProposal(proposal: unknown): proposal is RecipeAmendmentProposal {
  return (
    !!proposal &&
    typeof proposal === 'object' &&
    (proposal as { proposal_type?: unknown }).proposal_type === 'recipe_amendment' &&
    Array.isArray((proposal as { amended_ingredients?: unknown }).amended_ingredients) &&
    (proposal as { amended_ingredients: unknown[] }).amended_ingredients.length > 0
  )
}

// ─── Chat Response ────────────────────────────────────────────────────────────

export interface ChatResponse {
  request_id: string
  workflow_id: string
  conversation_id: string | null
  intent: ChatIntent
  assistant_message: string
  proposal:
    | PantryProposalData
    | ChatRecipeData
    | MealOptionsProposal
    | MealProposal
    | RecipeAmendmentProposal
    | null
  confidence: { overall: number }
  requires_review: boolean
  next_action: ChatNextAction
  clarifying_questions?: string[]
  warnings?: string[]
  errors?: string[]
  metadata?: Record<string, unknown> | null
}

// ─── Chat Message ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  intent?: ChatIntent
  response?: ChatResponse
  timestamp: Date
  /**
   * Set on an assistant turn that raised the confirm band: the user message
   * that triggered it. A band tap posts its label as the visible message and
   * sends this as `forced_intent_source`, so the tweak / fresh brainstorm acts
   * on the real request rather than on the words "Tweak this recipe".
   */
  confirmSource?: string
}

export interface ChatRequest {
  message: string
  conversation_id: string | null
  mode?: string
  pantry_snapshot?: Record<string, unknown>[]
  /**
   * Extra context forwarded to the AI workflow. Recognised keys:
   * `cooking_recipe_id` (string) — the recipe the user just started cooking;
   * the AI service resolves the full recipe from the DB and pins the
   * conversation to it. Legacy `cooking_recipe` ({ id, title, ingredients })
   * is still accepted, same effect. `meal_option_id` (string) — a pick on a
   * meal-options card; the backend resolves it from the session, never
   * fuzzy-matched from the message text. `meal_followup` (`true` only) —
   * stamped on a tap of a meal-stage pill (issue #651); routes the turn back
   * to `meal_plan` without the classifier and inherits the retained meal's
   * constraints, servings and option titles. `meal_fixed_main` (object) —
   * stamped by a "Make it a meal" tap or the `?meal=` seed (issue #651 PR B):
   * `{ recipe_id }` for a saved recipe or `{ recipe }` for an in-chat one
   * (`MealFixedMainContext`). Routes to `meal_plan` without the classifier;
   * every option keeps that dish as its main. The recipe payload is capped at
   * 32 KB serialised, the id is resolved scoped to the caller, and
   * `meal_option_id` wins if both are present. Built per tap, never stored.
   */
  context?: Record<string, unknown> | null
  /**
   * Deterministic intent override sent when the user taps a confirm-band
   * button. Bypasses the classifier (Priority-1 override on the backend).
   * Matches the backend Literal exactly: 'recipe_card' | 'recipe_brainstorm'.
   */
  forced_intent?: 'recipe_card' | 'recipe_brainstorm' | null
  /** With forced_intent: the user message that raised the confirm band. */
  forced_intent_source?: string | null
  /**
   * False when this caller renders no follow-up chips (issue #498), so the
   * server skips the extra model call that produces them. Defaults to true.
   */
  follow_up_chips?: boolean
}

/**
 * Preferred cook-handoff context: just the recipe id, resolved server-side.
 * Known synchronously from `?cooking=<id>`, so it never has to wait on a fetch
 * (the client fetch/send race that #155 fixed).
 */
export interface CookingRecipeIdContext {
  cooking_recipe_id: string
}

/** Legacy shape of `context.cooking_recipe` — still accepted by the AI service. */
export interface CookingRecipeContext {
  id: string
  title: string
  ingredients: string[]
}

// ─── SSE Stream Events ────────────────────────────────────────────────────────

export interface StreamTokenEvent {
  type: 'token'
  content: string
}

export interface StreamDoneEvent {
  type: 'done'
}

export interface StreamEnvelopeEvent {
  type: 'envelope'
  data: ChatResponse
}

export interface StreamErrorEvent {
  type: 'error'
  message: string
}

export type StreamEvent =
  | StreamTokenEvent
  | StreamDoneEvent
  | StreamEnvelopeEvent
  | StreamErrorEvent

// ─── Conversation History ─────────────────────────────────────────────────────

// Tolerant readers for persisted pantry turns (issue #444). Persisted rows can
// hold anything (older builds, hand edits), and a bad row must degrade to a
// legacy text bubble, never throw and never clear the conversation.

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** `metadata.request_id` of a persisted turn, or null when absent or not a string. */
export function readTurnRequestId(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null
  const id = metadata.request_id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * `metadata.proposal_review` of a persisted turn, or null when absent or
 * malformed in any way (a malformed review is read as absent).
 */
export function readProposalReview(metadata: unknown): ProposalReview | null {
  if (!isRecord(metadata)) return null
  const raw = metadata.proposal_review
  if (!isRecord(raw)) return null
  const { status, applied_keys, failed, error, chain_request_ids, updated_at } = raw
  if (status !== 'applied' && status !== 'failed' && status !== 'rejected') return null
  const isStrings = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === 'string')
  if (!isStrings(applied_keys)) return null
  if (chain_request_ids !== undefined && !isStrings(chain_request_ids)) return null
  if (error !== undefined && error !== null && typeof error !== 'string') return null
  if (!Array.isArray(failed)) return null
  const rows: ProposalReviewFailedRow[] = []
  for (const f of failed) {
    if (!isRecord(f) || typeof f.key !== 'string' || f.key.length === 0) return null
    rows.push({
      key: f.key,
      name: typeof f.name === 'string' ? f.name : f.key,
      quantity: typeof f.quantity === 'number' ? f.quantity : null,
      unit: typeof f.unit === 'string' ? f.unit : null,
    })
  }
  return {
    status,
    applied_keys,
    failed: rows,
    error: typeof error === 'string' ? error : null,
    chain_request_ids: chain_request_ids ?? [],
    updated_at: typeof updated_at === 'string' ? updated_at : '',
  }
}

/**
 * The actions of a persisted pantry proposal, or null unless the whole shape is
 * sound: an object whose `actions` is an array of entries that each have a
 * string `action_type` and an `item` with a non-empty string `name`. An empty
 * list is valid (a vague-only turn) and returns `[]`.
 */
export function readPantryActions(proposal: unknown): PantryProposalAction[] | null {
  if (!isRecord(proposal) || !Array.isArray(proposal.actions)) return null
  for (const a of proposal.actions) {
    if (!isRecord(a) || typeof a.action_type !== 'string') return null
    if (!isRecord(a.item) || typeof a.item.name !== 'string' || a.item.name.length === 0) return null
  }
  return proposal.actions as PantryProposalAction[]
}

export interface ConversationHistoryTurn {
  role: 'user' | 'assistant'
  content: string
  intent: string | null
  proposal?: PantryProposalData | ChatRecipeData | null
  metadata?: Record<string, unknown> | null
  created_at: string
}

export interface ConversationSession {
  conversation_id: string
  active_mode: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ─── Brainstorm helpers ───────────────────────────────────────────────────────

/**
 * Extract brainstorm idea names from a ChatResponse's metadata.
 * Returns an empty array when the field is absent, null, or malformed so
 * callers never need to guard against undefined.
 */
export function getBrainstormIdeas(response?: ChatResponse | null): string[] {
  const raw = response?.metadata?.brainstorm_ideas
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string')
}

/**
 * Extract the backend's context-aware follow-up suggestions from a
 * ChatResponse's metadata (issue #498). Raw model output — callers must pass
 * it through `resolveChips`, which sanitises and falls back to static chips.
 * Returns an empty array when absent, null, or malformed.
 */
/**
 * True while the server has promised follow-up chips for this reply but they
 * haven't arrived yet (issue #498): the envelope is sent first so the input
 * unlocks immediately, and the chips follow as a separate `follow_ups` event.
 */
export function isFollowUpsPending(response?: ChatResponse | null): boolean {
  return response?.metadata?.follow_ups_pending === true
}

export function getFollowUpSuggestions(response?: ChatResponse | null): string[] {
  const raw = response?.metadata?.follow_up_suggestions
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string')
}

// ─── Saved-recipe lookup helpers ───────────────────────────────────────────────

/**
 * One saved-recipe match, as `saved_recipe_lookup_response` puts it on
 * `metadata.saved_recipe_matches` — only the fields named in the Spec B.1
 * contract (`ai-service/bubbly_chef/workflows/chat/nodes.py`) leave the
 * backend; full rows never do.
 */
export interface SavedRecipeMatch {
  id: string
  title: string
  description?: string | null
  cuisine?: string | null
}

/**
 * Extract saved-recipe matches from a ChatResponse's metadata. Returns an
 * empty array when the field is absent, null, or malformed — same contract
 * as `getBrainstormIdeas` — so callers never need to guard against
 * undefined. Robust to 0, 1, or many entries, whatever the backend returns
 * (issue #494); a row missing `id` or `title` is dropped rather than
 * rendered half-broken, since both are load-bearing for the card actions.
 */
export function getSavedRecipeMatches(response?: ChatResponse | null): SavedRecipeMatch[] {
  const raw = response?.metadata?.saved_recipe_matches
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is SavedRecipeMatch => {
    if (!item || typeof item !== 'object') return false
    const m = item as Record<string, unknown>
    return typeof m.id === 'string' && m.id.length > 0 && typeof m.title === 'string' && m.title.length > 0
  })
}

// ─── Confirm-choice helpers ───────────────────────────────────────────────────

export interface ConfirmOption {
  label: string
  forced_intent: 'recipe_card' | 'recipe_brainstorm'
}

/**
 * Extract confirm options from a ChatResponse's metadata.confirm_options.
 * Returns an empty array when the field is absent, null, or malformed.
 * Each entry must have a string `label` and a `forced_intent` in the
 * allowed set; anything else is silently dropped.
 */
export function getConfirmOptions(response?: ChatResponse | null): ConfirmOption[] {
  const raw = response?.metadata?.confirm_options
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (item): item is ConfirmOption =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as ConfirmOption).label === 'string' &&
      ((item as ConfirmOption).forced_intent === 'recipe_card' ||
        (item as ConfirmOption).forced_intent === 'recipe_brainstorm'),
  )
}

// ─── Pantry clarification helpers ──────────────────────────────────────────────

export interface TermSuggestion {
  term: string
  suggestions: string[]
}

/**
 * Extract per-term concrete suggestions for vague pantry words ("veggies" ->
 * onion, broccoli, carrot) from a ChatResponse's metadata. Returns an empty
 * array when the field is absent, null, or malformed.
 */
export function getClarificationSuggestions(response?: ChatResponse | null): TermSuggestion[] {
  const raw = response?.metadata?.clarification_suggestions
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (item): item is TermSuggestion =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as TermSuggestion).term === 'string' &&
      Array.isArray((item as TermSuggestion).suggestions)
  )
}

/**
 * Merge a later turn's clarification terms into an earlier turn's, so a
 * still-open pantry card can accumulate vague terms across turns instead of
 * each turn opening its own card. A term reappearing (case-insensitive)
 * takes the newer suggestion list rather than duplicating the row.
 */
export function mergeTermSuggestions(
  existing: TermSuggestion[],
  incoming: TermSuggestion[]
): TermSuggestion[] {
  const merged = [...existing]
  for (const next of incoming) {
    const i = merged.findIndex((t) => t.term.toLowerCase() === next.term.toLowerCase())
    if (i >= 0) {
      merged[i] = next
    } else {
      merged.push(next)
    }
  }
  return merged
}

/**
 * The one key a pantry-proposal row is tracked by: the item name, trimmed and
 * lower-cased. The card, `useChat`'s pending-set filter and its failed-names
 * record all use this same expression, so a row can't be "failed" under one
 * spelling and "pending" under another (issue #677).
 */
export function proposalActionKey(action: PantryProposalAction): string {
  return action.item.name.trim().toLowerCase()
}

/**
 * Merge new proposal actions onto existing ones, deduping by `proposalActionKey`
 * (trimmed, case-insensitive). Incoming actions for an already-present item replace
 * the existing one (the newer turn has fresher confidence/quantity info).
 */
export function mergeActions(
  existing: PantryProposalAction[],
  incoming: PantryProposalAction[]
): PantryProposalAction[] {
  const merged = [...existing]
  for (const next of incoming) {
    const nextKey = proposalActionKey(next)
    const i = merged.findIndex((a) => proposalActionKey(a) === nextKey)
    if (i >= 0) {
      merged[i] = next
    } else {
      merged.push(next)
    }
  }
  return merged
}



/**
 * Drop any TermSuggestion whose suggestions have all been acted on — i.e.
 * at least one of the term's concrete options now appears in the merged
 * actions list (case-insensitive). A term is considered resolved the moment
 * the user picks any item from it; any remaining unpicked alternatives are
 * noise once the card already lists the chosen items above.
 *
 * Called in useChat's onDone after mergeTermSuggestions so the component
 * receives a clean list and stays dumb — it never needs to re-derive which
 * terms are still open.
 */
export function filterResolvedTerms(
  terms: TermSuggestion[],
  actions: PantryProposalAction[],
): TermSuggestion[] {
  if (actions.length === 0) return terms
  const actionNames = new Set(actions.map(proposalActionKey))
  return terms.filter(
    ({ suggestions }) => !suggestions.some((s) => actionNames.has(s.trim().toLowerCase())),
  )
}


/**
 * Build natural-language text from a clarification selection map.
 * {veggies: ["Broccoli","Spinach"], dairy: ["Yogurt"]}
 * → "I got broccoli and spinach for veggies, and yogurt for dairy"
 * Empty selections → empty string.
 */
export function buildClarificationText(selections: Record<string, string[]>): string {
  const entries = Object.entries(selections).filter(([, items]) => items.length > 0)
  if (entries.length === 0) return ''
  const parts = entries.map(([term, items]) => {
    const itemList = items.map((i) => i.toLowerCase()).join(' and ')
    return `${itemList} for ${term}`
  })
  return `I got ${parts.join(', and ')}`
}

export interface AIHealthStatus {
  ai_available: boolean
  providers: Array<{ name: string; available: boolean }>
}

// ─── Starter pills (issue #651) ────────────────────────────────────────────────

/** One row from the `GET /api/chat/starter-context` expiring-items query. */
export interface StarterExpiringItem {
  name: string
  /** `YYYY-MM-DD` */
  expiry_date: string
}

/** One row from the `GET /api/chat/starter-context` recent-cooks query. */
export interface StarterRecentCook {
  recipe_id: string
  title: string
  last_cooked_at: string
  cuisine: string | null
}

/**
 * The context the starter-pill ranker (`lib/starter-pills.ts`) chooses from
 * on the empty chat screen. Built server-side by
 * `GET /api/chat/starter-context` and normalised client-side by
 * `fetchStarterContext` (`lib/api/starter-context.ts`) so the ranker never
 * has to guard against a malformed field itself.
 */
export interface StarterContext {
  /** `expiry_date` in [server today −1, +7], soonest first then name; ≤10. */
  expiring: StarterExpiringItem[]
  /** In-stock pantry rows (`quantity > 0`); decides the scan pill. `null` when the count query failed. */
  pantry_count: number | null
  /** ≤3 non-draft recipes with `last_cooked_at`, most recent first. */
  recent_cooks: StarterRecentCook[]
  /** 0–2, lower-cased — the §6 recent-cuisine rule shared with the backend. */
  recent_cuisines: string[]
  /** The §6 rule; 2 on failure. */
  default_servings: number
}
