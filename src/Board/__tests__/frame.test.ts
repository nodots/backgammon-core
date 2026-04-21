import { describe, expect, it } from '@jest/globals'
import {
  classifyRegion,
  fromGnuFrame,
  opponentOf,
  toGnuFrame,
} from '../frame'

describe('fromGnuFrame / toGnuFrame', () => {
  it('passes through 0 (off) and 25 (bar) regardless of direction', () => {
    for (const dir of ['clockwise', 'counterclockwise'] as const) {
      expect(fromGnuFrame(0, dir)).toBe(0)
      expect(fromGnuFrame(25, dir)).toBe(25)
      expect(toGnuFrame(0, dir)).toBe(0)
      expect(toGnuFrame(25, dir)).toBe(25)
    }
  })

  it('is the identity when on-roll player is clockwise', () => {
    for (let p = 1; p <= 24; p++) {
      expect(fromGnuFrame(p, 'clockwise')).toBe(p)
      expect(toGnuFrame(p, 'clockwise')).toBe(p)
    }
  })

  it('flips point numbers (p ↔ 25 - p) when on-roll is counterclockwise', () => {
    for (let p = 1; p <= 24; p++) {
      expect(fromGnuFrame(p, 'counterclockwise')).toBe(25 - p)
      expect(toGnuFrame(p, 'counterclockwise')).toBe(25 - p)
    }
  })

  it('fromGnuFrame and toGnuFrame are mutual inverses', () => {
    for (const dir of ['clockwise', 'counterclockwise'] as const) {
      for (let p = 1; p <= 24; p++) {
        expect(toGnuFrame(fromGnuFrame(p, dir), dir)).toBe(p)
        expect(fromGnuFrame(toGnuFrame(p, dir), dir)).toBe(p)
      }
    }
  })
})

describe('classifyRegion', () => {
  const ctx = { direction: 'clockwise' as const }

  it('returns "bar" for 25 and the string "bar"', () => {
    expect(classifyRegion(25, ctx)).toBe('bar')
    expect(classifyRegion('bar', ctx)).toBe('bar')
  })

  it('returns "off" for 0 and the string "off"', () => {
    expect(classifyRegion(0, ctx)).toBe('off')
    expect(classifyRegion('off', ctx)).toBe('off')
  })

  it('classifies 1-3 as bearingOff', () => {
    for (const p of [1, 2, 3]) expect(classifyRegion(p, ctx)).toBe('bearingOff')
  })

  it('classifies 4-6 as homeInner', () => {
    for (const p of [4, 5, 6]) expect(classifyRegion(p, ctx)).toBe('homeInner')
  })

  it('classifies 7-12 as outerBoard', () => {
    for (let p = 7; p <= 12; p++) expect(classifyRegion(p, ctx)).toBe('outerBoard')
  })

  it('classifies 13-18 as opponentOuter', () => {
    for (let p = 13; p <= 18; p++)
      expect(classifyRegion(p, ctx)).toBe('opponentOuter')
  })

  it('classifies 19-21 as opponentInner', () => {
    for (const p of [19, 20, 21])
      expect(classifyRegion(p, ctx)).toBe('opponentInner')
  })

  it('classifies 22-24 as opponentBearing', () => {
    for (const p of [22, 23, 24])
      expect(classifyRegion(p, ctx)).toBe('opponentBearing')
  })

  it('parses numeric strings', () => {
    expect(classifyRegion('5', ctx)).toBe('homeInner')
    expect(classifyRegion('20', ctx)).toBe('opponentInner')
  })

  it('falls back to outerBoard for NaN / out-of-range numerics', () => {
    expect(classifyRegion('abc', ctx)).toBe('outerBoard')
  })

  it('returns the same region regardless of on-roll direction — the arg exists for frame intent, not output', () => {
    for (let p = 1; p <= 24; p++) {
      const cw = classifyRegion(p, { direction: 'clockwise' })
      const ccw = classifyRegion(p, { direction: 'counterclockwise' })
      expect(cw).toBe(ccw)
    }
  })
})

describe('opponentOf', () => {
  it('swaps color and direction', () => {
    expect(
      opponentOf({ color: 'white', direction: 'clockwise' })
    ).toEqual({ color: 'black', direction: 'counterclockwise' })
    expect(
      opponentOf({ color: 'black', direction: 'counterclockwise' })
    ).toEqual({ color: 'white', direction: 'clockwise' })
    expect(
      opponentOf({ color: 'white', direction: 'counterclockwise' })
    ).toEqual({ color: 'black', direction: 'clockwise' })
  })
})
