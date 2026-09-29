/**
 * Issue #649 — a tiny deterministic PRNG for property tests over randomly
 * generated (but seeded, hence reproducible) dish sets. No new dependency:
 * mulberry32 is ~5 lines and good enough for test-fixture generation. Never
 * used by production code — the scheduler itself takes no randomness.
 */

/** Returns a `() => number` in `[0, 1)`, deterministic for a given `seed`. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Random integer in `[min, max]` inclusive, drawn from `rng`. */
export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/** Picks one element of `arr` using `rng`. */
export function randChoice<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}
