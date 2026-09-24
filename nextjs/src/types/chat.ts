/**
 * Chat types for BubblyChef Next.js frontend.
 * Mirrors the backend ProposalEnvelope + SSE event protocol.
 */

export type ChatIntent =
  | 'pantry_update'
  | 'recipe_card'
  | 'recipe_generation'
  | 'cooking_help'
  | 'general_chat'
  | 'recipe_brainstorm'
  | 'saved_recipe_lookup'

export type ChatNextAction =
  | 'none'
  | 'request_clarification'
  | 'review_proposal'
  | 'pick_recipe'
  | 'confirm_choice'

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
  }>
  instructions?: string[]
  cuisine?: string | null
  meal_type?: string | null
  dietary_tags?: string[]
  ingredient_availability?: IngredientAvailability[]
}

// ─── Chat Response ────────────────────────────────────────────────────────────

export interface ChatResponse {
  request_id: string
  workflow_id: string
  conversation_id: string | null
  intent: ChatIntent
  assistant_message: string
  proposal: PantryProposalData | ChatRecipeData | null
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
   * is still accepted, same effect.
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
 * Merge new proposal actions onto existing ones, deduping by item name
 * (case-insensitive). Incoming actions for an already-present item replace
 * the existing one (the newer turn has fresher confidence/quantity info).
 */
export function mergeActions(
  existing: PantryProposalAction[],
  incoming: PantryProposalAction[]
): PantryProposalAction[] {
  const merged = [...existing]
  for (const next of incoming) {
    const i = merged.findIndex(
      (a) => a.item.name.toLowerCase() === next.item.name.toLowerCase()
    )
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
  const actionNames = new Set(actions.map((a) => a.item.name.toLowerCase()))
  return terms.filter(
    ({ suggestions }) => !suggestions.some((s) => actionNames.has(s.toLowerCase())),
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
