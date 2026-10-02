/**
 * Opt-in finish alerts for a cooking timer (issue #848): a short WebAudio chime
 * that repeats up to three times until the timer is dismissed, and a system
 * Notification where permission is granted. Both are off unless the user turns
 * on "Timer sound" in Profile (`isTimerSoundEnabled`); the dock checks it. (Vibration
 * stays in `TimerDock` and is unchanged.)
 *
 * Everything here is best effort and swallows its own failures: no WebAudio, a
 * suspended audio context, no Notification API, or a browser that refuses
 * `new Notification` (Android Chrome wants a service worker) must never break
 * the dock. There is no service worker, so no push notifications: a
 * notification only fires while the page is alive.
 *
 * Browsers only let audio start from a user gesture. `unlockAudio` is called
 * when the toggle is turned on (a tap) to create and resume the context early,
 * so the chime can play later with no gesture.
 */

/** How many times a finished timer chimes if nobody dismisses it. */
export const CHIME_REPEATS = 3
/** Gap between repeats, in ms. */
export const CHIME_INTERVAL_MS = 4_000

/**
 * localStorage key of the "Timer sound" preference (Profile). Same place the
 * theme and the other client-side preferences live. Absent means off.
 */
export const TIMER_SOUND_KEY = 'bubblychef:timer-sound'

/** Whether the user has turned timer sound on. Off unless explicitly enabled. */
export function isTimerSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(TIMER_SOUND_KEY) === 'on'
  } catch {
    return false
  }
}

const TIMER_SOUND_CHANGED_EVENT = 'bubblychef:timer-sound-changed'

export function setTimerSoundEnabled(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(TIMER_SOUND_KEY, 'on')
    else window.localStorage.removeItem(TIMER_SOUND_KEY)
  } catch {
    // Storage unavailable: the choice just does not stick.
  }
  window.dispatchEvent(new Event(TIMER_SOUND_CHANGED_EVENT))
}

/** Follow the preference: this tab's changes and other tabs' (`storage`). */
export function subscribeTimerSound(onChange: () => void): () => void {
  window.addEventListener(TIMER_SOUND_CHANGED_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(TIMER_SOUND_CHANGED_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

type AudioContextCtor = new () => AudioContext

// One context for the page's lifetime (browsers cap how many may exist). Keyed by
// the constructor it was built from, so a changed global rebuilds it.
let audioContext: AudioContext | null = null
let audioContextCtor: AudioContextCtor | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  if (!Ctor) return null
  if (audioContext && audioContextCtor === Ctor) return audioContext
  try {
    audioContext = new Ctor()
    audioContextCtor = Ctor
  } catch {
    audioContext = null
    audioContextCtor = null
  }
  return audioContext
}

/** Create and resume the audio context. Call from a user gesture (a timer start). */
export function unlockAudio(): void {
  const ctx = getAudioContext()
  if (!ctx) return
  try {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  } catch {
    // Best effort only.
  }
}

/** One note: a soft sine with a quick attack and a fast decay. */
function playNote(ctx: AudioContext, frequency: number, startAt: number, length: number): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(frequency, startAt)
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.linearRampToValueAtTime(0.25, startAt + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + length)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(startAt)
  osc.stop(startAt + length + 0.05)
}

/** A two-note "ding-dong", about half a second. */
function playChime(): void {
  const ctx = getAudioContext()
  if (!ctx) return
  try {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    const t = ctx.currentTime
    playNote(ctx, 880, t, 0.28)
    playNote(ctx, 1174.66, t + 0.22, 0.4)
  } catch {
    // Best effort only.
  }
}

/**
 * Chime now, then repeat every `CHIME_INTERVAL_MS` until `CHIME_REPEATS` have
 * played. Returns a function that stops any repeats still waiting.
 */
export function startChime(): () => void {
  let played = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const tick = () => {
    playChime()
    played += 1
    if (played < CHIME_REPEATS) timer = setTimeout(tick, CHIME_INTERVAL_MS)
    else timer = null
  }
  tick()
  return () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    played = CHIME_REPEATS
  }
}

// ---- system notifications ---------------------------------------------------

function notificationApi(): typeof Notification | null {
  if (typeof window === 'undefined') return null
  const N = (window as unknown as { Notification?: typeof Notification }).Notification
  return N ?? null
}

/** A system notification for a finished timer, only where permission is granted. */
export function notifyTimerDone(label: string): void {
  const N = notificationApi()
  if (!N || N.permission !== 'granted') return
  try {
    new N(`${label} is done`, { body: 'Your timer finished.', tag: `bubblychef-timer-${label}` })
  } catch {
    // Some mobile browsers refuse the constructor; nothing else to do.
  }
}

/**
 * Ask the browser for notification permission, only if it has not decided yet
 * (never re-asks after a denial). Call from a tap: the "Timer sound" toggle
 * being turned on is the only caller. Resolves quietly on any failure.
 */
export async function requestNotificationPermission(): Promise<void> {
  const N = notificationApi()
  if (!N || N.permission !== 'default') return
  try {
    await N.requestPermission()
  } catch {
    // Declined or unsupported: fine.
  }
}
