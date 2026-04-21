import { describe, expect, it } from '@jest/globals'
import { decodePositionId, type DecodedGnuBoard } from '../decodePositionId'
import { importFromDecoded } from '../importFromDecoded'
import { fromPositionId } from '../fromPositionId'
import type { OnRollContext } from '../frame'

const STARTING_POSITION_ID = '4HPwATDgc/ABMA'

const WHITE_CW: OnRollContext = { color: 'white', direction: 'clockwise' }
const BLACK_CCW: OnRollContext = { color: 'black', direction: 'counterclockwise' }

describe('decodePositionId', () => {
  it('rejects invalid-length ids', () => {
    expect(() => decodePositionId('')).toThrow()
    expect(() => decodePositionId('too-short')).toThrow()
    expect(() => decodePositionId('fifteen-chars-x')).toThrow()
  })

  it('returns two 25-entry arrays for a valid id', () => {
    const decoded = decodePositionId(STARTING_POSITION_ID)
    expect(decoded.opponent).toHaveLength(25)
    expect(decoded.onRoll).toHaveLength(25)
  })

  it('starting position puts 15 checkers on each tan array', () => {
    const decoded = decodePositionId(STARTING_POSITION_ID)
    const total = (arr: number[]) => arr.reduce((s, n) => s + n, 0)
    expect(total(decoded.opponent)).toBe(15)
    expect(total(decoded.onRoll)).toBe(15)
  })

  it('starting position has checker counts at points 6, 8, 13, 24 (2/3/5/5)', () => {
    const decoded = decodePositionId(STARTING_POSITION_ID)
    // Both tan arrays are symmetric at the starting position.
    for (const tan of [decoded.opponent, decoded.onRoll]) {
      expect(tan[5]).toBe(5) // point 6
      expect(tan[7]).toBe(3) // point 8
      expect(tan[12]).toBe(5) // point 13
      expect(tan[23]).toBe(2) // point 24
      expect(tan[24]).toBe(0) // no bar
    }
  })
})

describe('importFromDecoded', () => {
  it('maps decoded.opponent and decoded.onRoll onto the right players', () => {
    const decoded: DecodedGnuBoard = {
      opponent: new Array(25).fill(0),
      onRoll: new Array(25).fill(0),
    }
    decoded.opponent[0] = 1 // opponent at opponent's point 1
    decoded.onRoll[0] = 1 // on-roll at on-roll's point 1
    decoded.opponent[5] = 14
    decoded.onRoll[5] = 14

    const imports = importFromDecoded(decoded, WHITE_CW)
    // On-roll = white/clockwise: onRoll[0] → clockwise 1, color white.
    const onRollFirst = imports.find(
      (cc) =>
        typeof cc.position === 'object' &&
        'clockwise' in cc.position &&
        cc.position.clockwise === 1 &&
        cc.checkers.color === 'white' &&
        cc.checkers.qty === 1
    )
    expect(onRollFirst).toBeDefined()

    // Opponent = black/counterclockwise: opponent[0] at opponent
    // point 1 in counterclockwise direction → counterclockwise 1 =
    // clockwise 24.
    const opponentFirst = imports.find(
      (cc) =>
        typeof cc.position === 'object' &&
        'clockwise' in cc.position &&
        cc.position.clockwise === 24 &&
        cc.checkers.color === 'black' &&
        cc.checkers.qty === 1
    )
    expect(opponentFirst).toBeDefined()
  })

  it('flips placement when on-roll is black/counterclockwise', () => {
    const decoded: DecodedGnuBoard = {
      opponent: new Array(25).fill(0),
      onRoll: new Array(25).fill(0),
    }
    decoded.onRoll[0] = 1 // on-roll at on-roll's point 1
    decoded.opponent[0] = 1 // opponent at opponent's point 1
    decoded.onRoll[5] = 14
    decoded.opponent[5] = 14

    const imports = importFromDecoded(decoded, BLACK_CCW)
    // On-roll = black/counterclockwise: onRoll[0] → counterclockwise 1 = clockwise 24.
    const onRollFirst = imports.find(
      (cc) =>
        typeof cc.position === 'object' &&
        'clockwise' in cc.position &&
        cc.position.clockwise === 24 &&
        cc.checkers.color === 'black' &&
        cc.checkers.qty === 1
    )
    expect(onRollFirst).toBeDefined()

    // Opponent = white/clockwise: opponent[0] → clockwise 1, color white.
    const opponentFirst = imports.find(
      (cc) =>
        typeof cc.position === 'object' &&
        'clockwise' in cc.position &&
        cc.position.clockwise === 1 &&
        cc.checkers.color === 'white' &&
        cc.checkers.qty === 1
    )
    expect(opponentFirst).toBeDefined()
  })

  it('places bar checkers on the correct direction container', () => {
    const decoded: DecodedGnuBoard = {
      opponent: new Array(25).fill(0),
      onRoll: new Array(25).fill(0),
    }
    decoded.onRoll[24] = 2 // on-roll on bar
    decoded.onRoll[5] = 13
    decoded.opponent[5] = 15

    const imports = importFromDecoded(decoded, WHITE_CW)
    const bar = imports.find(
      (cc) => cc.position === 'bar' && 'direction' in cc
    )
    expect(bar).toBeDefined()
    expect(bar && 'direction' in bar && bar.direction).toBe('clockwise')
    expect(bar?.checkers.color).toBe('white')
    expect(bar?.checkers.qty).toBe(2)
  })

  it('emits off containers when a player has borne off', () => {
    const decoded: DecodedGnuBoard = {
      opponent: new Array(25).fill(0),
      onRoll: new Array(25).fill(0),
    }
    decoded.onRoll[5] = 10 // 10 on-roll on point 6 → 5 off
    decoded.opponent[5] = 15 // opponent full on point 6

    const imports = importFromDecoded(decoded, WHITE_CW)
    const off = imports.find(
      (cc) =>
        cc.position === 'off' && 'direction' in cc && cc.direction === 'clockwise'
    )
    expect(off?.checkers.qty).toBe(5)
    expect(off?.checkers.color).toBe('white')
  })
})

