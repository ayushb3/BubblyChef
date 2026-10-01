/**
 * The Bubbles card's seen and dismissed records (issue #755), device-local.
 * Storage and the clock are injected; reads are defensive.
 */
import {
  HOME_CARD_KEY,
  dismissNudge,
  localDay,
  markNudgeSeen,
  readHomeCardRecords,
} from '@/lib/kitchen/home-card-store'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => Array.from(data.keys())[i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

const at = (h: number, day = 1) => new Date(2026, 9, day, h, 0)

describe('localDay', () => {
  it('is the local calendar day, zero-padded', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(localDay(new Date(2026, 9, 1, 0, 1))).toBe('2026-10-01')
  })
})

describe('seen', () => {
  it('records the day a fingerprint was first shown', () => {
    const s = memoryStorage()
    markNudgeSeen('cook:recipe:r:4', at(18), s)
    expect(readHomeCardRecords(s).seen).toEqual({ 'cook:recipe:r:4': '2026-10-01' })
  })

  it('keeps the first day when it is shown again', () => {
    const s = memoryStorage()
    markNudgeSeen('a', at(9), s)
    markNudgeSeen('a', at(20), s)
    expect(readHomeCardRecords(s).seen).toEqual({ a: '2026-10-01' })
  })

  it('forgets earlier days, which no longer cap anything', () => {
    const s = memoryStorage()
    markNudgeSeen('old', at(9, 1), s)
    markNudgeSeen('new', at(9, 2), s)
    expect(readHomeCardRecords(s).seen).toEqual({ new: '2026-10-02' })
  })
})

describe('dismissed', () => {
  it('records a dismissed fingerprint once', () => {
    const s = memoryStorage()
    dismissNudge('scan:x', s)
    dismissNudge('scan:x', s)
    expect(readHomeCardRecords(s).dismissed).toEqual(['scan:x'])
  })

  it('stays across days', () => {
    const s = memoryStorage()
    dismissNudge('scan:x', s)
    markNudgeSeen('other', at(9, 5), s)
    expect(readHomeCardRecords(s).dismissed).toEqual(['scan:x'])
  })

  it('is bounded: the oldest are dropped first', () => {
    const s = memoryStorage()
    for (let i = 0; i < 80; i++) dismissNudge(`n${i}`, s)
    const { dismissed } = readHomeCardRecords(s)
    expect(dismissed.length).toBeLessThanOrEqual(50)
    expect(dismissed).toContain('n79')
    expect(dismissed).not.toContain('n0')
  })
})

describe('defensive reads', () => {
  it.each([
    ['nothing stored', undefined],
    ['junk', 'not json'],
    ['an array', '[]'],
    ['another version', JSON.stringify({ v: 9, seen: { a: '2026-10-01' }, dismissed: ['b'] })],
  ])('reads %s as empty records', (_label, raw) => {
    const s = memoryStorage(raw === undefined ? {} : { [HOME_CARD_KEY]: raw })
    expect(readHomeCardRecords(s)).toEqual({ seen: {}, dismissed: [] })
  })

  it('keeps only well-formed entries', () => {
    const s = memoryStorage({
      [HOME_CARD_KEY]: JSON.stringify({
        v: 1,
        seen: { good: '2026-10-01', bad: 5, worse: null },
        dismissed: ['ok', 7, null],
      }),
    })
    expect(readHomeCardRecords(s)).toEqual({ seen: { good: '2026-10-01' }, dismissed: ['ok'] })
  })

  it('never throws when storage does', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
    } as unknown as Storage
    expect(readHomeCardRecords(broken)).toEqual({ seen: {}, dismissed: [] })
    expect(() => markNudgeSeen('a', at(9), broken)).not.toThrow()
    expect(() => dismissNudge('a', broken)).not.toThrow()
  })

  it('reads nothing with no storage at all', () => {
    expect(readHomeCardRecords(null)).toEqual({ seen: {}, dismissed: [] })
  })
})
