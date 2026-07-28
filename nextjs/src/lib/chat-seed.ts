/**
 * Chat deep-link seeds — issues #143 and #138.
 *
 * Two URL params prime `/chat` with a first message that is auto-sent on load:
 *
 *   /chat?tip=<tip text>                  — "explain today's tip" (#143)
 *   /chat?use=<name>[&expires=<ISO date>] — "cook this before it goes bad" (#138)
 *
 * Both mirror the existing `?cooking=` handoff: read the param, show a
 * dismissible context card above the thread, and prime the conversation.
 *
 * IMPORTANT — the seed lives in the *message text*, not in a context payload.
 * The AI service only recognises one client-supplied context key
 * (`cooking_recipe`); anything else is ignored, and the must-use ingredient is
 * recovered by an LLM structured-output call over the message itself. So the
 * ingredient name and the tip text have to appear verbatim in `message`, and
 * the `"with my <name>"` phrasing below is the one the backend prompt was
 * tuned against. Don't reword it without re-tuning `recipe/nodes.py`.
 */

/** Minimal read surface shared by `URLSearchParams` and Next's readonly variant. */
export interface ReadableSearchParams {
  get(name: string): string | null
}

export type ChatSeedKind = 'tip' | 'use'

export interface ChatSeedCard {
  emoji: string
  label: string
  title: string
  subtitle?: string
  dismissLabel: string
}

export interface ChatSeed {
  /** Stable identity — gates the one-shot auto-send and the dismissal. */
  key: string
  kind: ChatSeedKind
  /** Auto-sent as the conversation's first message. */
  message: string
  card: ChatSeedCard
}

/** Trimmed param value, or null when absent/blank. */
function param(params: ReadableSearchParams, name: string): string | null {
  const raw = params.get(name)
  if (raw === null) return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

// ─── Link builders ────────────────────────────────────────────────────────────

/** Dashboard tip card → chat primed to explain that tip. */
export function tipChatHref(tip: string): string {
  return `/chat?${new URLSearchParams({ tip }).toString()}`
}

/** Expiring item (hero CTA or pantry card) → chat primed to cook it. */
export function cookThisHref(name: string, expiryDate?: string | null): string {
  const params = new URLSearchParams({ use: name })
  if (expiryDate) params.set('expires', expiryDate)
  return `/chat?${params.toString()}`
}

// ─── Message builders ─────────────────────────────────────────────────────────

export function tipSeedMessage(tip: string): string {
  return `Tell me more about this kitchen tip: "${tip}" — why does it work, and when should I use it?`
}

/**
 * The ingredient name is interpolated verbatim (no re-pluralising, no
 * title-casing): the backend matches it against the pantry by substring in both
 * directions, so "eggs" correctly hits an item named "large free-range eggs".
 */
export function ingredientSeedMessage(name: string): string {
  return `What can I make with my ${name} before they go bad?`
}

// ─── Expiry phrasing ──────────────────────────────────────────────────────────

/**
 * Human phrasing for an ISO expiry date, matching `pantry-helpers`' day maths
 * (midnight-today → expiry, rounded up). Returns null for a missing/unparseable
 * date so callers can fall back.
 */
export function expiryPhrase(
  expiryDate: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!expiryDate) return null
  const expiry = new Date(expiryDate)
  if (Number.isNaN(expiry.getTime())) return null

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const days = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (days < 0) return 'already expired'
  if (days === 0) return 'expires today'
  if (days === 1) return 'expires tomorrow'
  return `expires in ${days} days`
}

// ─── Seed derivation ──────────────────────────────────────────────────────────

/**
 * Read the seed out of the URL. Returns null when neither param is present —
 * which is what keeps a bare `/chat` (bottom nav) a clean, empty conversation.
 */
export function deriveChatSeed(
  params: ReadableSearchParams,
  now: Date = new Date(),
): ChatSeed | null {
  const tip = param(params, 'tip')
  if (tip) {
    return {
      key: `tip:${tip}`,
      kind: 'tip',
      message: tipSeedMessage(tip),
      card: {
        emoji: '💡',
        label: "Today's tip",
        title: tip,
        dismissLabel: 'Dismiss tip context',
      },
    }
  }

  const name = param(params, 'use')
  if (name) {
    const expires = param(params, 'expires')
    return {
      key: `use:${name}:${expires ?? ''}`,
      kind: 'use',
      message: ingredientSeedMessage(name),
      card: {
        emoji: '⏳',
        label: 'Cook this now',
        title: `Using your ${name}`,
        subtitle: expiryPhrase(expires, now) ?? 'before it goes bad',
        dismissLabel: 'Dismiss expiring item context',
      },
    }
  }

  return null
}
