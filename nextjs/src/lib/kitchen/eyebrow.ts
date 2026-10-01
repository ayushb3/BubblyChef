/**
 * The kitchen header's eyebrow: "<Weekday> <part of day>" (issue #748), e.g.
 * "Tuesday evening". Pure, with the clock injected, so the header can render a
 * neutral value on the server and the first client pass and correct it after
 * hydration (the greeting's old `clockReady` pattern) without a mismatch.
 */
export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

/** Morning 05-12, afternoon 12-17, evening 17-21, night 21-05 (local hour). */
export function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 21) return 'evening'
  return 'night'
}

export function kitchenEyebrow(now: Date): string {
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  return `${weekday} ${partOfDay(now.getHours())}`
}
