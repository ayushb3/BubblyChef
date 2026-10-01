'use client'

import { useState, useEffect, useRef, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import BubblesHeader from '@/components/layout/BubblesHeader'
import BubblesMascot from '@/components/ui/BubblesMascot'
import RotatingPlaceholder from '@/components/chat/RotatingPlaceholder'
import MessageBubble from '@/components/chat/MessageBubble'
import PostMessageChips from '@/components/chat/PostMessageChips'
import CookingContextCard from '@/components/chat/CookingContextCard'
import ChatContextCard from '@/components/chat/ChatContextCard'
import TypingIndicator from '@/components/chat/TypingIndicator'
import ChatRecipeCard from '@/components/chat/ChatRecipeCard'
import PantryProposalCard from '@/components/chat/PantryProposalCard'
import ClarificationCard from '@/components/chat/ClarificationCard'
import BrainstormOptions from '@/components/chat/BrainstormOptions'
import SavedRecipeMatches from '@/components/chat/SavedRecipeMatches'
import ConfirmBand from '@/components/chat/ConfirmBand'
import MealOptionCards from '@/components/chat/MealOptionCards'
import CompactMealCard from '@/components/chat/CompactMealCard'
import CookModal from '@/components/recipes/CookModal'
import CookingAmendmentCard from '@/components/chat/CookingAmendmentCard'
import ProfileHeaderButton from '@/components/layout/ProfileHeaderButton'
import Chip, { type ChipTone } from '@/components/ui/Chip'
import EmptyState from '@/components/ui/EmptyState'
import { useChat } from '@/hooks/useChat'
import { checkAIHealth } from '@/lib/api/chat'
import { fetchRecipe, promoteRecipeDraft } from '@/lib/api/recipes'
import { createMeal, updateMeal } from '@/lib/api/meals'
import { buildCreateMealPayload, fixedMainForCard } from '@/lib/meal-chat-helpers'
import { cookingContextForId, cookingPinContext, deriveChatSeed, makeMealMessage } from '@/lib/chat-seed'
import {
  startCookSession,
  isCookSessionEnded,
  saveAmendedCook,
  getAmendedCook,
  clearAmendedCook,
} from '@/lib/cook-session'
import { amendedLinesFromProposal } from '@/lib/cook-amendment'
import { useStarterContext } from '@/lib/api/starter-context'
import { rankStarterPills } from '@/lib/starter-pills'
import type { Recipe } from '@/components/recipes/RecipePage'
import type {
  AmendmentCardState,
  ChatMessage,
  ChatRecipeData,
  PantryProposalData,
  RecipeAmendmentProposal,
  PantryProposalAction,
  MealOption,
  MealProposal,
} from '@/types/chat'
import {
  getBrainstormIdeas,
  getSavedRecipeMatches,
  getSavedMealMatches,
  savedMealToProposal,
  getClarificationSuggestions,
  getFollowUpSuggestions,
  getAiErrorKind,
  isFollowUpsPending,
  buildClarificationText,
  getConfirmOptions,
  isMealOptionsProposal,
  isMealProposal,
  isRecipeAmendmentProposal,
} from '@/types/chat'
import type { SavedRecipeMatch } from '@/types/chat'
import {
  resolveChips,
  resolveAiErrorChips,
  COOKING_CHIPS,
  type ChipConfig,
  type ChipAction,
} from '@/lib/chat-chips'

// ---------------------------------------------------------------------------
// Intent-aware chip resolver — logic lives in lib/chat-chips.ts (testable
// without the component tree). The empty-state welcome row used to be a
// fixed `SUGGESTIONS` list (issue #174); issue #651 replaced it with the
// context-driven starter-pill ranker (`lib/starter-pills.ts`) below. The
// pinned-cooking row is unrelated and stays as it was.
// ---------------------------------------------------------------------------

const COOKING_SUGGESTIONS = COOKING_CHIPS.map((c) => c.suggestion ?? c.message)

const COOKING_SUGGESTION_TONES: ChipTone[] = COOKING_CHIPS.map((c) => c.tone ?? 'primary')

/**
 * The chat surface is exactly one dynamic viewport tall, so the page never
 * scrolls and the message list is the only scroll container (issue #731).
 * The root layout's `<main>` reserves 5rem (`pb-20`) for the fixed BottomNav, so
 * subtracting it here makes header + banner + list + composer + nav add up to
 * `100dvh`. `dvh`, not `vh`: on iOS Safari `vh` is the toolbar-collapsed height
 * and would reintroduce a page scroll (issue #4).
 */
const CHAT_VIEWPORT_CLASS = 'h-[calc(100dvh-5rem)]'

/**
 * `useSearchParams` opts the tree into client-side rendering, so the page shell
 * is a Suspense boundary around the real chat surface (Next.js 16 requirement).
 */
export default function ChatPage() {
  return (
    <Suspense fallback={<div className={CHAT_VIEWPORT_CLASS} />}>
      <ChatSurface />
    </Suspense>
  )
}

function ChatSurface() {
  // Root layout's <body> is `min-h-screen` (100vh), which on iOS Safari is taller
  // than 100dvh while the toolbar is showing — enough to give the document a few
  // pixels of scroll under the chat. Lock document scroll while /chat is mounted;
  // the message list below is the only thing meant to scroll (issue #731).
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('overflow-hidden')
    return () => root.classList.remove('overflow-hidden')
  }, [])

  const router = useRouter()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  // Set by the Cook flow: /chat?cooking=<recipeId>. Changing recipes changes
  // the param, so the context resets for free when the user cooks again.
  const cookingRecipeId = searchParams.get('cooking')

  // Deep-link seeds: /chat?tip=… (#143) and /chat?use=…&expires=… (#138).
  // Null for a bare /chat, which is what keeps the bottom-nav entry a clean,
  // empty conversation. The cook handoff wins if both are somehow present.
  const seed = useMemo(
    () => (cookingRecipeId ? null : deriveChatSeed(searchParams)),
    [cookingRecipeId, searchParams],
  )

  // #265 — a deep link that seeds a purpose-built first message (or the cook
  // handoff) should start a fresh conversation rather than silently resuming
  // whatever was last open; the seed/handoff *is* the intent for this visit.
  // A bare `/chat` (bottom nav, back button, refresh) resumes the persisted
  // conversation instead.
  const {
    messages,
    isStreaming,
    isResuming,
    proposalStates,
    proposalErrors,
    proposalFailedNames,
    amendmentStates,
    amendmentErrors,
    sendMessage,
    sendChipMessage,
    sendConfirmChoice,
    cancelStream,
    startNewChat,
    approveProposal,
    rejectProposal,
    updateProposalActions,
    applyAmendment,
    dismissAmendment,
  } = useChat({ skipResume: Boolean(seed) || Boolean(cookingRecipeId) })

  const [input, setInput] = useState('')
  const [aiAvailable, setAiAvailable] = useState(true)
  const [saveStates, setSaveStates] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({})
  /** Maps message id → saved recipe db id, populated after a successful save. */
  const [savedRecipeIds, setSavedRecipeIds] = useState<Record<string, string>>({})
  /** msgId → recipe db id for rows created as drafts (is_draft: true). */
  const [draftRecipeIds, setDraftRecipeIds] = useState<Set<string>>(new Set())
  /** In-flight POST promises keyed by msgId — prevents double-tap from creating two rows. */
  const ensureInFlight = useRef<Map<string, Promise<{ id: string; isDraft: boolean }>>>(new Map())
  /**
   * msgIds whose recipe the user has started cooking. Once a card is in here it
   * stays inert for the life of the conversation (#269) — re-entering cook mode
   * or re-running the deduction on the same card is never what the user wants.
   */
  const [cookStartedIds, setCookStartedIds] = useState<Set<string>>(new Set())
  /** msgIds whose cook button is pending (draft POST in flight). Re-renders on change. */
  const [cookPending, setCookPending] = useState<Set<string>>(new Set())
  /**
   * When set, the CookModal is open for this recipe. `mode` decides which
   * question it asks: 'preview' (what will this cost me, deducts nothing) or
   * 'confirm' (I cooked it, deduct now). `msgId` is carried so a preview that
   * proceeds to cooking can mark the originating card as started.
   */
  const [cookTarget, setCookTarget] = useState<{
    recipeId: string
    recipeTitle: string
    isDraft: boolean
    mode: 'preview' | 'confirm'
    msgId?: string
  } | null>(null)
  /**
   * Meal chat state (issue #650). msgId → the created meal's { id, isDraft },
   * set the first time Open meal / Save meal succeeds for that card.
   */
  const [mealIds, setMealIds] = useState<Record<string, { id: string; isDraft: boolean }>>({})
  const [mealOpenStates, setMealOpenStates] = useState<Record<string, 'idle' | 'pending' | 'opened'>>({})
  const [mealSaveStates, setMealSaveStates] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({})
  /**
   * msgId → a counter bumped by a tap on the meal-ready "Save this meal" pill
   * (issue #651, §4). `CompactMealCard.focusSaveToken` scrolls to, focuses and
   * highlights its own Save meal button on each change — the pill itself
   * writes nothing; the card's button is still the one confirm.
   */
  const [mealSaveFocus, setMealSaveFocus] = useState<Record<string, number>>({})
  /** In-flight POST promises keyed by msgId — the double-creation guard Open and Save share. */
  const mealCreateInFlight = useRef<Map<string, Promise<{ id: string; isDraft: boolean }>>>(new Map())
  const [loadedRecipe, setLoadedRecipe] = useState<Recipe | null>(null)
  const [dismissedRecipeId, setDismissedRecipeId] = useState<string | null>(null)
  const [dismissedSeedKey, setDismissedSeedKey] = useState<string | null>(null)
  /**
   * One clock read per empty state (issue #651, §4/§12) — the starter-pill
   * ranker (`rankStarterPills`) is pure and never reads the clock itself.
   * Reset on "New Chat" so a session spanning a time-of-day boundary gets a
   * fresh pill set rather than one frozen at first mount.
   */
  const [mountedAt, setMountedAt] = useState(() => new Date())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // The recipe only needs to ride along on the first message — the backend
  // pins it to the conversation session for subsequent turns.
  const contextSentRef = useRef(false)
  // Same one-shot idiom for the seeded auto-send: fires once per mount, never
  // again on re-render, and never after the user has taken over the thread.
  const seedSentRef = useRef(false)

  // Check AI health on mount
  useEffect(() => {
    checkAIHealth()
      .then((h) => setAiAvailable(h.ai_available))
      .catch(() => setAiAvailable(false))
  }, [])

  // Two-tab double deduction guard (PR #475), part 1: `cookingRecipe` below
  // reads `isCookSessionEnded` at render, which goes stale the instant a
  // *different* tab confirms this same recipe's deduction — `storage` events
  // only fire in tabs other than the one that wrote the change, which is
  // exactly the case this needs to catch live. `cookTick` has no meaning of
  // its own; bumping it just forces this tab to recompute `cookingRecipe`
  // (and therefore hide the stale COOKING banner) the moment that happens,
  // rather than waiting for some unrelated re-render to notice.
  const [, setCookTick] = useState(0)
  useEffect(() => {
    const handleStorage = () => setCookTick((n) => n + 1)
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  // Load the recipe named by ?cooking=
  useEffect(() => {
    if (!cookingRecipeId) return
    let cancelled = false
    contextSentRef.current = false
    fetchRecipe(cookingRecipeId)
      .then((recipe) => {
        if (!cancelled) setLoadedRecipe(recipe)
      })
      .catch(() => {
        // Recipe unavailable — chat still works, just without the context card
        if (!cancelled) setLoadedRecipe(null)
      })
    return () => {
      cancelled = true
    }
  }, [cookingRecipeId])

  // Derived, not stored: the card shows only while the loaded recipe still
  // matches the URL param and hasn't been dismissed. Keeps a stale recipe from
  // flashing between navigations without clearing state inside an effect.
  //
  // #440 — also gated on the persisted cook-session record, not just local
  // `dismissedRecipeId` state. A confirmed deduction from a route other than
  // /chat (e.g. the recipe library's guided cook flow) redirects here with a
  // *fresh* mount of this page, so `dismissedRecipeId` was never set for this
  // recipe — only `isCookSessionEnded` (backed by localStorage) survives that
  // navigation and can still recognise the session is already over.
  const cookingRecipe =
    cookingRecipeId &&
    cookingRecipeId !== dismissedRecipeId &&
    !isCookSessionEnded(cookingRecipeId) &&
    loadedRecipe?.id === cookingRecipeId
      ? loadedRecipe
      : null

  // The amendment on record for the recipe being cooked (#489/#490), read at
  // render like `isCookSessionEnded` (and refreshed by `cookTick`): the banner
  // counts it, and it survives a reload because it lives in the cook-session store.
  const amendedCook = cookingRecipe && cookingRecipeId ? getAmendedCook(cookingRecipeId) : null

  // Strip a `?cooking=` param that names an already-ended session — e.g. the
  // redirect CookModal performs right after a confirmed deduction, or the
  // back button returning to a stale URL. Without this the param lingers
  // indefinitely even though the banner itself is correctly hidden above.
  useEffect(() => {
    if (cookingRecipeId && isCookSessionEnded(cookingRecipeId)) {
      router.replace('/chat', { scroll: false })
    }
  }, [cookingRecipeId, router])

  /**
   * Attach the cook context to the first message of the conversation only.
   *
   * The payload is derived from `cookingRecipeId` — the `?cooking=<id>` param,
   * known synchronously on mount — NOT from `loadedRecipe`. The AI service
   * resolves the full recipe from this id server-side, so the pin no longer
   * races the client's `fetchRecipe` (#155): a message sent before the card
   * fills in still pins the session. `loadedRecipe` drives only the cosmetic
   * card below.
   */
  const takeCookingContext = (): Record<string, unknown> | undefined => {
    if (contextSentRef.current || isStreaming) return undefined
    const context = cookingContextForId(cookingRecipeId)
    if (!context || !cookingRecipeId) return undefined
    contextSentRef.current = true
    // #489/#490: pin what is actually being cooked. A confirmed amendment on
    // record wins, so a reload's fresh conversation starts from the AMENDED
    // list (the stored row the id resolves to would silently undo it), and so
    // a further amendment is detected against it. Otherwise, once the recipe has
    // loaded, the full pin lets the very first turn already carry an amendment.
    // Before either is known, the id-only pin still works (#155).
    const amended = getAmendedCook(cookingRecipeId)
    if (amended) {
      return {
        ...cookingPinContext(
          cookingRecipeId,
          amended.recipeTitle || loadedRecipe?.title || '',
          amended.ingredients,
        ),
      }
    }
    if (loadedRecipe?.id === cookingRecipeId) {
      return {
        ...cookingPinContext(
          cookingRecipeId,
          loadedRecipe.title,
          loadedRecipe.ingredients.map((ing) =>
            typeof ing === 'string'
              ? ing
              : { name: ing.name, quantity: ing.quantity ?? null, unit: ing.unit ?? null },
          ),
        ),
      }
    }
    return { ...context }
  }

  // Auto-send the seeded question so a tap on the dashboard tip / an expiring
  // item lands straight on Bubbles' answer — the tap on the card is the "1 tap"
  // both #138 acceptance criteria budget for. The seed rides in the message
  // *text*, not a context payload: the AI service only honours `cooking_recipe`
  // as client context, and the must-use ingredient is recovered by an LLM pass
  // over the message itself.
  useEffect(() => {
    if (!seed || seedSentRef.current) return
    seedSentRef.current = true
    // The seed *is* the first message, so the cook-context slot is spent.
    contextSentRef.current = true
    // `seed.context` (issue #651, §8) is unset for `tip`/`use`/`plan`; the
    // `meal` seed sets it (`meal_fixed_main`), and it rides along here.
    if (seed.context) {
      sendMessage(seed.message, seed.context)
    } else {
      sendMessage(seed.message)
    }
  }, [seed, sendMessage])

  const dismissSeedCard = () => {
    // Hide immediately, then drop the params so a refresh doesn't resurrect the
    // card (or re-fire the auto-send on a fresh mount).
    setDismissedSeedKey(seed?.key ?? null)
    router.replace('/chat', { scroll: false })
  }

  /**
   * Ends the pinned cooking session: hides the banner immediately, then drops
   * the ?cooking= param so a refresh doesn't resurrect it.
   *
   * Takes the recipe id explicitly because the cook-completion path passes the
   * id it just cooked, which is not necessarily the one currently in the URL.
   */
  const endCookingSession = (recipeId: string | null) => {
    if (!recipeId) return
    setDismissedRecipeId(recipeId)
    if (cookingRecipeId === recipeId) router.replace('/chat', { scroll: false })
  }

  const dismissCookingCard = () => {
    // Walking away from the cook drops an amendment made during it (#489): the
    // next cook of this recipe starts from the recipe as saved.
    if (cookingRecipeId) clearAmendedCook(cookingRecipeId)
    endCookingSession(cookingRecipeId)
  }

  /**
   * "Update what I'm cooking" (#489). The hook confirms the amendment with the
   * AI service (which pins it for later turns); only once that succeeds is it
   * recorded here, so a failed apply changes nothing: the banner, the deduction
   * and the next message's pin all stay on the original list. The record is what
   * survives a reload (#490) and what "Finished cooking" deducts.
   */
  const handleApplyAmendment = async (msgId: string) => {
    if (!cookingRecipeId) return
    const applied = await applyAmendment(msgId)
    if (!applied) return
    saveAmendedCook(cookingRecipeId, {
      title: applied.recipe_title ?? cookingRecipe?.title ?? loadedRecipe?.title,
      ingredients: amendedLinesFromProposal(applied),
      changeSummary: applied.change_summary,
    })
    setCookTick((n) => n + 1)
  }

  // Only the newest amendment card can be acted on (each one is the model's
  // full list, so an older one would roll a later change back), and only for the
  // recipe being cooked right now. Everything else reads as handled or inert.
  const latestAmendmentMsgId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'assistant' && isRecipeAmendmentProposal(m.response?.proposal)) return m.id
    }
    return null
  })()
  // Read once per cook sheet (keyed on the target), not on every render: the
  // sheet's confirm ends the cook and clears the record mid-render (#489).
  const cookTargetAmended = useMemo(
    () =>
      cookTarget?.mode === 'confirm'
        ? (getAmendedCook(cookTarget.recipeId)?.ingredients ?? null)
        : null,
    [cookTarget],
  )
  const cookIsLive = Boolean(
    cookingRecipeId && cookingRecipeId !== dismissedRecipeId && !isCookSessionEnded(cookingRecipeId),
  )

  const handleNewChat = () => {
    // New conversation — the backend session is gone, so resend the context.
    contextSentRef.current = false
    // A seeded banner over an empty thread would be a lie; drop it (and its
    // params) rather than leave it hanging. `seedSentRef` stays set so the
    // fresh thread doesn't surprise the user with another auto-sent question.
    if (seed) {
      setDismissedSeedKey(seed.key)
      router.replace('/chat', { scroll: false })
    }
    // Fresh empty state, fresh clock read for the starter-pill ranker.
    setMountedAt(new Date())
    startNewChat()
  }

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  // Mascot state
  const mascotState = isStreaming ? 'thinking' : 'happy'

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    sendMessage(text, takeCookingContext())
  }

  const handleSuggestionClick = (suggestion: string) => {
    setInput('')
    sendMessage(suggestion, takeCookingContext())
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const persistRecipe = (recipe: ChatRecipeData, options: { draft: boolean }): Promise<Response> =>
    fetch('/api/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: recipe.title,
        description: recipe.description,
        ingredients: recipe.ingredients,
        instructions: recipe.instructions,
        // Structured steps (issue #648) carried through from the proposal so
        // guided cook mode doesn't have to derive them again on first open.
        steps: recipe.steps,
        cuisine: recipe.cuisine,
        meal_type: recipe.meal_type,
        dietary_tags: recipe.dietary_tags,
        difficulty: recipe.difficulty,
        prep_time_minutes: recipe.prep_time_minutes,
        cook_time_minutes: recipe.cook_time_minutes,
        total_time_minutes: recipe.total_time_minutes,
        servings: recipe.servings,
        is_draft: options.draft,
      }),
    })

  const handleSaveRecipe = async (msgId: string, recipe: ChatRecipeData) => {
    setSaveStates((prev) => ({ ...prev, [msgId]: 'saving' }))
    try {
      const res = await persistRecipe(recipe, { draft: false })
      if (res.ok) {
        setSaveStates((prev) => ({ ...prev, [msgId]: 'saved' }))
        queryClient.invalidateQueries({ queryKey: ['bubbles'] })
        const saved = await res.json().catch(() => null) as { id?: string } | null
        if (saved?.id) {
          setSavedRecipeIds((prev) => ({ ...prev, [msgId]: saved.id as string }))
        }
      } else {
        setSaveStates((prev) => ({ ...prev, [msgId]: 'error' }))
      }
    } catch {
      setSaveStates((prev) => ({ ...prev, [msgId]: 'error' }))
    }
  }

  /**
   * Reverse lookup: given a recipe db id, return the msgId that owns it.
   * Used in two places — hoisted to avoid repeating the fragile Object.keys scan.
   */
  const msgIdForRecipeId = (recipeId: string): string | undefined =>
    Object.keys(savedRecipeIds).find((k) => savedRecipeIds[k] === recipeId)

  /**
   * Returns { id, isDraft } for msgId, creating a draft row if needed.
   * isDraft is derived authoritatively inside this function:
   *   - pre-existing row → isDraft is whether msgId is already in draftRecipeIds (correct, no pending update)
   *   - newly created draft → isDraft is always true (we just POSTed with is_draft:true)
   * Double-tap safe: a second call while the POST is in flight reuses the same promise.
   * On POST failure the promise rejects; callers must handle (buttons re-enable via finally).
   */
  const ensureRecipeId = (msgId: string, recipe: ChatRecipeData): Promise<{ id: string; isDraft: boolean }> => {
    const existing = savedRecipeIds[msgId]
    if (existing) return Promise.resolve({ id: existing, isDraft: draftRecipeIds.has(msgId) })

    const inflight = ensureInFlight.current.get(msgId)
    if (inflight) return inflight

    const promise = persistRecipe(recipe, { draft: true })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to persist draft recipe')
        const saved = await res.json() as { id: string }
        setSavedRecipeIds((prev) => ({ ...prev, [msgId]: saved.id }))
        setDraftRecipeIds((prev) => new Set(prev).add(msgId))
        // This is always a freshly created draft — isDraft is authoritatively true.
        return { id: saved.id, isDraft: true }
      })
      .finally(() => {
        ensureInFlight.current.delete(msgId)
        setCookPending((prev) => {
          const next = new Set(prev)
          next.delete(msgId)
          return next
        })
      })

    ensureInFlight.current.set(msgId, promise)
    return promise
  }

  // Forwards a stamped pill's request context (issue #651, §1c/§4) — set only
  // by the resolver (`{ meal_followup: true }`), never from model output. An
  // unstamped chip (every non-meal pill) keeps the pre-#651 one-argument call.
  const handleChipTap = (chip: ChipConfig) => {
    if (chip.context) {
      sendChipMessage(chip.message, chip.context)
    } else {
      sendChipMessage(chip.message)
    }
  }

  const handleStageText = (text: string) => {
    setInput(text)
    inputRef.current?.focus()
  }

  const handlePickIdea = (idea: string) => {
    sendMessage(idea)
  }

  // ── Meal chat (issue #650) ────────────────────────────────────────────────

  /**
   * Tapping a meal option card sends a normal chat message — the option's
   * title as the visible text — with the structured option id in context.
   * The backend resolves the option from the session by id; it's never
   * fuzzy-matched from the title text (contract: "Pick: the request").
   */
  const handlePickMealOption = (option: MealOption) => {
    sendMessage(option.title, { meal_option_id: option.option_id })
  }

  /**
   * "Make it a meal" on a chat recipe card (issue #651 PR B). Uses
   * `sendMessage`, never `sendChipMessage`: the latter aborts a live stream,
   * which would defeat the double-tap guard (the card's button is disabled
   * while `isStreaming`, and `sendMessage` returns early while streaming).
   * The main is referenced by id only when THIS card's own Save succeeded
   * (that row is non-draft by construction); a cook-with-me draft or an
   * unknown id sends the recipe as a payload, so a draft is never linked.
   */
  const handleMakeMealFromCard = (msgId: string, recipe: ChatRecipeData) => {
    const savedId = saveStates[msgId] === 'saved' ? savedRecipeIds[msgId] : undefined
    sendMessage(makeMealMessage(recipe.title), {
      meal_fixed_main: fixedMainForCard(recipe, savedId),
    })
  }

  /** "Make it a meal" on a saved-recipe lookup card — the saved row, by id. */
  const handleMakeMealFromMatch = (match: SavedRecipeMatch) => {
    sendMessage(makeMealMessage(match.title), { meal_fixed_main: { recipe_id: match.id } })
  }

  /**
   * Resolves this message's meal id, creating it via `POST /api/meals` if it
   * doesn't exist yet. Shared by Open and Save so a tap on either while the
   * other's create is in flight reuses the same promise — the guard against
   * a second tap creating a second meal (contract: "A second tap never
   * creates a second meal").
   */
  const ensureMeal = (
    msgId: string,
    proposal: MealProposal,
    isDraft: boolean,
  ): Promise<{ id: string; isDraft: boolean }> => {
    const existing = mealIds[msgId]
    if (existing) return Promise.resolve(existing)

    const inflight = mealCreateInFlight.current.get(msgId)
    if (inflight) return inflight

    const promise = createMeal(buildCreateMealPayload(proposal, isDraft))
      .then((meal) => {
        const result = { id: meal.id, isDraft: meal.is_draft }
        setMealIds((prev) => ({ ...prev, [msgId]: result }))
        return result
      })
      .finally(() => {
        mealCreateInFlight.current.delete(msgId)
      })

    mealCreateInFlight.current.set(msgId, promise)
    return promise
  }

  /** Open meal: persists as a draft, then routes to the minimal meal page. */
  const handleOpenMeal = (msgId: string, proposal: MealProposal) => {
    if ((mealOpenStates[msgId] ?? 'idle') !== 'idle') return
    setMealOpenStates((prev) => ({ ...prev, [msgId]: 'pending' }))
    ensureMeal(msgId, proposal, true)
      .then(({ id }) => {
        setMealOpenStates((prev) => ({ ...prev, [msgId]: 'opened' }))
        router.push(`/meals/${id}`)
      })
      .catch(() => {
        setMealOpenStates((prev) => ({ ...prev, [msgId]: 'idle' }))
      })
  }

  /**
   * Save meal: `POST`s with `is_draft: false` if nothing exists for this
   * card yet, or `PUT { promote: true }` if Open meal already created a
   * draft (`ensureMeal` resolving to an existing draft row is exactly that
   * case — the resolved `isDraft` flag decides, not which button was tapped
   * first, so a race between the two buttons always ends in one meal).
   */
  const handleSaveMeal = (msgId: string, proposal: MealProposal) => {
    const state = mealSaveStates[msgId] ?? 'idle'
    if (state === 'saving' || state === 'saved') return
    setMealSaveStates((prev) => ({ ...prev, [msgId]: 'saving' }))

    ensureMeal(msgId, proposal, false)
      .then(async ({ id, isDraft }) => {
        if (isDraft) {
          await updateMeal(id, { promote: true })
          setMealIds((prev) => ({ ...prev, [msgId]: { id, isDraft: false } }))
        }
        setMealSaveStates((prev) => ({ ...prev, [msgId]: 'saved' }))
        queryClient.invalidateQueries({ queryKey: ['bubbles'] })
      })
      .catch(() => {
        setMealSaveStates((prev) => ({ ...prev, [msgId]: 'error' }))
      })
  }

  /**
   * A tap on an action-kind pill (issue #651, §4). Bound per message at the
   * render call site below, same pattern as `onOpenMeal`/`onSaveMeal`.
   *
   * `save_meal` writes nothing — the pill only bumps the focus token so
   * `CompactMealCard` scrolls to, focuses and highlights its own Save meal
   * button, which is the one confirm. `open_meal` (Start cooking) is exactly
   * the card's Open meal action; `proposal` is only passed for a meal-ready
   * message, so this is a no-op if it's somehow absent. `open_scan` matches
   * the starter row's scan pill.
   *
   * "Swap a side" was dropped from the pick-stage pills (issue #666 code
   * review) — it duplicated Start cooking's `open_meal` action, and the slot
   * it took is needed for "Different options" to always show once the model
   * returns a pill.
   */
  const handleChipAction = (action: ChipAction, msgId: string, proposal?: MealProposal) => {
    switch (action) {
      case 'save_meal':
        setMealSaveFocus((prev) => ({ ...prev, [msgId]: (prev[msgId] ?? 0) + 1 }))
        break
      case 'open_meal':
        if (proposal) handleOpenMeal(msgId, proposal)
        break
      case 'open_scan':
        router.push('/pantry?add=scan')
        break
    }
  }

  // Acts on the match by id — the same contract the single-match card's
  // "Cook this" action uses (`/chat?cooking=<id>`, read reactively via
  // `useSearchParams` above). Deliberately NOT sendMessage(match.title):
  // re-sending the bare title falls through to the LLM intent classifier,
  // which has no saved-recipe re-pick shortcut and can generate a
  // near-duplicate recipe instead of pinning the existing one (PR #614
  // review, finding 1).
  //
  // startCookSession(id) must run before the navigation, same as the
  // existing pin path at the "Start cooking" handler below: `isCookSessionEnded`
  // is localStorage-backed and survives across sessions, so for a recipe the
  // user already finished cooking, the ?cooking= param would otherwise be
  // stripped straight back out by the isCookSessionEnded effect above,
  // making the tap a silent no-op for exactly the recipes people look up
  // most (PR #614 re-review).
  //
  // Also clear a stale `dismissedRecipeId` for this same match. `cookingRecipe`
  // is gated on `cookingRecipeId !== dismissedRecipeId`, and dismissing the
  // banner sets `dismissedRecipeId` to the recipe's id without ever clearing
  // it — so tap → dismiss the banner → tap the same card again would
  // re-set the same ?cooking=<id> param but the banner stays hidden, since
  // dismissedRecipeId still matches it. An explicit re-tap is a fresh
  // decision to cook this recipe, so it overrides an earlier dismissal
  // (PR #614 round-3 review).
  const handlePickSavedRecipe = (match: SavedRecipeMatch) => {
    startCookSession(match.id)
    setDismissedRecipeId((prev) => (prev === match.id ? null : prev))
    router.replace(`/chat?cooking=${encodeURIComponent(match.id)}`, { scroll: false })
  }

  const handleConfirmChoice = (
    forcedIntent: 'recipe_card' | 'recipe_brainstorm',
    label: string,
    source?: string,
  ) => {
    sendConfirmChoice(label, forcedIntent, source)
  }

  // Determine if the typing indicator should show
  // (streaming has started but no content yet on the last assistant message)
  const lastMsg = messages[messages.length - 1]
  const showTypingIndicator =
    isStreaming && lastMsg?.role === 'assistant' && !lastMsg.content

  const hasMessages = messages.length > 0

  // Derived like the cook card: shown until the user dismisses this exact seed.
  const activeSeed = seed && seed.key !== dismissedSeedKey ? seed : null

  // Starter-pill context (issue #651, §4/§7) — only fetched for the plain
  // empty state: not while resuming a persisted conversation, not under the
  // cook handoff (that row is unrelated/unchanged), and not under a seed
  // (no pill row shows there at all). `rankStarterPills` degrades to the
  // time-of-day pill plus two fillers while this is pending or on error, so
  // there is no network wait before the first paint.
  const starter = useStarterContext(!hasMessages && !isResuming && !cookingRecipeId && !seed)

  return (
    <div className={`flex flex-col ${CHAT_VIEWPORT_CLASS}`}>
      {/* Header */}
      <BubblesHeader
        mascotState={mascotState}
        mascotAnimate={isStreaming}
        rightSlot={
          <div className="flex items-center gap-2">
            {hasMessages && (
              <button
                type="button"
                onClick={handleNewChat}
                className="text-xs font-semibold text-[var(--color-primary-dark)] bg-[var(--color-surface)] px-3 py-1.5 rounded-full hover:bg-[var(--color-border)] transition-colors"
              >
                New Chat
              </button>
            )}
            <ProfileHeaderButton />
          </div>
        }
      />

      {/* AI unavailable warning */}
      {!aiAvailable && (
        <div className="mx-4 mt-3 px-4 py-2.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl flex items-center gap-2 text-sm">
          <span>💤</span>
          <span className="text-[var(--color-text)]">
            Bubbles is taking a break — chat will be back soon. Your pantry and recipes still work.
          </span>
        </div>
      )}

      {/* Cook handoff context — pinned above the thread rather than scrolling
          with it. While a recipe is pinned, cooking *is* the task of this
          screen, and the banner is the only on-screen confirmation that Bubbles
          knows which recipe you mean; inside the scroll area it disappeared
          after a couple of turns (#242). */}
      <AnimatePresence>
        {cookingRecipe && (
          <div className="flex-shrink-0 px-4 pt-4">
            <CookingContextCard
              title={cookingRecipe.title}
              ingredientCount={amendedCook?.ingredients.length ?? cookingRecipe.ingredients.length}
              onDismiss={dismissCookingCard}
              onFinishCooking={() => {
                if (!cookingRecipeId) return
                // Two-tab double deduction guard (PR #475), checkpoint 1:
                // `cookingRecipe` above is only recomputed on render, so a
                // confirm from a *different* tab in between could leave this
                // tab's stale banner tappable. Re-check right here, at the
                // moment of the tap, before ever opening the confirm sheet.
                if (isCookSessionEnded(cookingRecipeId)) {
                  endCookingSession(cookingRecipeId)
                  return
                }
                const isDraft = draftRecipeIds.has(msgIdForRecipeId(cookingRecipeId) ?? '')
                setCookTarget({
                  recipeId: cookingRecipeId,
                  recipeTitle: cookingRecipe.title,
                  isDraft,
                  mode: 'confirm',
                })
              }}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Deep-link seed context (?tip= / ?use=) — same slot, same idiom */}
        <AnimatePresence>
          {activeSeed && (
            <ChatContextCard
              key={activeSeed.key}
              emoji={activeSeed.card.emoji}
              label={activeSeed.card.label}
              title={activeSeed.card.title}
              subtitle={activeSeed.card.subtitle}
              dismissLabel={activeSeed.card.dismissLabel}
              onDismiss={dismissSeedCard}
            />
          )}
        </AnimatePresence>

        {(hasMessages || isResuming) ? (
          <div className="flex flex-col gap-3">
            {messages.map((msg, index) => (
              <MessageRenderer
                key={msg.id}
                message={msg}
                isLastAssistant={
                  isStreaming &&
                  msg.role === 'assistant' &&
                  index === messages.length - 1
                }
                isStreaming={isStreaming}
                isLastSettledAssistant={
                  !isStreaming &&
                  msg.role === 'assistant' &&
                  index === messages.length - 1
                }
                retryText={messages[index - 1]?.role === 'user' ? messages[index - 1].content : undefined}
                proposalState={proposalStates[msg.id]}
                proposalError={proposalErrors[msg.id]}
                failedNames={proposalFailedNames?.[msg.id]}
                amendmentState={amendmentStates?.[msg.id] ?? 'pending'}
                amendmentError={amendmentErrors?.[msg.id]}
                amendmentActionable={
                  cookIsLive &&
                  msg.id === latestAmendmentMsgId &&
                  isRecipeAmendmentProposal(msg.response?.proposal) &&
                  msg.response.proposal.recipe_id === cookingRecipeId &&
                  Boolean(msg.response.request_id)
                }
                onApplyAmendment={() => handleApplyAmendment(msg.id)}
                onDismissAmendment={() => dismissAmendment(msg.id)}
                saveState={saveStates[msg.id] ?? 'idle'}
                onApprove={() => approveProposal(msg.id)}
                onReject={() => rejectProposal(msg.id)}
                onActionsChange={(actions) => updateProposalActions(msg.id, actions)}
                onSave={(recipe) => handleSaveRecipe(msg.id, recipe)}
                savedRecipeId={savedRecipeIds[msg.id] ?? null}
                isSavedDraft={draftRecipeIds.has(msg.id)}
                onCookWithMe={(recipe) => {
                  const title = recipe.title ?? 'Recipe'
                  setCookPending((prev) => new Set(prev).add(msg.id))
                  ensureRecipeId(msg.id, recipe).then(({ id: recipeId, isDraft }) => {
                    // Show what the cook will cost the pantry BEFORE starting,
                    // not as an audit afterwards (#267). Nothing is deducted
                    // here — "Start cooking" pins the session as before.
                    setCookTarget({
                      recipeId,
                      recipeTitle: title,
                      isDraft,
                      mode: 'preview',
                      msgId: msg.id,
                    })
                  }).catch(() => {
                    // POST failed — pending cleared in finally; buttons re-enable
                  })
                }}
                onAlreadyMade={(recipe) => {
                  const title = (msg.response?.proposal as { recipe?: { title?: string }; title?: string } | null)?.recipe?.title
                    ?? (msg.response?.proposal as { title?: string } | null)?.title
                    ?? 'Recipe'
                  setCookPending((prev) => new Set(prev).add(msg.id))
                  ensureRecipeId(msg.id, recipe).then(({ id: recipeId, isDraft }) => {
                    setCookStartedIds((prev) => new Set(prev).add(msg.id))
                    setCookTarget({ recipeId, recipeTitle: title, isDraft, mode: 'confirm' })
                  }).catch(() => {
                    // POST failed — pending cleared in finally; buttons re-enable
                  })
                }}
                cookState={
                  cookPending.has(msg.id)
                    ? 'pending'
                    : cookStartedIds.has(msg.id)
                    ? 'started'
                    : 'idle'
                }
                onTryAnother={() => sendChipMessage('Give me a different recipe')}
                onChipTap={handleChipTap}
                onChipAction={(action) => {
                  const proposal = msg.response?.proposal
                  handleChipAction(action, msg.id, isMealProposal(proposal) ? proposal : undefined)
                }}
                onPickIdea={handlePickIdea}
                onPickSavedRecipe={handlePickSavedRecipe}
                onMakeMealFromRecipe={(recipe) => handleMakeMealFromCard(msg.id, recipe)}
                onMakeMealFromMatch={handleMakeMealFromMatch}
                makeMealAvailable={!cookingRecipe}
                onConfirmChoice={handleConfirmChoice}
                onStageText={handleStageText}
                onPickMealOption={handlePickMealOption}
                onOpenSavedMeal={(mealId) => router.push(`/meals/${mealId}`)}
                onOpenMeal={(proposal) => handleOpenMeal(msg.id, proposal)}
                onSaveMeal={(proposal) => handleSaveMeal(msg.id, proposal)}
                mealOpenState={mealOpenStates[msg.id] ?? 'idle'}
                mealSaveState={mealSaveStates[msg.id] ?? 'idle'}
                mealSaveFocusToken={mealSaveFocus[msg.id] ?? 0}
              />
            ))}

            <AnimatePresence>
              {showTypingIndicator && <TypingIndicator />}
            </AnimatePresence>

            <div ref={messagesEndRef} />
          </div>
        ) : (
          /* Empty state — drops the full-height centering when the cook card
             is above it, so the two don't fight for the same space. */
          <div
            className={`flex flex-col items-center justify-center text-center pb-8 ${
              cookingRecipe || activeSeed ? 'pt-4' : 'h-full'
            }`}
          >
            <EmptyState
              mascotState="happy"
              headerLabel="Chef Bubbly"
              headerVariant="chat"
              headline={cookingRecipe ? 'Cooking with Bubbles' : 'Chat with Bubbles'}
              subline={
                cookingRecipe
                  ? 'Ask me anything about this recipe!'
                  : 'What are we cooking today?'
              }
              className="w-full max-w-sm mb-5"
            />
            {/* Chat-specific affordances — kept out of the generic EmptyState.
                Pinned-cooking row: unchanged. A seed above: no pill row (the
                seed card is already the affordance). Otherwise: the
                context-driven starter row (issue #651, §4/§7). */}
            {cookingRecipe ? (
              <div className="flex flex-wrap gap-2 justify-center">
                {COOKING_SUGGESTIONS.map((s, i) => (
                  <Chip key={s} tone={COOKING_SUGGESTION_TONES[i]} onClick={() => handleSuggestionClick(s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            ) : activeSeed ? null : (
              <PostMessageChips
                chips={rankStarterPills(starter.data ?? null, mountedAt)}
                align="center"
                onChipTap={(chip) => handleSuggestionClick(chip.message)}
                onChipAction={(action) => {
                  // The starter row's only action pill is the scan pill.
                  if (action === 'open_scan') router.push('/pantry?add=scan')
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Input bar — pinned under the list (a flex row, not a fixed overlay) */}
      <div className="flex-shrink-0 bg-[var(--color-surface)] border-t border-[var(--color-border)] p-3 flex gap-2">
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            // Stays enabled while a reply streams so the next question can be
            // composed as the answer arrives. Submitting is still blocked —
            // sendMessage returns early when isStreaming (useChat), and the Send
            // button is replaced by Stop below — so typing cannot interleave two
            // requests.
            aria-label="Message Bubbles"
            className="w-full rounded-full px-4 py-2.5 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:border-[var(--color-accent)] text-sm"
          />
          {/* Placeholder hides once anything is typed; no longer tied to streaming,
              since the field is now usable mid-stream. */}
          <RotatingPlaceholder visible={!input && !hasMessages && !isResuming} />
        </div>
        {isStreaming ? (
          <SpringButton
            onClick={cancelStream}
            className="bg-[var(--color-muted)] text-white font-semibold px-4 py-2.5 rounded-full"
          >
            Stop
          </SpringButton>
        ) : (
          <SpringButton
            onClick={handleSend}
            className="bg-[var(--color-primary)] text-white font-semibold px-4 py-2.5 rounded-full disabled:opacity-50"
            disabled={!input.trim()}
          >
            Send
          </SpringButton>
        )}
      </div>

      {/* Cook modal — opened when the user taps "Cook this" on a saved chat recipe */}
      {cookTarget && (
        <CookModal
          recipeId={cookTarget.recipeId}
          recipeTitle={cookTarget.recipeTitle}
          isDraft={cookTarget.isDraft}
          mode={cookTarget.mode}
          amendedIngredients={cookTargetAmended}
          onStartCooking={() => {
            // The preview was the decision point; this is where cooking actually
            // begins. Nothing was deducted by the preview.
            const { recipeId, msgId } = cookTarget
            if (msgId) setCookStartedIds((prev) => new Set(prev).add(msgId))
            // #440 — a fresh session starts now. Clear any stale "ended" record
            // from a previous cook of this same recipe so this legitimate new
            // session isn't mistaken for a stale re-entry and hidden.
            startCookSession(recipeId)
            setCookTarget(null)
            router.replace(`/chat?cooking=${encodeURIComponent(recipeId)}`, { scroll: false })
          }}
          onAddToLibrary={cookTarget.isDraft ? async () => {
            await promoteRecipeDraft(cookTarget.recipeId)
            // Promotion awards recipe_save (#520) — refetch the balance.
            queryClient.invalidateQueries({ queryKey: ['bubbles'] })
            setDraftRecipeIds((prev) => {
              const next = new Set(prev)
              const msgId = msgIdForRecipeId(cookTarget.recipeId)
              if (msgId) next.delete(msgId)
              return next
            })
          } : undefined}
          onClose={() => setCookTarget(null)}
          onCooked={() => {
            setCookTarget(null)
            // The cook is done: the ingredients are deducted, so the session is
            // no longer "cooking this". Retire the banner (#268) — otherwise it
            // survives the draft path, which unlike the saved path never
            // navigates away and so never dropped the ?cooking= param.
            endCookingSession(cookTarget.recipeId)
          }}
        />
      )}
    </div>
  )
}

// ─── Cooking Context Card ─────────────────────────────────────────────────────

// ─── Message Renderer ─────────────────────────────────────────────────────────

interface MessageRendererProps {
  message: ChatMessage
  isLastAssistant: boolean
  isStreaming: boolean
  isLastSettledAssistant: boolean
  /** The user message this reply answers — what "Try again" resends on an AI-error reply (#732). */
  retryText?: string
  proposalState?: 'pending' | 'approving' | 'approved' | 'rejected' | 'failed'
  proposalError?: string
  failedNames?: string[]
  /** State / reason / actionability of an "Update what I'm cooking" card (#489). */
  amendmentState: AmendmentCardState
  amendmentError?: string
  amendmentActionable: boolean
  onApplyAmendment: () => void
  onDismissAmendment: () => void
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  onApprove: () => void
  onReject: () => void
  /** Called when the user edits a qty/unit inline on a proposal action row. */
  onActionsChange: (actions: PantryProposalAction[]) => void
  onSave: (recipe: ChatRecipeData) => void
  savedRecipeId: string | null
  /** True when savedRecipeId points to a draft row (not yet a real library entry). */
  isSavedDraft: boolean
  /** Visual state for cook buttons — 'pending' while a draft POST is in flight. */
  cookState: 'idle' | 'pending' | 'started'
  onCookWithMe: (recipe: ChatRecipeData) => void
  onAlreadyMade: (recipe: ChatRecipeData) => void
  onTryAnother: () => void
  onChipTap: (chip: ChipConfig) => void
  /** Action-kind pill tap (issue #651, §4) — save_meal / open_meal / open_scan. */
  onChipAction: (action: ChipAction) => void
  onPickIdea: (idea: string) => void
  onPickSavedRecipe: (match: SavedRecipeMatch) => void
  /** "Make it a meal" on a chat recipe card (issue #651 PR B). */
  onMakeMealFromRecipe: (recipe: ChatRecipeData) => void
  /** "Make it a meal" on a saved-recipe lookup card. */
  onMakeMealFromMatch: (match: SavedRecipeMatch) => void
  /** False while a cook is pinned in chat: no make-it-a-meal buttons then. */
  makeMealAvailable: boolean
  /** Called when the user taps a confirm-band button (#416 AC3). */
  onConfirmChoice: (
    forcedIntent: 'recipe_card' | 'recipe_brainstorm',
    label: string,
    source?: string,
  ) => void
  /** Stage text in the input field (clarification pill selections). */
  onStageText: (text: string) => void
  /** Meal chat (issue #650) — a tap on an option card. */
  onPickMealOption: (option: MealOption) => void
  /** A saved meal from the lookup (issue #760): open the existing meal by id. */
  onOpenSavedMeal: (mealId: string) => void
  /** Compact meal card — Open meal / Save meal. */
  onOpenMeal: (proposal: MealProposal) => void
  onSaveMeal: (proposal: MealProposal) => void
  mealOpenState: 'idle' | 'pending' | 'opened'
  mealSaveState: 'idle' | 'saving' | 'saved' | 'error'
  /** Bumped by a "Save this meal" pill tap — see `CompactMealCard.focusSaveToken`. */
  mealSaveFocusToken: number
}

function MessageRenderer({
  message,
  isLastAssistant,
  isStreaming,
  isLastSettledAssistant,
  retryText,
  proposalState,
  proposalError,
  failedNames,
  amendmentState,
  amendmentError,
  amendmentActionable,
  onApplyAmendment,
  onDismissAmendment,
  saveState,
  onApprove,
  onReject,
  onActionsChange,
  onSave,
  savedRecipeId,
  isSavedDraft,
  cookState,
  onCookWithMe,
  onAlreadyMade,
  onTryAnother,
  onChipTap,
  onChipAction,
  onPickIdea,
  onPickSavedRecipe,
  onMakeMealFromRecipe,
  onMakeMealFromMatch,
  makeMealAvailable,
  onConfirmChoice,
  onStageText,
  onPickMealOption,
  onOpenSavedMeal,
  onOpenMeal,
  onSaveMeal,
  mealOpenState,
  mealSaveState,
  mealSaveFocusToken,
}: MessageRendererProps) {
  // User messages — simple bubble
  if (message.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <MessageBubble message={message} />
      </motion.div>
    )
  }

  const mascotState = isLastAssistant && isStreaming ? 'thinking' : 'happy'
  const intent = message.intent ?? message.response?.intent

  // A canned AI-failure reply (#732): no normal follow-ups, which would only
  // fail the same way, and at most one "Try again" that resends the last message.
  const aiErrorKind = getAiErrorKind(message.response)
  if (aiErrorKind) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <div className="flex items-end gap-2">
          <BubblesMascot size={36} state={mascotState} animate={false} className="flex-shrink-0 mb-1" />
          <MessageBubble message={message} />
        </div>
        {isLastSettledAssistant && (
          <PostMessageChips
            chips={resolveAiErrorChips(aiErrorKind, retryText)}
            onChipTap={onChipTap}
            onChipAction={onChipAction}
          />
        )}
      </motion.div>
    )
  }

  // Mid-cook amendment (#489): the reply text plus the "Update what I'm cooking"
  // card. Checked first: an amendment turn carries no pantry or recipe payload.
  const amendmentProposal: RecipeAmendmentProposal | null = isRecipeAmendmentProposal(
    message.response?.proposal,
  )
    ? (message.response?.proposal as RecipeAmendmentProposal)
    : null
  if (amendmentProposal) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <div className="flex items-end gap-2">
          <BubblesMascot size={36} state={mascotState} animate={false} className="flex-shrink-0 mb-1" />
          <div className="flex flex-col gap-2 items-start min-w-0">
            {message.content && <MessageBubble message={message} />}
            <CookingAmendmentCard
              proposal={amendmentProposal}
              state={amendmentState}
              actionable={amendmentActionable}
              errorMessage={amendmentError}
              onApply={onApplyAmendment}
              onDismiss={onDismissAmendment}
            />
          </div>
        </div>
      </motion.div>
    )
  }

  // Confirm-choice band — renders before brainstorm so the explicit
  // next_action gate fires first. The band fires when the backend can't
  // decide between "tweak this" and "start fresh" (#416 AC3).
  if (message.response?.next_action === 'confirm_choice') {
    const confirmOptions = getConfirmOptions(message.response)
    if (confirmOptions.length > 0) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <div className="flex items-end gap-2">
            <BubblesMascot size={36} state={mascotState} animate={false} className="flex-shrink-0 mb-1" />
            <div className="flex flex-col gap-2 items-start">
              {message.content && <MessageBubble message={message} />}
              <ConfirmBand
                options={confirmOptions}
                onSelect={(forcedIntent, label) =>
                  onConfirmChoice(forcedIntent, label, message.confirmSource)
                }
                disabled={!isLastSettledAssistant}
              />
            </div>
          </div>
        </motion.div>
      )
    }
  }

  // Brainstorm intent — render intro bubble + tappable idea cards
  // Falls through to plain markdown if metadata.brainstorm_ideas is absent (backward compat).
  if (intent === 'recipe_brainstorm') {
    const ideas = getBrainstormIdeas(message.response)
    if (ideas.length > 0) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <div className="flex items-end gap-2">
            <BubblesMascot size={36} state={mascotState} animate={false} className="flex-shrink-0 mb-1" />
            <div className="flex flex-col gap-2 items-start">
              {message.content && <MessageBubble message={message} />}
              <BrainstormOptions
                ideas={ideas}
                onSelect={onPickIdea}
                disabled={!isLastSettledAssistant}
              />
            </div>
          </div>
        </motion.div>
      )
    }
  }

  // Saved-recipe lookup intent — render intro bubble + ranked/single match
  // cards. Zero matches falls through to the plain markdown reply (the
  // assistant's "none found" text stands alone with the existing chips);
  // metadata absence falls through the same way (backward compat, matching
  // the brainstorm branch above). Follow-up chips (My saved recipes /
  // Generate a new one) still render below the cards — they're the escape
  // hatch when the matches are wrong, and dropping them here was a
  // regression the issue didn't ask for (PR #614 review, finding 2).
  if (intent === 'saved_recipe_lookup') {
    const matches = getSavedRecipeMatches(message.response)
    // Saved meals (issue #760) lead: the user said "dinner"/"meal". Each is an
    // existing row, so the card opens it by id and its Save is already done.
    const mealMatches = getSavedMealMatches(message.response)
    if (matches.length > 0 || mealMatches.length > 0) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <div className="flex items-end gap-2">
            <BubblesMascot size={36} state={mascotState} animate={false} className="flex-shrink-0 mb-1" />
            <div className="flex flex-col gap-2 items-start">
              {message.content && <MessageBubble message={message} />}
              {mealMatches.map((meal) => (
                <CompactMealCard
                  key={meal.id}
                  proposal={savedMealToProposal(meal)}
                  onOpenMeal={() => onOpenSavedMeal(meal.id)}
                  onSaveMeal={() => {}}
                  saveState="saved"
                />
              ))}
              {matches.length > 0 && (
                <SavedRecipeMatches
                  matches={matches}
                  onSelect={onPickSavedRecipe}
                  onMakeMeal={makeMealAvailable ? onMakeMealFromMatch : undefined}
                  disabled={!isLastSettledAssistant}
                />
              )}
            </div>
          </div>
          {isLastSettledAssistant && !isFollowUpsPending(message.response) && (
            <PostMessageChips
              chips={resolveChips(intent, getFollowUpSuggestions(message.response))}
              onChipTap={onChipTap}
              onChipAction={onChipAction}
            />
          )}
        </motion.div>
      )
    }
  }

  // Meal plan intent (issue #650) — option stage renders three tappable meal
  // option cards; the pick stage renders the compact meal card. Falls through
  // to the plain markdown reply for anything else (a model failure that
  // never produced a proposal, matching the existing recipe/brainstorm
  // fallback pattern) — the generic chat error text plus a resend is the
  // retry affordance, same as every other intent.
  if (intent === 'meal_plan') {
    const proposal = message.response?.proposal
    if (message.response?.next_action === 'pick_meal' && isMealOptionsProposal(proposal)) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <div className="flex items-end gap-2">
            <BubblesMascot size={36} state={mascotState} animate={false} className="flex-shrink-0 mb-1" />
            <div className="flex flex-col gap-2 items-start">
              {message.content && <MessageBubble message={message} />}
              <MealOptionCards
                options={proposal.options}
                onSelect={onPickMealOption}
                disabled={!isLastSettledAssistant}
              />
            </div>
          </div>
          {isLastSettledAssistant && !isFollowUpsPending(message.response) && (
            <PostMessageChips
              chips={resolveChips(intent, getFollowUpSuggestions(message.response), proposal.proposal_type, {
                fixedMain: Boolean(proposal.fixed_main),
              })}
              onChipTap={onChipTap}
              onChipAction={onChipAction}
            />
          )}
        </motion.div>
      )
    }
    if (isMealProposal(proposal)) {
      const mealSaved = mealSaveState === 'saving' || mealSaveState === 'saved'
      return (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <div className="flex items-end gap-2">
            <BubblesMascot size={36} state={mascotState} animate={false} className="flex-shrink-0 mb-1" />
            <div className="flex flex-col gap-2 items-start">
              {message.content && <MessageBubble message={message} />}
              <CompactMealCard
                proposal={proposal}
                onOpenMeal={() => onOpenMeal(proposal)}
                onSaveMeal={() => onSaveMeal(proposal)}
                openState={mealOpenState}
                saveState={mealSaveState}
                focusSaveToken={mealSaveFocusToken}
              />
            </div>
          </div>
          {isLastSettledAssistant && !isFollowUpsPending(message.response) && (
            <PostMessageChips
              chips={resolveChips(intent, getFollowUpSuggestions(message.response), 'meal', { mealSaved })}
              onChipTap={onChipTap}
              onChipAction={onChipAction}
            />
          )}
        </motion.div>
      )
    }
  }

  // Recipe card intent
  if (
    (intent === 'recipe_card' || intent === 'recipe_generation') &&
    message.response?.proposal
  ) {
    const rawProposal = message.response.proposal as { recipe?: ChatRecipeData } | ChatRecipeData
    const recipe = (rawProposal && 'recipe' in rawProposal && rawProposal.recipe)
      ? rawProposal.recipe
      : rawProposal as ChatRecipeData
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <div className="flex items-end gap-2">
          <BubblesMascot size={36} state={mascotState} animate={false} className="flex-shrink-0 mb-1" />
          <div className="flex flex-col gap-2 items-start">
            {message.content && (
              <MessageBubble message={message} />
            )}
            <ChatRecipeCard
              recipe={recipe}
              onSave={() => onSave(recipe)}
              onTryAnother={onTryAnother}
              saveState={saveState}
              savedRecipeId={savedRecipeId}
              isSavedDraft={isSavedDraft}
              cookState={cookState}
              onCookWithMe={() => onCookWithMe(recipe)}
              onAlreadyMade={() => onAlreadyMade(recipe)}
              onMakeMeal={
                makeMealAvailable && cookState !== 'started'
                  ? () => onMakeMealFromRecipe(recipe)
                  : undefined
              }
              makeMealDisabled={isStreaming}
            />
          </div>
        </div>
      </motion.div>
    )
  }

  // Pantry proposal intent — a proposal can legitimately carry zero actions
  // (every item the user mentioned was too generic — "veggies", "dairy
  // stuff" — to write to the pantry). useChat's onDone already merges that
  // turn's clarification terms into an earlier still-open card when one
  // exists (message.response.metadata.clarification_suggestions carries the
  // accumulated set), so the two render branches below are: a card with
  // actions (optionally plus merged clarification pills), or — only when
  // there was nothing earlier to merge into — ClarificationCard standalone.
  // If there are no suggestions either (LLM call failed, or none were
  // vague), fall through to the plain text bubble, which still carries the
  // assistant's clarifying question.
  const pantryProposal =
    intent === 'pantry_update' ? (message.response?.proposal as PantryProposalData | undefined) : undefined
  const clarificationTerms =
    intent === 'pantry_update' ? getClarificationSuggestions(message.response) : []
  if (pantryProposal && pantryProposal.actions.length > 0) {
    const proposal = pantryProposal
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <div className="flex items-end gap-2">
          <BubblesMascot size={36} state={mascotState} animate={false} className="flex-shrink-0 mb-1" />
          <div className="flex flex-col gap-2 items-start">
            {message.content && (
              <MessageBubble message={message} />
            )}
            <PantryProposalCard
              proposal={proposal}
              onApprove={onApprove}
              onReject={onReject}
              state={proposalState ?? 'pending'}
              error={proposalError}
              failedNames={failedNames}
              clarificationTerms={clarificationTerms}
              onStagePick={(sel) => onStageText(buildClarificationText(sel))}
              onActionsChange={onActionsChange}
            />
          </div>
        </div>
      </motion.div>
    )
  }
  if (pantryProposal && clarificationTerms.length > 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <div className="flex items-end gap-2">
          <BubblesMascot size={36} state={mascotState} animate={false} className="flex-shrink-0 mb-1" />
          <div className="flex flex-col gap-2 items-start">
            {message.content && (
              <MessageBubble message={message} />
            )}
            <ClarificationCard
              terms={clarificationTerms}
              onStagePick={(sel) => onStageText(buildClarificationText(sel))}
              disabled={proposalState !== undefined && proposalState !== 'pending'}
            />
          </div>
        </div>
      </motion.div>
    )
  }

  // Default: text message with markdown (skip empty streaming messages — typing indicator handles those)
  if (!message.content && isLastAssistant) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      <div className="flex items-end gap-2">
        <BubblesMascot size={36} state={mascotState} animate={false} className="flex-shrink-0 mb-1" />
        <MessageBubble message={message} />
      </div>
      {/* Follow-up affordances — only under the last settled assistant reply.
          Recipe-card and pantry-proposal messages carry their own actions. */}
      {/* While the context-aware chips are still on their way (issue #498)
          show none rather than flashing the static set and swapping it out. */}
      {isLastSettledAssistant && !isFollowUpsPending(message.response) && (
        <PostMessageChips
          chips={resolveChips(intent, getFollowUpSuggestions(message.response))}
          onChipTap={onChipTap}
          onChipAction={onChipAction}
        />
      )}
    </motion.div>
  )
}
