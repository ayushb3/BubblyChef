/**
 * The Bubbles card picker (issue #755, Goal 2 of the signature PRD).
 *
 * Under the kitchen scene one card says the single most useful thing right now.
 * `pickHomeCard` takes a snapshot of everything it depends on and returns at most
 * one card; the first case that matches wins:
 *
 *   1. something in progress: a cook left mid-recipe, then scanned groceries not
 *      put away
 *   2. tonight's planned meal (a saved meal set to Serve at today)
 *   2b. an empty pantry: the first-run prompt, Scan receipt (beats everything below)
 *   3. food that expires today or tomorrow (skipped when expiry priority is Off)
 *   4. mealtime with nothing urgent (06-10, 11-14, 17-21 local): the ranked starter pills
 *   5. a quiet moment: a tip, alternating by day with a seasonal idea
 *
 * Pure and deterministic: no clock read (`now` is in the snapshot), no storage,
 * nothing fetched. The seen and dismissed records come in as plain data
 * (`home-card-store.ts` keeps them), and a pill is a link to the existing chat
 * seeds (`chat-seed.ts`), so every answer is a href or a named action the card's
 * component wires.
 *
 * Two rules decide whether a matching case is allowed to show:
 *  - once a day: a nudge is counted per fingerprint per local day. A fingerprint
 *    already shown today is skipped, so a later visit that day falls through to
 *    the next case. (A nudge stays up for the visit it first appears on because
 *    the caller reads `seen` once, at the start of the visit.) Case 5 and the empty-pantry prompt are never capped.
 *  - Not now: a dismissed fingerprint stays away until it changes, a different
 *    item, step, scan or meal. It applies to every case, case 5 included.
 *
 * A fingerprint names the thing the nudge is about, so "the same nudge" is exactly
 * "the same thing": `cook:recipe:<id>:<step>`, `scan:<savedAt>`,
 * `planned:<mealId>:<serveAt>`, `expiring:<item>:<date>`. A nudge with nothing in
 * it that can change carries the local day instead, so Not now lasts for that day
 * and not forever: `empty:<day>`, `mealtime:<meal>:<day>`, `quiet:tip:<day>:<text>`,
 * `quiet:season:<day>:<produce>`.
 */
import type { StarterContext } from '@/types/chat'
import type { ExpiryPriority } from '@/lib/expiry-priority'
import { askHref, cookThisHref, ingredientSeedMessage, planDinnerHref, tipChatHref } from '@/lib/chat-seed'
import { rankStarterPills } from '@/lib/starter-pills'
import { localDay } from '@/lib/kitchen/home-card-store'
import { isPlannedForToday, type PlannedTonight } from '@/lib/kitchen/planned-tonight'
import { dayOfYear, seasonalProduce, tipRotation } from '@/lib/kitchen/quiet-ideas'

export type HomeCardKind = 'cook' | 'scan' | 'planned' | 'empty' | 'expiring' | 'mealtime' | 'quiet'

/** What a button does when it is not a link: the card's component wires these. */
export type HomeCardActionId =
  | 'finish-cook'
  | 'put-away'
  | 'discard-scan'
  | 'move-tomorrow'
  | 'another-tip'

export interface HomeCardAction {
  label: string
  /** A chat seed or a route: the button is a link. */
  href?: string
  /** Otherwise the button runs this. */
  action?: HomeCardActionId
}

export interface HomeCard {
  kind: HomeCardKind
  /** Names the thing the nudge is about: the unit of the once-a-day cap and of Not now. */
  fingerprint: string
  message: string
  /** The outlined keycaps above the divider, in order. */
  options: HomeCardAction[]
  /** The filled keycap below it. */
  primary: HomeCardAction
}

/** A cook left mid-recipe: a guided recipe cook or a meal cook-along, ready to say. */
export interface CookResume {
  kind: 'recipe' | 'meal'
  id: string
  /** The recipe's or meal's title. */
  title: string
  /** The step the user was on, counting from 1. */
  step: number
  /** How many steps there are; 0 when unknown. */
  totalSteps: number
}

