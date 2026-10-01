/**
 * Where the pixel Bubbles stands, and how it walks there (issue #752): the pure
 * spot picker (door > cooking stove > fridge > resting stove), the cook-session
 * read, the scripted stepped walk, and that no frame of any walk touches a place's
 * label or tap target.
 */
import { PLACE_BOXES, PLACE_CONTENT, TAG_UNITS } from '@/components/kitchen/KitchenWall'
import { WALL_W } from '@/lib/kitchen/slots'
import { emptyPlaceSummaries, summarizePlaces } from '@/lib/kitchen/places'
import { BUBBLES_H, BUBBLES_W } from '@/lib/kitchen/bubbles-art'
import {
  BUBBLES_SPOTS,
  BUBBLES_Y,
  SPOT_X,
  WALK_STEP_UNITS,
  hasWilting,
  isCookingNow,
  pickBubblesSpot,
  planWalk,
  restFrame,
  type BubblesSpot,
} from '@/lib/kitchen/bubbles-spot'
import { startGuidedCookSession, endCookSession } from '@/lib/cook-session'
import { startMealCookSession, endMealCookSession } from '@/lib/meal-cook-session'

describe('pickBubblesSpot (#752)', () => {
  // Every combination of the three signals, so a precedence regression names itself.
  const cases: Array<[scanOpen: boolean, cooking: boolean, wilting: boolean, spot: BubblesSpot]> = [
    // door while a scan or put-away is open, whatever else is going on
    [true, true, true, 'door'],
    [true, true, false, 'door'],
    [true, false, true, 'door'],
    [true, false, false, 'door'],
    // then the stove while any cook session is active, even with food wilting
    [false, true, true, 'stove'],
    [false, true, false, 'stove'],
    // then the fridge when the wilting set is not empty
    [false, false, true, 'fridge'],
    // otherwise the resting spot, the stove
    [false, false, false, 'stove'],
  ]
  it.each(cases)('scanOpen=%s cooking=%s wilting=%s -> %s', (scanOpen, cooking, wilting, spot) => {
    expect(pickBubblesSpot({ scanOpen, cooking, wilting })).toBe(spot)
  })

  it('covers all eight combinations', () => {
    expect(cases).toHaveLength(8)
    expect(new Set(cases.map(([a, b, c]) => `${a}${b}${c}`)).size).toBe(8)
  })
})

describe('hasWilting (#752)', () => {
  const TODAY = '2026-10-01'

  it('is false while the pantry is unknown (loading or failed), never a made-up "nothing wilting"', () => {
    expect(hasWilting(null)).toBe(false)
  })

  it('is false for an empty or comfortably fresh pantry', () => {
    expect(hasWilting(emptyPlaceSummaries())).toBe(false)
    expect(hasWilting(summarizePlaces([{ location: 'fridge', expiry_date: '2026-12-01' }], TODAY))).toBe(false)
  })

  it('is true when any place has something to use soon, including the freezer and the basket', () => {
    expect(hasWilting(summarizePlaces([{ location: 'fridge', expiry_date: '2026-10-02' }], TODAY))).toBe(true)
    expect(hasWilting(summarizePlaces([{ location: 'counter', expiry_date: '2026-10-03' }], TODAY))).toBe(true)
    // expired counts: it is the most wilted thing there is
    expect(hasWilting(summarizePlaces([{ location: 'pantry', expiry_date: '2026-09-20' }], TODAY))).toBe(true)
  })
})

describe('isCookingNow (#752)', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('is false with nothing in storage', () => {
    expect(isCookingNow()).toBe(false)
  })

  it('is true while a guided recipe cook is active, and false once it has ended', () => {
    startGuidedCookSession('recipe-1')
    expect(isCookingNow()).toBe(true)
    endCookSession('recipe-1')
    expect(isCookingNow()).toBe(false)
  })

  it('is true while a meal cook-along is active, and false once it has ended', () => {
    startMealCookSession('meal-1', ['a', 'b'], Date.now(), ['1:x', '1:y'])
    expect(isCookingNow()).toBe(true)
    endMealCookSession('meal-1')
    expect(isCookingNow()).toBe(false)
  })

  it('is false, not a crash, when storage holds junk', () => {
    window.localStorage.setItem('bubblychef:cook:activeSession', '{not json')
    window.localStorage.setItem('bubblychef:mealcook:activeSession', '42')
    expect(isCookingNow()).toBe(false)
  })

  it('is a read: it never writes or clears a session', () => {
    startGuidedCookSession('recipe-2')
    const before = JSON.stringify({ ...window.localStorage })
    isCookingNow()
    expect(JSON.stringify({ ...window.localStorage })).toBe(before)
  })
})

type Box = readonly [x: number, y: number, w: number, h: number]
const overlaps = (a: Box, b: Box) =>
  a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]

/** Every label (tag) the wall draws, in wall units, as `KitchenWall` places them. */
function tagBoxes(): Array<[string, Box]> {
  const out: Array<[string, Box]> = []
  for (const key of Object.keys(PLACE_BOXES) as Array<keyof typeof PLACE_BOXES>) {
    const { tag, anchorRight } = PLACE_BOXES[key]
    const w = TAG_UNITS.w[key]
    out.push([`${key} tag`, [anchorRight ? tag[0] - w : tag[0], tag[1], w, TAG_UNITS.h]])
  }
  return out
}

