/**
 * Kitchen theme config (issue #523).
 *
 * Themes are the "big" milestones — a whole new look for the kitchen scene,
 * unlocked well above the decoration milestones in `lib/kitchen/milestones.ts`
 * (#522, thresholds up to 300) so a theme reads as a rarer, bigger moment
 * than picking a new mug for the shelf. Like those thresholds, these are
 * provisional starting points (v1 friend-ready PRD, open question 1: "tune
 * once it's playable"), kept in this one exported array so retuning later is
 * a data change here, not a change to any caller that walks it.
 *
 * Keys match the art prompt pack (`art/kitchen/PROMPTS.md` on branch
 * `art/v1-assets`, issue #527): `pastel`, `cozy_cottage`, `night_kitchen`,
 * `seasonal`. `background` is a CSS gradient placeholder today, built from
 * that pack's per-theme palette notes; it can point at
 * `/kitchen/themes/<key>.png` once the real art lands without changing this
 * module's shape.
 *
 * Unlocks are derived from the lifetime bubbles balance (#520) — no table,
 * no migration (`unlockedThemes`/`isThemeUnlocked`). The *selected* theme is
 * the only persisted bit, and it lives in Supabase auth
 * `user_metadata.kitchen_theme` (see `useKitchenTheme` in
 * `hooks/useKitchenTheme.ts`), the same place the editable display name
 * lives (`user_metadata.username`, read in `app/page.tsx`) — this works for
 * guests too, who have no `user_profiles` row.
 */

export interface KitchenTheme {
  key: string
  name: string
  /** Lifetime bubbles balance required to unlock this theme. 0 = always unlocked. */
  threshold: number
  /**
   * CSS `background` value for the scene box. Today a gradient built from
   * the art pack's palette notes; later this can be
   * `url(/kitchen/themes/<key>.png)` without any caller needing to change.
   */
  background: string
  /** Small accent palette, for chrome around the scene (e.g. the picker's swatch). */
  palette: {
    wall: string
    accent: string
  }
  /** Shown in the unlock toast and the picker's locked rows. */
  emoji: string
}

export const KITCHEN_THEMES: KitchenTheme[] = [
  {
    key: 'pastel',
    name: 'Pastel Sanrio',
    threshold: 0,
    background: 'linear-gradient(160deg, #fff9f5 0%, #ffb5c5 55%, #c9b5e8 100%)',
    palette: { wall: '#fff9f5', accent: '#ffb5c5' },
    emoji: '🌸',
  },
  {
    key: 'cozy_cottage',
    name: 'Cozy Cottage',
    threshold: 500,
    background: 'linear-gradient(160deg, #fff3e0 0%, #ffdab3 55%, #ff9aa2 100%)',
    palette: { wall: '#ffdab3', accent: '#ff9aa2' },
    emoji: '🏡',
  },
  {
    key: 'night_kitchen',
    name: 'Night Kitchen',
    threshold: 900,
    background: 'linear-gradient(160deg, #2e2a4a 0%, #4b3f72 55%, #c9b5e8 100%)',
    palette: { wall: '#4b3f72', accent: '#c9b5e8' },
    emoji: '🌙',
  },
  {
    key: 'seasonal',
    name: 'Seasonal (Winter)',
    threshold: 1400,
    background: 'linear-gradient(160deg, #ffffff 0%, #a8d8f0 55%, #c9b5e8 100%)',
    palette: { wall: '#a8d8f0', accent: '#c9b5e8' },
    emoji: '❄️',
  },
]

export const DEFAULT_KITCHEN_THEME_KEY = 'pastel'

const THEME_BY_KEY = new Map(KITCHEN_THEMES.map((t) => [t.key, t]))

export function getDefaultKitchenTheme(): KitchenTheme {
  // KITCHEN_THEMES always includes the 'pastel' entry (guarded by
  // kitchen-themes.test.ts) — the `!` reflects that invariant, not an
  // assumption made only here.
  return THEME_BY_KEY.get(DEFAULT_KITCHEN_THEME_KEY)!
}

/** Every theme whose threshold the balance has reached, ascending by threshold. */
export function unlockedThemes(balance: number): KitchenTheme[] {
  return KITCHEN_THEMES.filter((t) => t.threshold <= balance).sort(
    (a, b) => a.threshold - b.threshold,
  )
}

export function isThemeUnlocked(key: string, balance: number): boolean {
  const theme = THEME_BY_KEY.get(key)
  return theme !== undefined && theme.threshold <= balance
}

/**
 * Resolve the theme to actually render: the stored key if it names a real,
 * currently-unlocked theme, else `pastel`. Covers three failure shapes the
 * same way — an unknown key (typo, renamed theme), a theme that exists but
 * isn't unlocked yet at this balance (stale pick from before a balance drop
 * isn't a real scenario today, but a locked key must never render), and a
 * missing/`null`/`undefined` stored value (new user, guest, never picked).
 */
export function resolveKitchenTheme(
  storedKey: string | null | undefined,
  balance: number,
): KitchenTheme {
  if (storedKey) {
    const theme = THEME_BY_KEY.get(storedKey)
    if (theme && isThemeUnlocked(theme.key, balance)) return theme
  }
  return getDefaultKitchenTheme()
}

/**
 * Resolve the theme to render on first paint, before the balance is known
 * (#523 review, finding 2): `balance` is `null` until `/api/bubbles`
 * resolves client-side, and the plain `resolveKitchenTheme(storedKey, 0)`
 * treats that as "no bubbles yet", flashing every non-default stored theme
 * to `pastel` for a beat before crossfading to the real pick.
 *
 * `selectTheme` (in `useKitchenTheme`) only ever persists a key that was
 * unlocked *at the moment it was written* — the balance is a lifetime total
 * (#520) that only grows, so a previously-valid pick can't become invalid
 * later. That means the stored key can be trusted immediately, with no
 * balance to check against yet: a known key renders as itself while
 * `balance` is still `null`, an unknown one falls back to `pastel`. Once the
 * balance actually resolves, callers should switch to `resolveKitchenTheme`
 * for the fully-validated result (belt-and-braces against a stale key from
 * a catalog change, not because the balance is expected to disagree).
 */
export function resolveKitchenThemeOptimistic(
  storedKey: string | null | undefined,
  balance: number | null,
): KitchenTheme {
  if (storedKey) {
    const theme = THEME_BY_KEY.get(storedKey)
    if (theme) {
      if (balance === null) return theme
      if (isThemeUnlocked(theme.key, balance)) return theme
    }
  }
  return getDefaultKitchenTheme()
}