/** Scanned groceries that have not been put away yet. */
export interface PendingScan {
  /** When the scan was parsed: identifies it. */
  savedAt: string
  /** How many items the scan holds. */
  itemCount: number
}

export interface ExpiringItem {
  name: string
  /** Whole days from today; 0 is today, negative is already expired. */
  daysUntil: number
  expiryDate: string | null
}

export interface HomeCardSnapshot {
  /** The local time. Injected: the picker never reads a clock. */
  now: Date
  cook: CookResume | null
  pending: PendingScan | null
  planned: PlannedTonight | null
  /** How many items are in the pantry, or `null` when that could not be read (not the same as none). */
  pantryCount: number | null
  expiring: ExpiringItem[]
  expiryPriority: ExpiryPriority
  /** The starter-pill context, or `null` while it loads or if it failed. */
  starter: StarterContext | null
  /** Today's tip from the daily-tip endpoint, or `null` when it could not be had. */
  tip: string | null
  /** How many times "Another tip" was tapped this visit. */
  tipTaps: number
  /** fingerprint -> the local day it was first shown. */
  seen: Readonly<Record<string, string>>
  /** Fingerprints sent away with Not now. */
  dismissed: readonly string[]
}

// ---- small copy helpers ---------------------------------------------------

// A dish name goes into card copy exactly as written ("Back to the Salmon Avocado
// Toast?"). Lower-casing only its first letter read wrong mid-sentence, and
// lower-casing all of it breaks proper nouns ("Thai", "Caesar"): issue #838.

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

function servingsWord(n: number): string {
  return Number.isInteger(n) && n >= 1 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n)
}

/** "7:00", "6:15": the clock the board shows, 12-hour with no am or pm. */
function clock(ms: number): string {
  const d = new Date(ms)
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "romaine needs", "eggs need": the verb follows a plural-looking name. */
function needsUsing(name: string): string {
  const plural = /s$/i.test(name) && !/(ss|us|is)$/i.test(name)
  return plural ? 'need' : 'needs'
}

function truncate(text: string, max = 28): string {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text
}

type MealSlot = 'breakfast' | 'lunch' | 'dinner'

/** Mealtime windows, local: 06-10, 11-14 and 17-21 (to 21:59). Otherwise null. */
function mealSlot(now: Date): MealSlot | null {
  const h = now.getHours()
  if (h >= 6 && h < 11) return 'breakfast'
  if (h >= 11 && h < 15) return 'lunch'
  if (h >= 17 && h < 22) return 'dinner'
  return null
}

/** What to call a meal served at `ms`, by the hour. */
function mealWord(ms: number): 'Breakfast' | 'Lunch' | 'Dinner' {
  const h = new Date(ms).getHours()
  if (h >= 5 && h < 11) return 'Breakfast'
  if (h >= 11 && h < 16) return 'Lunch'
  return 'Dinner'
}

const PLAN_DINNER: HomeCardAction = { label: 'Plan a whole dinner', href: planDinnerHref() }

// ---- the cases ------------------------------------------------------------

function cookCard(cook: CookResume): HomeCard {
  const title = cook.title.trim()
  return {
    kind: 'cook',
    fingerprint: `cook:${cook.kind}:${cook.id}:${cook.step}`,
    message:
      cook.totalSteps > 0
        ? `Back to the ${title}? You were on step ${cook.step} of ${cook.totalSteps}.`
        : `Back to the ${title}?`,
    options: [{ label: 'I finished it', action: 'finish-cook' }],
    primary: {
      label: `Pick up at step ${cook.step}`,
      href: cook.kind === 'meal' ? `/meals/${cook.id}/cook` : `/recipes?resume=${cook.id}`,
    },
  }
}

function scanCard(pending: PendingScan): HomeCard {
  const n = pending.itemCount
  return {
    kind: 'scan',
    fingerprint: `scan:${pending.savedAt}`,
    message: `Shopping is waiting at the door. ${n} ${n === 1 ? 'item' : 'items'} to put away.`,
    options: [{ label: 'Discard the scan', action: 'discard-scan' }],
    primary: { label: 'Put it away', action: 'put-away' },
  }
}

/** Grace after the serve time during which tonight's meal is still "tonight". */
const PLANNED_GRACE_MS = 60 * 60_000

function plannedCard(planned: PlannedTonight, now: Date): HomeCard {
  const start =
    planned.startAtMs <= now.getTime() ? 'now' : `at ${clock(planned.startAtMs)}`
  const what = planned.startDish ? `Start the ${planned.startDish.trim()}` : 'Start cooking'
  return {
    kind: 'planned',
    fingerprint: `planned:${planned.mealId}:${planned.serveAtMs}`,
    message: `${mealWord(planned.serveAtMs)} for ${servingsWord(planned.servings)} at ${clock(planned.serveAtMs)}. ${what} ${start} and everything lands together.`,
    options: [{ label: 'Move it to tomorrow', action: 'move-tomorrow' }],
    primary: { label: 'Show the timeline', href: `/meals/${planned.mealId}` },
  }
}

/** Today or tomorrow, soonest first, ties by name. Already-expired food is not urgent here. */
function urgentItem(items: ExpiringItem[]): ExpiringItem | null {
  const urgent = items
    .filter((i) => i.daysUntil >= 0 && i.daysUntil <= 1)
    .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name))
  return urgent[0] ?? null
}

