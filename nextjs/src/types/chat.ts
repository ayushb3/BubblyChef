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

export type ChatNextAction =
  | 'none'
  | 'request_clarification'
  | 'review_proposal'
  | 'pick_recipe'

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



export interface AIHealthStatus {
  ai_available: boolean
  providers: Array<{ name: string; available: boolean }>
}
