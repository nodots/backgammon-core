// Exhaustive scalar corpus and negative fuzzing.
//
// The differential suites prove agreement with gnubg on individual cases. This
// one covers the scalar cross-product — every cube value against every cube
// owner against every turn against every dice value against every rules/match
// configuration — which is where field-order and asymmetry bugs hide.
//
// Both properties tested here fail loudly rather than silently:
//
//   1. Round-trip identity. `format(parse(s)) === s`, character for character.
//      A converter that drops or reorders a field breaks this immediately.
//   2. Nothing misparses quietly. A malformed string must raise XgidError. It
//      must never return a plausible-but-wrong Xgid, and must never escape as a
//      TypeError or RangeError from somewhere deep in the parser.

import {
  emptyXgidBoard,
  formatXgid,
  parseXgid,
  splitXgid,
  Xgid,
  XgidBoard,
  XgidError,
  xgidToPositionId,
} from '../index'

/**
 * Render a board as an XGID position field.
 *
 * Position fields are derived from boards rather than written by hand: the
 * mirroring rule (`board[0][i]` and `board[1][23 - i]` are the same physical
 * point) makes hand-written fields easy to get wrong, and `formatXgid`
 * validates, so anything this returns is legal by construction.
 */
function positionField(board: XgidBoard): string {
  const text = formatXgid(
    {
      board,
      cubeValue: 1,
      cubeOwner: 0,
      turn: 1,
      dice: { kind: 'cube-decision' },
      score: [0, 0],
      matchLength: 0,
      crawford: false,
      jacoby: false,
      beavers: false,
      maxCube: 0,
    },
    'canonical'
  )
  return text.split(':')[0]
}

const openingBoard = (): XgidBoard => {
  const board = emptyXgidBoard()
  for (const side of board) {
    side[5] = 5
    side[7] = 3
    side[12] = 5
    side[23] = 2
  }
  return board
}

/** Both bars loaded: the opening with each side's back checkers sent back. */
const barsLoaded = (): XgidBoard => {
  const board = openingBoard()
  for (const side of board) {
    side[23] = 0
    side[24] = 2
  }
  return board
}

/** Few checkers, so the bitstream is short and the remainder is zero padding. */
const sparse = (): XgidBoard => {
  const board = emptyXgidBoard()
  board[0][0] = 1
  board[0][5] = 3
  board[1][0] = 2
  board[1][24] = 1
  return board
}

/** Position fields spanning empty points, loaded bars and borne-off checkers. */
const BOARDS = [
  positionField(openingBoard()),
  parseXgid('-a-B--E-B-a-dDB--b-bcb----:0:0:1:31:0:0:0:0:0', 'canonical').board,
  emptyXgidBoard(), // every checker borne off, both sides
  barsLoaded(),
  sparse(),
].map((b) => (typeof b === 'string' ? b : positionField(b)))

/** Match configurations: [score0, score1, rules, matchLength]. */
const CONFIGS: Array<[number, number, number, number]> = [
  [0, 0, 0, 0], // money, no rules
  [0, 0, 1, 0], // money, Jacoby
  [0, 0, 2, 0], // money, beavers
  [0, 0, 3, 0], // money, both
  [0, 0, 0, 3], // match, no Crawford
  [2, 5, 0, 7], // match, mid-score
  [6, 2, 1, 7], // match, Crawford game
  [0, 10, 0, 11], // match, long
]

const DICE = ['00', 'D']
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) DICE.push(`${a}${b}`)