function makeAgainOption(starter: StarterContext | null): HomeCardAction | null {
  const recent = starter?.recent_cooks[0]
  if (!recent) return null
  const name = recent.title.replace(/^the\s+/i, '').trim()
  return {
    label: `Make the ${truncate(name)} again`,
    href: askHref(`Show me my saved ${recent.title}`),
  }
}

function expiringCard(item: ExpiringItem, starter: StarterContext | null): HomeCard {
  const name = item.name.trim().toLowerCase()
  const options: HomeCardAction[] = [
    { label: `Dinner with the ${name}`, href: planDinnerHref([name]) },
    {
      label: 'Something in 20 minutes',
      href: askHref(`Something I can cook in 20 minutes, using my ${name}`),
    },
  ]
  const again = makeAgainOption(starter)
  if (again) options.push(again)
  return {
    kind: 'expiring',
    fingerprint: `expiring:${name}:${item.expiryDate ?? ''}`,
    message: `Your ${name} ${needsUsing(name)} using ${item.daysUntil === 0 ? 'today' : 'by tomorrow'}. Want me to plan dinner around it?`,
    options,
    primary: PLAN_DINNER,
  }
}

/** First run: nothing in the kitchen yet. Scanning a receipt is the quickest way to stock it. */
function emptyCard(now: Date): HomeCard {
  return {
    kind: 'empty',
    fingerprint: `empty:${localDay(now)}`,
    message: "Your kitchen's empty. Let's stock up!",
    options: [{ label: 'Add by hand', href: '/?add=type' }],
    primary: { label: 'Scan receipt', href: '/?add=scan' },
  }
}

const SURPRISE_ME: HomeCardAction = {
  label: 'Surprise me',
  href: askHref('Surprise me with something to cook'),
}

/** The most pills the card shows before Surprise me: the board's three keycaps. */
const MAX_PILLS = 2

