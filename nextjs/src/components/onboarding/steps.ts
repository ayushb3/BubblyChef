export interface TourStep {
  /** Matches the `data-tour` attribute on the target element. */
  id: string
  /** Accessible selector used by `document.querySelector`. */
  selector: string
  /** Short coach-mark copy shown in the tooltip. */
  copy: string
  /**
   * Where to place the tooltip relative to the spotlight.
   * 'below' = tooltip appears under the target (headers/hero).
   * 'above' = tooltip appears above the target (bottom-nav items).
   */
  placement: 'above' | 'below'
}

// Bottom-nav steps follow the nav's left-to-right order (Pantry, Chat, Recipes).
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'hero',
    selector: '[data-tour="hero"]',
    copy: "Hi! I'm Bubbles, your kitchen assistant.",
    placement: 'below',
  },
  {
    id: 'quick-actions',
    selector: '[data-tour="quick-actions"]',
    copy: 'Quick actions: see what to use soon, scan a receipt, or ask me anything.',
    placement: 'below',
  },
  {
    id: 'nav-pantry',
    selector: '[data-tour="nav-pantry"]',
    copy: 'Your pantry lives here — tap + Add Item inside it to scan a receipt.',
    placement: 'above',
  },
  {
    id: 'nav-chat',
    selector: '[data-tour="nav-chat"]',
    copy: 'Ask me anything about cooking, anytime.',
    placement: 'above',
  },
  {
    id: 'nav-recipes',
    selector: '[data-tour="nav-recipes"]',
    copy: 'Browse and save recipes here.',
    placement: 'above',
  },
  {
    id: 'profile',
    selector: '[data-tour="profile"]',
    copy: 'Your profile and settings — re-take this tour here whenever you like.',
    placement: 'below',
  },
]