describe('fromPositionId', () => {
  it('produces a board with the starting layout for white-on-roll', () => {
    const board = fromPositionId(STARTING_POSITION_ID, WHITE_CW)
    expect(board.points).toHaveLength(24)

    const cw = (i: number) => board.points.find((p) => p.position.clockwise === i)
    // White (on-roll clockwise) has 5/3/5/2 at clockwise 6/8/13/24.
    expect(cw(6)!.checkers.filter((c) => c.color === 'white')).toHaveLength(5)
    expect(cw(8)!.checkers.filter((c) => c.color === 'white')).toHaveLength(3)
    expect(cw(13)!.checkers.filter((c) => c.color === 'white')).toHaveLength(5)
    expect(cw(24)!.checkers.filter((c) => c.color === 'white')).toHaveLength(2)
    // Black (opponent counterclockwise) has 5/3/5/2 at counterclockwise
    // 6/8/13/24, i.e. clockwise 19/17/12/1.
    expect(cw(19)!.checkers.filter((c) => c.color === 'black')).toHaveLength(5)
    expect(cw(17)!.checkers.filter((c) => c.color === 'black')).toHaveLength(3)
    expect(cw(12)!.checkers.filter((c) => c.color === 'black')).toHaveLength(5)
    expect(cw(1)!.checkers.filter((c) => c.color === 'black')).toHaveLength(2)
  })

  it('same id decoded with a different on-roll produces a different physical layout (asymmetry check)', () => {
    // The starting-position id was encoded with white on roll. Decoding
    // with black on roll interprets tan arrays as if black were on roll,
    // which physically reshuffles which clockwise points hold which color.
    const boardWhite = fromPositionId(STARTING_POSITION_ID, WHITE_CW)
    const boardBlack = fromPositionId(STARTING_POSITION_ID, BLACK_CCW)

    const cw = (board: typeof boardWhite, i: number) =>
      board.points.find((p) => p.position.clockwise === i)!
    // White-on-roll decode: white at clockwise 6.
    expect(cw(boardWhite, 6).checkers.filter((c) => c.color === 'white')).toHaveLength(5)
    // Black-on-roll decode of the SAME id: black's point 6 (on-roll
    // perspective) → counterclockwise 6 = clockwise 19. So black ends
    // up at clockwise 19 and white (now opponent, clockwise) at 6.
    expect(cw(boardBlack, 19).checkers.filter((c) => c.color === 'black')).toHaveLength(5)
    expect(cw(boardBlack, 6).checkers.filter((c) => c.color === 'white')).toHaveLength(5)
  })
})

describe('encode → decode roundtrip', () => {
  // Roundtrip through core's Board.initialize + exportToGnuPositionId.
  // If this breaks, either the encoder or decoder has drifted from the
  // shared TanBoard convention.
  it('starting-position → id → decoded tan arrays → board → id is stable', async () => {
    const Core = await import('../index')
    const CoreRoot = await import('../..')
    const { Player } = CoreRoot
    const { Game } = await import('../../Game')

    const white = Player.initialize('white', 'clockwise', 'rolling-for-start', false)
    const black = Player.initialize('black', 'counterclockwise', 'rolling-for-start', false)
    let game = Game.initialize([white, black])
    // Advance past rolling-for-start into a state where activePlayer is set.
    game = Game.rollForStart(game as any) as any

    const id = Core.exportToGnuPositionId(game)
    expect(id).toHaveLength(14)

    const onRoll: OnRollContext = {
      color: (game as any).activePlayer.color,
      direction: (game as any).activePlayer.direction,
    }

    const board = fromPositionId(id, onRoll)
    // Reconstruct the game with the decoded board and re-encode.
    const reencoded = Core.exportToGnuPositionId({
      ...game,
      board,
    } as typeof game)
    expect(reencoded).toBe(id)
  })
})
