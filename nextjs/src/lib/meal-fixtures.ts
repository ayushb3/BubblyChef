/**
 * Issue #649 — realistic fixture meals shared by the scheduler's own tests,
 * the timeline table's component tests and the dev-only fixture page
 * (`/meal-timeline-demo`), so all three stay in sync with one definition
 * each. Not used by any production code path.
 */

import type { Step } from '@/types/recipes'
import type { SchedulerConstraints, SchedulerDish } from '@/lib/meal-scheduler'

function step(
  overrides: Partial<Step> & {
    text: string
    label: string
    duration_minutes: number
    hands_on: boolean
  },
): Step {
  return {
    ongoing_label: null,
    duration_estimated: false,
    depends_on: [],
    exclusive: [],
    ...overrides,
  }
}

export interface MealFixture {
  slug: string
  title: string
  dishes: SchedulerDish[]
  /** Passed straight to `scheduleMeal` — e.g. the one-pan meal's kitchen limit. */
  constraints?: SchedulerConstraints
}

/** Main: pasta with sauce (two interleaved sub-tracks). Side: a green salad. */
export const PASTA_SAUCE_SALAD: MealFixture = {
  slug: 'pasta-sauce-salad',
  title: 'Pasta with tomato sauce + green salad',
  dishes: [
    {
      dish_id: 'main',
      column: 'main',
      title: 'Pasta with tomato sauce',
      steps: [
        step({ text: 'Start the tomato sauce', label: 'Start the sauce', duration_minutes: 3, hands_on: true }),
        step({
          text: 'Simmer the sauce',
          label: 'Simmer sauce',
          ongoing_label: 'the sauce reduces',
          duration_minutes: 15,
          hands_on: false,
          depends_on: [0],
        }),
        step({ text: 'Add pasta to boiling water', label: 'Boil the pasta', duration_minutes: 1, hands_on: true }),
        step({
          text: 'Cook the pasta',
          label: 'Cook pasta',
          ongoing_label: 'the pasta boils',
          duration_minutes: 10,
          hands_on: false,
          depends_on: [2],
        }),
        step({
          text: 'Toss pasta with sauce',
          label: 'Toss pasta with sauce',
          duration_minutes: 2,
          hands_on: true,
          depends_on: [1, 3],
        }),
      ],
    },
    {
      dish_id: 'salad',
      column: 'side_1',
      title: 'Green salad',
      steps: [
        step({ text: 'Chop vegetables for the salad', label: 'Chop salad veg', duration_minutes: 5, hands_on: true }),
        step({
          text: 'Toss salad with dressing',
          label: 'Toss salad',
          duration_minutes: 2,
          hands_on: true,
          depends_on: [0],
        }),
      ],
    },
  ],
}

/** Main: roast chicken. Two sides: roast potatoes and steamed green beans. */
export const ROAST_TWO_SIDES: MealFixture = {
  slug: 'roast-two-sides',
  title: 'Roast chicken + roast potatoes + green beans',
  dishes: [
    {
      dish_id: 'roast',
      column: 'main',
      title: 'Roast chicken',
      steps: [
        step({ text: 'Season the chicken', label: 'Season chicken', duration_minutes: 5, hands_on: true }),
        step({
          text: 'Roast the chicken',
          label: 'Roast chicken',
          ongoing_label: 'the chicken roasts',
          duration_minutes: 45,
          hands_on: false,
          depends_on: [0],
        }),
        step({
          text: 'Rest the chicken before carving',
          label: 'Rest chicken',
          ongoing_label: 'the chicken rests',
          duration_minutes: 10,
          hands_on: false,
          depends_on: [1],
        }),
        step({
          text: 'Carve the chicken',
          label: 'Carve chicken',
          duration_minutes: 3,
          hands_on: true,
          depends_on: [2],
        }),
      ],
    },
    {
      dish_id: 'potatoes',
      column: 'side_1',
      title: 'Roast potatoes',
      steps: [
        step({
          text: 'Parboil the potatoes',
          label: 'Parboil potatoes',
          ongoing_label: 'the potatoes parboil',
          duration_minutes: 10,
          hands_on: false,
        }),
        step({
          text: 'Toss potatoes in oil',
          label: 'Toss potatoes',
          duration_minutes: 2,
          hands_on: true,
          depends_on: [0],
        }),
        step({
          text: 'Roast the potatoes',
          label: 'Roast potatoes',
          ongoing_label: 'the potatoes roast',
          duration_minutes: 35,
          hands_on: false,
          depends_on: [1],
        }),
      ],
    },
    {
      dish_id: 'greenbeans',
      column: 'side_2',
      title: 'Green beans',
      steps: [
        step({ text: 'Trim the green beans', label: 'Trim beans', duration_minutes: 5, hands_on: true }),
        step({
          text: 'Steam the green beans',
          label: 'Steam beans',
          ongoing_label: 'the beans steam',
          duration_minutes: 6,
          hands_on: false,
          depends_on: [0],
        }),
      ],
    },
  ],
}

/**
 * A one-pan meal. The chicken sear and the covered vegetable braise both use
 * the pan. The braise is hands-off, so without the limit it would overlap the
 * sear; the user's "one pan" (`exclusive_tags: ['pan']`) forces them into
 * sequence.
 */
export const ONE_PAN_MEAL: MealFixture = {
  slug: 'one-pan-meal',
  title: 'Pan-seared chicken + braised vegetables (one pan)',
  constraints: { exclusive_tags: ['pan'] },
  dishes: [
    {
      dish_id: 'chicken',
      column: 'main',
      title: 'Pan-seared chicken',
      steps: [
        step({
          text: 'Sear the chicken in the pan',
          label: 'Sear chicken',
          duration_minutes: 6,
          hands_on: true,
          exclusive: ['pan'],
        }),
        step({
          text: 'Rest the chicken',
          label: 'Rest chicken',
          ongoing_label: 'the chicken rests',
          duration_minutes: 5,
          hands_on: false,
          depends_on: [0],
        }),
      ],
    },
    {
      dish_id: 'veg',
      column: 'side_1',
      title: 'Braised vegetables',
      steps: [
        step({
          text: 'Braise the vegetables in the pan, covered',
          label: 'Braise veg',
          ongoing_label: 'the vegetables braise',
          duration_minutes: 8,
          hands_on: false,
          exclusive: ['pan'],
        }),
      ],
    },
  ],
}

/** A meal with just one side — the finish window can't always be met (steak vs. a long boil). */
export const ONE_SIDE_MEAL: MealFixture = {
  slug: 'one-side-meal',
  title: 'Grilled steak + mashed potatoes',
  dishes: [
    {
      dish_id: 'steak',
      column: 'main',
      title: 'Grilled steak',
      steps: [step({ text: 'Grill the steak', label: 'Grill steak', duration_minutes: 8, hands_on: true })],
    },
    {
      dish_id: 'mash',
      column: 'side_1',
      title: 'Mashed potatoes',
      steps: [
        step({
          text: 'Boil the potatoes',
          label: 'Boil potatoes',
          ongoing_label: 'the potatoes boil',
          duration_minutes: 15,
          hands_on: false,
        }),
        step({
          text: 'Mash the potatoes',
          label: 'Mash potatoes',
          duration_minutes: 3,
          hands_on: true,
          depends_on: [0],
        }),
      ],
    },
  ],
}

export const ALL_MEAL_FIXTURES: MealFixture[] = [
  PASTA_SAUCE_SALAD,
  ROAST_TWO_SIDES,
  ONE_PAN_MEAL,
  ONE_SIDE_MEAL,
]
