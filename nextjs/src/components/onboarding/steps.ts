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

// The fridge step points at the kitchen scene (the Pantry tab went, #750). The
// bottom-nav steps follow the nav's left-to-right order (Chat, Recipes).
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'hero',
    selector: '[data-tour="hero"]',
    copy: "Hi! I'm Bubbles, your kitchen assistant.",
    placement: 'below',
  },
  {
    id: 'fridge',
    selector: '[data-tour="fridge"]',
    copy: 'Your food lives in the kitchen — tap the fridge to see what’s inside.',
    placement: 'below',
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
