/**
 * The pixel Bubbles sprite (issue #752): 16 x 18, drawn to the turnaround on the
 * "Bubbles · spots and moves" board, in four poses.
 */
import {
  BUBBLES_H,
  BUBBLES_POSES,
  BUBBLES_W,
  bubblesParts,
  squash,
  type BubblesPose,
  type SpritePart,
} from '@/lib/kitchen/bubbles-art'

const POSES: BubblesPose[] = ['front', 'threeQuarter', 'side', 'back']

function pixels(parts: readonly SpritePart[]): Map<string, string> {
  const grid = new Map<string, string>()
  for (const [fill, rects] of parts) {
    for (const r of rects.split(' ')) {
      const [x, y, w, h] = r.split(',').map(Number)
      for (let i = 0; i < w; i++)
        for (let j = 0; j < h; j++) {
          const key = `${x + i},${y + j}`
          // no two rects may paint the same pixel: frames are built by moving pixels
          expect([key, grid.has(key)]).toEqual([key, false])
          grid.set(key, fill)
        }
    }
  }
  return grid
}

describe('Bubbles sprite (#752)', () => {
  it('has the four poses of the turnaround', () => {
    expect(Object.keys(BUBBLES_POSES).sort()).toEqual([...POSES].sort())
  })

  it('is 16 x 18 and every pose fills the width and the height', () => {
    expect([BUBBLES_W, BUBBLES_H]).toEqual([16, 18])
    for (const pose of POSES) {
      const grid = pixels(BUBBLES_POSES[pose])
      const xs = [...grid.keys()].map((k) => Number(k.split(',')[0]))
      const ys = [...grid.keys()].map((k) => Number(k.split(',')[1]))
      expect([pose, Math.min(...xs), Math.max(...xs)]).toEqual([pose, 0, 15])
      expect([pose, Math.min(...ys), Math.max(...ys)]).toEqual([pose, 0, 17])
    }
  })

  it('is drawn to the turnaround proportions', () => {
    const grid = pixels(BUBBLES_POSES.front)
    const at = (x: number, y: number) => grid.get(`${x},${y}`)
    const HAT_BAND = '#8fbde3'
    const APRON = '#8fbde3'
    const EYE = '#3b2a26'
    // the hat sits over the top of the body: about 1/5 of the height (rows 0-3)
    const hatRows = [...grid].filter(([, f]) => f === '#a9cdea' || f === HAT_BAND).map(([k]) => Number(k.split(',')[1]))
    expect(Math.max(...hatRows.filter((y) => y < 6))).toBeLessThanOrEqual(3)
    // the eyes sit on the centreline of the body (the body spans rows 4-15)
    const eyeRows = [...grid].filter(([, f]) => f === EYE).map(([k]) => Number(k.split(',')[1]))
    expect([...new Set(eyeRows)].sort((a, b) => a - b)).toEqual([9, 10])
    // the apron line crosses at about 2/3 of the height (row 12 of 18)
    for (let x = 1; x <= 14; x++) expect(at(x, 12)).toBe(APRON)
    // two small feet: two separate runs of pixels on the bottom row
    const bottom = [...grid.keys()].filter((k) => k.endsWith(',17')).map((k) => Number(k.split(',')[0])).sort((a, b) => a - b)
    expect(bottom).toEqual([3, 4, 11, 12])
  })

  it('shows one eye from the side and none from the back, with the apron knot behind', () => {
    const eyes = (pose: BubblesPose) =>
      [...pixels(BUBBLES_POSES[pose])].filter(([, f]) => f === '#3b2a26').length
    expect(eyes('front')).toBe(4)
    expect(eyes('threeQuarter')).toBe(4)
    expect(eyes('side')).toBe(2)
    expect(eyes('back')).toBe(0)
    expect([...pixels(BUBBLES_POSES.back).values()]).toContain('#6f9fcc') // the knot
  })

  it('squashes by moving the body down one pixel and covering the top of the feet', () => {
    for (const pose of POSES) {
      const base = pixels(BUBBLES_POSES[pose])
      const squashed = pixels(squash(BUBBLES_POSES[pose]))
      // the hat's first row is now row 1
      expect(squashed.get('5,0')).toBeUndefined()
      expect(squashed.get('5,1')).toBe(base.get('5,0'))
      // nothing leaves the sprite box
      for (const k of squashed.keys()) expect(Number(k.split(',')[1])).toBeLessThanOrEqual(17)
    }
  })

  it('has a passing walk frame with the feet together, and no other pixel changed', () => {
    const base = pixels(BUBBLES_POSES.side)
    const passing = pixels(bubblesParts('side', 'passing'))
    for (const [k, fill] of base) {
      if (Number(k.split(',')[1]) <= 15) expect([k, passing.get(k)]).toEqual([k, fill])
    }
    expect([...passing.keys()].filter((k) => Number(k.split(',')[1]) >= 16).length).toBeLessThan(
      [...base.keys()].filter((k) => Number(k.split(',')[1]) >= 16).length,
    )
  })

  it('is the same sprite, base variant, when asked for no variant', () => {
    expect(bubblesParts('front')).toBe(BUBBLES_POSES.front)
  })
})