function mealtimeCard(slot: MealSlot, now: Date, starter: StarterContext | null): HomeCard {
  const options: HomeCardAction[] = []
  for (const chip of rankStarterPills(starter, now)) {
    // The dinner pill says what the primary key already does.
    if (/^Plan dinner for \d+$/.test(chip.message)) continue
    let href: string
    const expiring = starter?.expiring.find((e) => ingredientSeedMessage(e.name) === chip.message)
    if (chip.kind === 'action' && chip.action === 'open_scan') href = '/?add=scan'
    else if (expiring) href = cookThisHref(expiring.name, expiring.expiry_date)
    else href = askHref(chip.message)
    options.push({ label: chip.label, href })
    if (options.length >= MAX_PILLS) break
  }
  options.push(SURPRISE_ME)
  const word = slot === 'breakfast' ? 'Breakfast' : slot === 'lunch' ? 'Lunch' : 'Dinner'
  return {
    kind: 'mealtime',
    fingerprint: `mealtime:${slot}:${localDay(now)}`,
    message: `${word} time! What are you in the mood for?`,
    options,
    primary: PLAN_DINNER,
  }
}

function quietCard(s: HomeCardSnapshot): HomeCard {
  const showTip = s.tipTaps > 0 || dayOfYear(s.now) % 2 === 0
  if (showTip) {
    const tips = tipRotation(s.tip, s.now)
    const text = tips[s.tipTaps % tips.length]
    return {
      kind: 'quiet',
      fingerprint: `quiet:tip:${localDay(s.now)}:${text}`,
      message: `Tip: ${text}`,
      options: [{ label: 'Another tip', action: 'another-tip' }],
      primary: { label: 'Show me how', href: tipChatHref(text) },
    }
  }
  const produce = seasonalProduce(s.now)
  return {
    kind: 'quiet',
    fingerprint: `quiet:season:${localDay(s.now)}:${produce}`,
    message: `In season right now: ${produce}. Want an idea for tonight?`,
    options: [{ label: 'Another tip', action: 'another-tip' }],
    primary: { label: 'Show me how', href: planDinnerHref([produce]) },
  }
}

// ---- the picker -----------------------------------------------------------

/**
 * The card for `snapshot`, or `null` when none applies (only when the quiet moment
 * itself was dismissed). See the module comment for the cases and the two rules.
 */
export function pickHomeCard(snapshot: HomeCardSnapshot): HomeCard | null {
  const today = localDay(snapshot.now)
  const dismissed = new Set(snapshot.dismissed)
  const allowed = (card: HomeCard, capped: boolean): boolean =>
    !dismissed.has(card.fingerprint) && !(capped && snapshot.seen[card.fingerprint] === today)

  const candidates: { build: () => HomeCard | null; capped: boolean }[] = [
    { build: () => (snapshot.cook ? cookCard(snapshot.cook) : null), capped: true },
    { build: () => (snapshot.pending ? scanCard(snapshot.pending) : null), capped: true },
    {
      build: () =>
        snapshot.planned &&
        isPlannedForToday(snapshot.planned, snapshot.now) &&
        snapshot.now.getTime() <= snapshot.planned.serveAtMs + PLANNED_GRACE_MS
          ? plannedCard(snapshot.planned, snapshot.now)
          : null,
      capped: true,
    },
    // First run: an empty pantry beats everything below (food that expires, a
    // mealtime, a tip all make no sense over nothing). Not capped to once a day, so
    // a new user keeps being asked; Not now still sends it away for the day.
    { build: () => (snapshot.pantryCount === 0 ? emptyCard(snapshot.now) : null), capped: false },
    {
      build: () => {
        if (snapshot.expiryPriority === 'off') return null
        const item = urgentItem(snapshot.expiring)
        return item ? expiringCard(item, snapshot.starter) : null
      },
      capped: true,
    },
    {
      build: () => {
        const slot = mealSlot(snapshot.now)
        return slot ? mealtimeCard(slot, snapshot.now, snapshot.starter) : null
      },
      capped: true,
    },
  ]

  for (const { build, capped } of candidates) {
    const card = build()
    if (card && allowed(card, capped)) return card
  }

  // The quiet moment fills every gap and is never capped; only a Not now can hide it.
  const quiet = quietCard(snapshot)
  return allowed(quiet, false) ? quiet : null
}
