/**
 * Case 5 of the Bubbles card (issue #755): what Bubbles says at a quiet moment.
 * A tip, alternating by day with a seasonal idea.
 *
 * Static and pure: no clock read (`now` is injected), nothing fetched. The daily
 * tip itself comes from `GET /v1/dashboard/daily`; the tips below are what shows
 * when that cannot be reached, and what "Another tip" steps through after it.
 */

// Client-side fallback only: used when the daily-tip request can't complete at all
// (network error, proxy 401). The backend keeps its own list for when it cannot
// reach an AI provider (`ai-service/bubbly_chef/services/dashboard_service.py`);
// this one exists so the card never shows a blank tip.
export const FALLBACK_TIPS = [
  'Season your pan, not just your food!',
  'Let meat rest after cooking — way more tender.',
  'Freeze herbs in olive oil ice cubes!',
  'Toast spices in a dry pan for 30 seconds.',
  'Pasta water makes sauces silky.',
  'Green onions regrow in a glass of water.',
  'Taste as you cook — adjust seasoning throughout.',
] as const

/**
 * Produce in season, by month (0 = January), for a general temperate northern
 * kitchen. Three or more a month; the day of the month picks one.
 */
export const SEASONAL_IDEAS: readonly (readonly string[])[] = [
  ['citrus', 'kale', 'leeks'],
  ['blood oranges', 'cabbage', 'parsnips'],
  ['asparagus', 'spinach', 'radishes'],
  ['asparagus', 'peas', 'rhubarb'],
  ['strawberries', 'new potatoes', 'lettuce'],
  ['cherries', 'zucchini', 'peas'],
  ['peaches', 'tomatoes', 'corn'],
  ['tomatoes', 'eggplant', 'berries'],
  ['apples', 'pears', 'figs'],
  ['pumpkin', 'apples', 'brussels sprouts'],
  ['sweet potatoes', 'cranberries', 'squash'],
  ['clementines', 'beets', 'carrots'],
]

/** A day's seasonal pick: the month's list, indexed by the day of the month. */
export function seasonalProduce(now: Date): string {
  const list = SEASONAL_IDEAS[now.getMonth()]
  return list[(now.getDate() - 1) % list.length]
}

/** 1 on 1 January; the alternation between a tip and a seasonal idea turns on its parity. */
export function dayOfYear(now: Date): number {
  const start = new Date(now.getFullYear(), 0, 0)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((today.getTime() - start.getTime()) / 86_400_000)
}

/**
 * The tips "Another tip" steps through: today's tip first, then the fallbacks
 * (without repeating it). With no daily tip to hand, a fallback picked by day leads.
 */
export function tipRotation(dailyTip: string | null, now: Date): string[] {
  const lead =
    dailyTip?.trim() || FALLBACK_TIPS[(dayOfYear(now) - 1) % FALLBACK_TIPS.length]
  return [lead, ...FALLBACK_TIPS.filter((t) => t !== lead)]
}
