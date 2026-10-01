/**
 * Tonight's planned meal (issue #755): a device-local record written when a saved
 * meal is set to Serve at today. Storage is injected; reads are defensive.
 */
import {
  PLANNED_TONIGHT_KEY,
  clearPlannedTonight,
  isPlannedForToday,
  movePlannedToTomorrow,
  parsePlannedTonight,
  readPlannedTonight,
  resolveServeAtDate,
  savePlannedTonight,
  type PlannedTonight,
} from '@/lib/kitchen/planned-tonight'
import { endMealCookSession } from '@/lib/meal-cook-session'

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

const at = (h: number, m = 0, day = 1) => new Date(2026, 9, day, h, m)

const RECORD: PlannedTonight = {
  v: 1,
  mealId: 'm-1',
  title: 'Pasta night',
  servings: 2,
  serveAtMs: at(19, 0).getTime(),
  startAtMs: at(18, 15).getTime(),
  startDish: 'Rice',
}

describe('save and read', () => {
  it('round-trips a record', () => {
    const s = memoryStorage()
    savePlannedTonight(RECORD, s)
    expect(readPlannedTonight(s)).toEqual(RECORD)
  })

  it('keeps one record: a newer one replaces it', () => {
    const s = memoryStorage()
    savePlannedTonight(RECORD, s)
    savePlannedTonight({ ...RECORD, mealId: 'm-2' }, s)
    expect(readPlannedTonight(s)?.mealId).toBe('m-2')
  })

  it.each([
    ['nothing stored', null],
    ['junk', 'not json'],
    ['an array', '[]'],
    ['another version', JSON.stringify({ ...RECORD, v: 2 })],
    ['no meal id', JSON.stringify({ ...RECORD, mealId: '' })],
    ['a serve time that is not a number', JSON.stringify({ ...RECORD, serveAtMs: 'soon' })],
    ['a serve time that is not finite', '{"v":1,"mealId":"m","title":"t","servings":2,"serveAtMs":1e999,"startAtMs":1}'],
  ])('reads %s as no record', (_label, raw) => {
    expect(parsePlannedTonight(raw)).toBeNull()
  })

  it('repairs what it can: a missing title, servings or start dish', () => {
    const raw = JSON.stringify({ v: 1, mealId: 'm-1', serveAtMs: RECORD.serveAtMs, startAtMs: RECORD.startAtMs })
    expect(parsePlannedTonight(raw)).toEqual({ ...RECORD, title: '', servings: 2, startDish: null })
  })

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(readPlannedTonight(broken)).toBeNull()
    expect(() => savePlannedTonight(RECORD, broken)).not.toThrow()
    expect(() => clearPlannedTonight(undefined, broken)).not.toThrow()
  })
})

describe('clear', () => {
  it('clears the record', () => {
    const s = memoryStorage()
    savePlannedTonight(RECORD, s)
    clearPlannedTonight(undefined, s)
    expect(s.getItem(PLANNED_TONIGHT_KEY)).toBeNull()
  })

  it("only clears the named meal's record", () => {
    const s = memoryStorage()
    savePlannedTonight(RECORD, s)
    clearPlannedTonight('another-meal', s)
    expect(readPlannedTonight(s)).not.toBeNull()
    clearPlannedTonight('m-1', s)
    expect(readPlannedTonight(s)).toBeNull()
  })
})

describe('move it to tomorrow', () => {
  it('shifts the serve and start times by a calendar day', () => {
    const s = memoryStorage()
    savePlannedTonight(RECORD, s)
    const moved = movePlannedToTomorrow(s)!
    expect(moved.serveAtMs).toBe(at(19, 0, 2).getTime())
    expect(moved.startAtMs).toBe(at(18, 15, 2).getTime())
    expect(readPlannedTonight(s)).toEqual(moved)
  })

  it('makes it stop being for today', () => {
    const s = memoryStorage()
    savePlannedTonight(RECORD, s)
    expect(isPlannedForToday(readPlannedTonight(s)!, at(15, 0))).toBe(true)
    expect(isPlannedForToday(movePlannedToTomorrow(s)!, at(15, 0))).toBe(false)
  })

  it('does nothing when there is no record', () => {
    expect(movePlannedToTomorrow(memoryStorage())).toBeNull()
  })

  it('keeps the wall-clock time across a month end', () => {
    const s = memoryStorage()
    const lastDay = {
      ...RECORD,
      serveAtMs: new Date(2026, 9, 31, 19, 0).getTime(),
      startAtMs: new Date(2026, 9, 31, 18, 15).getTime(),
    }
    savePlannedTonight(lastDay, s)
    expect(movePlannedToTomorrow(s)!.serveAtMs).toBe(new Date(2026, 10, 1, 19, 0).getTime())
  })
})

describe('isPlannedForToday', () => {
  it('is today by the local calendar', () => {
    expect(isPlannedForToday(RECORD, at(0, 5))).toBe(true)
    expect(isPlannedForToday(RECORD, at(23, 59))).toBe(true)
    expect(isPlannedForToday(RECORD, at(10, 0, 2))).toBe(false)
  })
})

describe('resolveServeAtDate', () => {
  it('a time later today is today', () => {
    expect(resolveServeAtDate('19:00', at(15, 0))).toEqual(at(19, 0))
  })

  it('a time earlier than now is tomorrow', () => {
    expect(resolveServeAtDate('06:00', at(15, 0))).toEqual(at(6, 0, 2))
  })

  it('the same minute stays today', () => {
    expect(resolveServeAtDate('15:00', new Date(2026, 9, 1, 15, 0, 30))).toEqual(at(15, 0))
  })

  it('an emptied or malformed input has no time', () => {
    expect(resolveServeAtDate('', at(15, 0))).toBeUndefined()
    expect(resolveServeAtDate('abc', at(15, 0))).toBeUndefined()
  })
})

describe('finishing the cook ends the plan', () => {
  // Real module, real localStorage (jsdom): the plan is device-local state.
  beforeEach(() => window.localStorage.clear())

  it("ending that meal's cook drops its plan", () => {
    savePlannedTonight(RECORD)
    endMealCookSession('m-1')
    expect(readPlannedTonight()).toBeNull()
  })

  it("ending another meal's cook leaves the plan", () => {
    savePlannedTonight(RECORD)
    endMealCookSession('other')
    expect(readPlannedTonight()?.mealId).toBe('m-1')
  })
})