describe('the spots (#752)', () => {
  it('are the board’s three: fridge, stove and door, left to right on the floor', () => {
    expect([...BUBBLES_SPOTS]).toEqual(['fridge', 'stove', 'door'])
    expect(SPOT_X.fridge).toBeLessThan(SPOT_X.stove)
    expect(SPOT_X.stove).toBeLessThan(SPOT_X.door)
  })

  it('stand on the floor, inside the wall', () => {
    expect(BUBBLES_Y).toBeGreaterThanOrEqual(56) // the floor starts at row 56
    expect(BUBBLES_Y + BUBBLES_H + 2).toBeLessThanOrEqual(80) // sprite and its shadow
    for (const spot of BUBBLES_SPOTS) {
      expect(SPOT_X[spot]).toBeGreaterThanOrEqual(0)
      expect(SPOT_X[spot] + BUBBLES_W).toBeLessThanOrEqual(WALL_W)
    }
  })
})

describe('no frame covers a label or a tap target (#752)', () => {
  const tags = tagBoxes()
  const targets: Array<[string, Box]> = [
    ...Object.entries(PLACE_BOXES).map(([k, v]) => [`${k} box`, v.box] as [string, Box]),
    ...Object.entries(PLACE_CONTENT).map(([k, v]) => [`${k} art`, v] as [string, Box]),
  ]

  const frames = BUBBLES_SPOTS.flatMap((from) =>
    BUBBLES_SPOTS.flatMap((to) =>
      planWalk(SPOT_X[from], to).map((f) => ({ ...f, label: `${from}->${to}` })),
    ),
  )

  it('walks enough frames to mean something', () => {
    expect(frames.length).toBeGreaterThan(30)
  })

  it('keeps clear of every tag, at rest and on every step of every walk', () => {
    for (const f of frames) {
      const sprite: Box = [f.x, BUBBLES_Y, BUBBLES_W, BUBBLES_H]
      for (const [name, box] of tags) {
        expect([f.label, f.x, name, overlaps(sprite, box)]).toEqual([f.label, f.x, name, false])
      }
    }
  })

  it('keeps clear of every place’s tap box and drawn art too', () => {
    for (const f of frames) {
      const sprite: Box = [f.x, BUBBLES_Y, BUBBLES_W, BUBBLES_H]
      for (const [name, box] of targets) {
        expect([f.label, f.x, name, overlaps(sprite, box)]).toEqual([f.label, f.x, name, false])
      }
    }
  })

  it('never leaves the wall', () => {
    for (const f of frames) {
      expect(f.x).toBeGreaterThanOrEqual(0)
      expect(f.x + BUBBLES_W).toBeLessThanOrEqual(WALL_W)
    }
  })
})

describe('restFrame (#752)', () => {
  it('stands at the spot, facing the room at the stove, the fridge at the fridge and the door at the door', () => {
    expect(restFrame('stove')).toMatchObject({ x: SPOT_X.stove, pose: 'front', flip: false })
    expect(restFrame('fridge')).toMatchObject({ x: SPOT_X.fridge, pose: 'threeQuarter', flip: false })
    expect(restFrame('door')).toMatchObject({ x: SPOT_X.door, pose: 'back', flip: false })
  })
})

describe('planWalk (#752)', () => {
  it('is just the resting frame when already there', () => {
    expect(planWalk(SPOT_X.stove, 'stove')).toEqual([restFrame('stove')])
  })

  it('walks to the right facing right: the side view, mirrored', () => {
    const frames = planWalk(SPOT_X.fridge, 'door')
    const walking = frames.filter((f) => f.pose === 'side')
    expect(walking.length).toBeGreaterThan(5)
    expect(walking.every((f) => f.flip)).toBe(true)
  })

  it('walks to the left facing left: the side view, not mirrored', () => {
    const frames = planWalk(SPOT_X.door, 'fridge')
    const walking = frames.filter((f) => f.pose === 'side')
    expect(walking.length).toBeGreaterThan(5)
    expect(walking.every((f) => !f.flip)).toBe(true)
  })

  it('turns three-quarter before it sets off and settles into the spot’s own pose', () => {
    const frames = planWalk(SPOT_X.fridge, 'stove')
    expect(frames[0]).toMatchObject({ x: SPOT_X.fridge, pose: 'threeQuarter', flip: true })
    expect(frames[frames.length - 1]).toEqual(restFrame('stove'))
  })

  it('moves along the floor only, in whole steps no bigger than one stepped frame', () => {
    const frames = planWalk(SPOT_X.fridge, 'door')
    let last = frames[0].x
    for (const f of frames) {
      expect(Math.abs(f.x - last)).toBeLessThanOrEqual(WALK_STEP_UNITS)
      last = f.x
    }
    expect(frames[frames.length - 1].x).toBe(SPOT_X.door)
  })

  it('never moves backwards on the way', () => {
    const xs = planWalk(SPOT_X.fridge, 'door').map((f) => f.x)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
    const back = planWalk(SPOT_X.door, 'fridge').map((f) => f.x)
    expect([...back].sort((a, b) => b - a)).toEqual(back)
  })

  it('alternates two foot frames, so the walk has a gait', () => {
    const variants = planWalk(SPOT_X.fridge, 'door')
      .filter((f) => f.pose === 'side')
      .map((f) => f.variant)
    expect(new Set(variants)).toEqual(new Set(['squash', 'passing']))
    for (let i = 1; i < variants.length; i++) expect(variants[i]).not.toBe(variants[i - 1])
  })

  it('takes a longer walk for a longer way', () => {
    const short = planWalk(SPOT_X.fridge, 'stove').length
    const long = planWalk(SPOT_X.fridge, 'door').length
    expect(long).toBeGreaterThan(short)
  })

  it('plans from wherever Bubbles is when the target changes mid-walk', () => {
    const frames = planWalk(60, 'fridge')
    expect(frames[0].x).toBe(60)
    expect(frames[frames.length - 1].x).toBe(SPOT_X.fridge)
    expect(frames.filter((f) => f.pose === 'side').every((f) => !f.flip)).toBe(true)
  })
})