describe('exhaustive scalar corpus', () => {
  it('round-trips every scalar combination in the canonical dialect', () => {
    let checked = 0
    let boardIndex = 0
    for (let cubeField = 0; cubeField <= 6; cubeField++) {
      for (const owner of [1, -1, 0]) {
        for (const turn of [1, -1]) {
          for (const dice of DICE) {
            for (const [s0, s1, rules, len] of CONFIGS) {
              // Rotate the board so every board is exercised without
              // multiplying the corpus by five.
              const pos = BOARDS[boardIndex++ % BOARDS.length]
              const text = `${pos}:${cubeField}:${owner}:${turn}:${dice}:${s0}:${s1}:${rules}:${len}:0`
              const parsed = parseXgid(text, 'canonical')
              expect(formatXgid(parsed, 'canonical')).toBe(text)
              expect(parsed.cubeValue).toBe(2 ** cubeField)
              expect(parsed.cubeOwner).toBe(owner)
              expect(parsed.turn).toBe(turn)
              expect(parsed.score).toEqual([s0, s1])
              expect(parsed.matchLength).toBe(len)
              // The overloaded field, asserted against the match length.
              if (len > 0) {
                expect(parsed.crawford).toBe(rules === 1)
                expect(parsed.jacoby).toBe(false)
                expect(parsed.beavers).toBe(false)
              } else {
                expect(parsed.crawford).toBe(false)
                expect(parsed.jacoby).toBe(rules === 1 || rules === 3)
                expect(parsed.beavers).toBe(rules === 2 || rules === 3)
              }
              checked++
            }
          }
        }
      }
    }
    // T5's stated bar for this corpus.
    expect(checked).toBeGreaterThanOrEqual(10000)
  }, 120000)

  it('round-trips the berger dialect wherever it can express the state', () => {
    let checked = 0
    let boardIndex = 0
    for (let cubeField = 0; cubeField <= 6; cubeField++) {
      const cubeValue = 2 ** cubeField
      for (const owner of [1, -1, 0]) {
        for (const turn of [1, -1]) {
          for (const dice of DICE) {
            // Draft 0.02 has no 'D'.
            if (dice === 'D') continue
            for (const [s0, s1, rules, len] of CONFIGS) {
              const pos = BOARDS[boardIndex++ % BOARDS.length]
              const text = `${pos}:${cubeValue}:${owner}:${turn}:${dice}:${s0}:${s1}:${rules}:${len}`
              const parsed = parseXgid(text, 'berger')
              expect(formatXgid(parsed, 'berger')).toBe(text)
              // Literal, not a logarithm — the difference that silently doubles
              // every cube decision when the dialect is guessed.
              expect(parsed.cubeValue).toBe(cubeValue)
              expect(parsed.maxCube).toBeUndefined()
              checked++
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10000)
  }, 120000)

  it('converts between dialects without losing anything but maxCube', () => {
    let boardIndex = 0
    for (let cubeField = 0; cubeField <= 6; cubeField++) {
      for (const turn of [1, -1]) {
        for (const [s0, s1, rules, len] of CONFIGS) {
          const pos = BOARDS[boardIndex++ % BOARDS.length]
          const canonical = `${pos}:${cubeField}:1:${turn}:31:${s0}:${s1}:${rules}:${len}:8`
          const viaCanonical = parseXgid(canonical, 'canonical')
          const asBerger = formatXgid(viaCanonical, 'berger')
          const viaBerger = parseXgid(asBerger, 'berger')

          const { board: b1, context: c1 } = splitXgid(viaCanonical)
          const { board: b2, context: c2 } = splitXgid(viaBerger)
          expect(b2).toEqual(b1)
          expect({ ...c2, maxCube: undefined }).toEqual({
            ...c1,
            maxCube: undefined,
          })
          // The board survives the trip through a position id too.
          expect(xgidToPositionId(viaBerger)).toBe(xgidToPositionId(viaCanonical))
        }
      }
    }
  }, 60000)

  it('refuses to serialize a pending double into the berger dialect', () => {
    for (const pos of BOARDS) {
      const doubled = parseXgid(`${pos}:0:0:1:D:0:0:0:0:0`, 'canonical')
      expect(doubled.dice).toEqual({ kind: 'doubled' })
      expect(() => formatXgid(doubled, 'berger')).toThrow(XgidError)
    }
  })
})

describe('negative fuzzing', () => {
  // Deterministic PRNG so a failure is reproducible from the seed alone.
  let seed = 0x2545f491
  const rnd = (n: number): number => {
    seed ^= seed << 13
    seed >>>= 0
    seed ^= seed >> 17
    seed ^= seed << 5
    seed >>>= 0
    return seed % n
  }

  const validCanonical = (): string => {
    const pos = BOARDS[rnd(BOARDS.length)]
    const [s0, s1, rules, len] = CONFIGS[rnd(CONFIGS.length)]
    const dice = DICE[rnd(DICE.length)]
    return `${pos}:${rnd(7)}:${[1, -1, 0][rnd(3)]}:${[1, -1][rnd(2)]}:${dice}:${s0}:${s1}:${rules}:${len}:0`
  }

  const MUTATIONS: Array<(s: string) => string> = [
    (s) => s.slice(0, s.lastIndexOf(':')), // drop the last field
    (s) => `${s}:0`, // add a field
    (s) => s.replace(/^.{26}/, (p) => p.slice(1)), // 25-char position
    (s) => s.replace(/^.{26}/, (p) => `${p}-`), // 27-char position
    (s) => s.replace(/^./, 'Z'), // uppercase on the lowercase bar
    (s) => s.replace(/^.{26}/, (p) => `${p.slice(0, 25)}z`), // lowercase on the uppercase bar
    (s) => s.replace(/^.{26}/, (p) => `q${p.slice(1)}`), // >15 checkers on the bar
    (s) => s.replace(/:(\d)(\d):/, ':70:'), // impossible roll
    (s) => s.replace(/^.{26}:/, (p) => `${p}99:`), // absurd cube field
    (s) => s.split(':').slice(0, 3).join(':'), // truncated hard
    (s) => s.replace(/^.{26}/, (p) => `${p.slice(0, 13)}!${p.slice(14)}`), // illegal char
    (s) => '', // empty
  ]

  it('raises XgidError, never a stray runtime error, and never a silent misparse', () => {
    let rejected = 0
    let accepted = 0
    for (let i = 0; i < 4000; i++) {
      const base = validCanonical()
      const mutated = MUTATIONS[i % MUTATIONS.length](base)

      let parsed: Xgid | null = null
      try {
        parsed = parseXgid(mutated, 'canonical')
      } catch (err) {
        // The contract is XgidError specifically. A TypeError or RangeError
        // escaping from inside the parser is a defect even though both are
        // "throwing", because callers cannot distinguish bad input from a bug.
        expect(err).toBeInstanceOf(XgidError)
        rejected++
        continue
      }
      // Some mutations happen to produce a legal string. Accepting one is fine
      // — misreading it is not, so it must still round-trip exactly.
      expect(formatXgid(parsed, 'canonical')).toBe(mutated)
      accepted++
    }
    // Guard against the mutations quietly becoming no-ops.
    expect(rejected).toBeGreaterThan(3000)
    expect(rejected + accepted).toBe(4000)
  }, 60000)

  it('rejects a position id of the wrong shape rather than guessing', () => {
    const bad = ['', 'AQAAAAAAAAAA', 'AQAAAAAAAAAAAAA', '!QAAAAAAAAAAAA', '=QAAAAAAAAAAAA']
    for (const id of bad) {
      expect(() => parseXgid(`${BOARDS[0]}:0:0:1:31:0:0:0:0:0`, 'canonical')).not.toThrow()
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { decodeGnuPositionId } = require('../index')
      expect(() => decodeGnuPositionId(id)).toThrow(XgidError)
    }
  })
})
