import {
  BackgammonBoard,
  BackgammonDieValue,
  BackgammonMoveOrigin,
  BackgammonPlayerMoving,
  BackgammonPlayMoving,
  BackgammonPointValue,
} from '@nodots/backgammon-types'
import { Board, Dice, Play, Player } from '../..'

// Reproduces the production bug from game 01727ded-7a6a-4125-8729-02f44a6b60db:
// a player rolled [5,2] and was allowed to play only the 5 (stranding the 2),
// even though playing the 2 first then the 5 uses both dice. The rule that a
// player must use as many dice as legally possible was not enforced.

type CheckerSpec = { point: number; color: 'white' | 'black'; qty: number }

// `point` is the clockwise point number; counterclockwise is its mirror (25 - point).
const buildBoard = (specs: CheckerSpec[]): BackgammonBoard =>
  Board.buildBoard(
    specs.map((s) => ({
      position: {
        clockwise: s.point as BackgammonPointValue,
        counterclockwise: (25 - s.point) as BackgammonPointValue,
      },
      checkers: { color: s.color, qty: s.qty },
    }))
  )

const movingPlayer = (
  color: 'white' | 'black',
  direction: 'clockwise' | 'counterclockwise',
  roll: [BackgammonDieValue, BackgammonDieValue]
): BackgammonPlayerMoving => {
  const base = Player.initialize(color, direction, 'inactive', false, 'test-user')
  return {
    ...base,
    stateKind: 'moving',
    dice: Dice.initialize(color, 'rolled', undefined, roll),
  } as BackgammonPlayerMoving
}

const originAt = (
  board: BackgammonBoard,
  direction: 'clockwise' | 'counterclockwise',
  position: number
): BackgammonMoveOrigin => {
  const point = board.points.find((p) => p.position[direction] === position)
  if (!point) throw new Error(`No point at ${direction} ${position}`)
  return point as BackgammonMoveOrigin
}

const diceUsed = (play: { moves: { stateKind: string; moveKind: string }[] }) =>
  play.moves.filter(
    (m) => m.stateKind === 'completed' && m.moveKind !== 'no-move'
  ).length

const captureThrow = (fn: () => unknown): { name?: string } | undefined => {
  try {
    fn()
    return undefined
  } catch (e) {
    return e as { name?: string }
  }
}

describe('Play - must use both dice (stranded-die bug)', () => {
  describe('counterclockwise player (reproduces production board)', () => {
    // White is counterclockwise. cc7 (=cw18) holds the only checker that can
    // play the 2; cc23/cc24 are blocked for the 2 by black on cc21/cc22.
    const makeBoard = () =>
      buildBoard([
        { point: 18, color: 'white', qty: 1 }, // cc7  - only legal source for the 2
        { point: 2, color: 'white', qty: 2 }, // cc23
        { point: 1, color: 'white', qty: 2 }, // cc24
        { point: 4, color: 'black', qty: 2 }, // cc21 - blocks cc23->cc21
        { point: 3, color: 'black', qty: 2 }, // cc22 - blocks cc24->cc22
      ])

    test('initialize computes maxDiceUsable = 2', () => {
      const board = makeBoard()
      const play = Play.initialize(board, movingPlayer('white', 'counterclockwise', [5, 2]))
      expect(play.maxDiceUsable).toBe(2)
    })

    test('playing the 5 from cc7 (stranding the 2) is rejected', () => {
      const board = makeBoard()
      const play = Play.initialize(board, movingPlayer('white', 'counterclockwise', [5, 2]))
      const thrown = captureThrow(() =>
        Play.move(board, play, originAt(board, 'counterclockwise', 7), 5)
      )
      expect(thrown?.name).toBe('MustUseBothDiceError')
    })

    test('playing the 2 first, then the 5, uses both dice', () => {
      const board = makeBoard()
      const play = Play.initialize(board, movingPlayer('white', 'counterclockwise', [5, 2]))

      const afterTwo = Play.move(board, play, originAt(board, 'counterclockwise', 7), 2)
      expect(afterTwo.play.moves.some((m) => m.stateKind === 'ready')).toBe(true)

      const afterFive = Play.move(
        afterTwo.board,
        afterTwo.play as BackgammonPlayMoving,
        originAt(afterTwo.board, 'counterclockwise', 23),
        5
      )
      expect(diceUsed(afterFive.play)).toBe(2)
    })
  })

  describe('clockwise player (direction independence)', () => {
    const makeBoard = () =>
      buildBoard([
        { point: 7, color: 'white', qty: 1 }, // only legal source for the 2
        { point: 23, color: 'white', qty: 2 },
        { point: 24, color: 'white', qty: 2 },
        { point: 21, color: 'black', qty: 2 }, // blocks 23->21
        { point: 22, color: 'black', qty: 2 }, // blocks 24->22
      ])

    test('playing the 5 from point 7 (stranding the 2) is rejected', () => {
      const board = makeBoard()
      const play = Play.initialize(board, movingPlayer('white', 'clockwise', [5, 2]))
      expect(play.maxDiceUsable).toBe(2)
      const thrown = captureThrow(() =>
        Play.move(board, play, originAt(board, 'clockwise', 7), 5)
      )
      expect(thrown?.name).toBe('MustUseBothDiceError')
    })

    test('playing the 2 first, then the 5, uses both dice', () => {
      const board = makeBoard()
      const play = Play.initialize(board, movingPlayer('white', 'clockwise', [5, 2]))
      const afterTwo = Play.move(board, play, originAt(board, 'clockwise', 7), 2)
      const afterFive = Play.move(
        afterTwo.board,
        afterTwo.play as BackgammonPlayMoving,
        originAt(afterTwo.board, 'clockwise', 23),
        5
      )
      expect(diceUsed(afterFive.play)).toBe(2)
    })
  })

  describe('must use the larger die when only one can be played', () => {
    // One mobile checker on point 9 can play the 6 (9->3) or the 3 (9->6), but
    // not both. A blocked back checker on 24 prevents bearing off either die.
    const makeBoard = () =>
      buildBoard([
        { point: 9, color: 'white', qty: 1 },
        { point: 24, color: 'white', qty: 1 },
        { point: 18, color: 'black', qty: 2 }, // blocks 24->18 (the 6)
        { point: 21, color: 'black', qty: 2 }, // blocks 24->21 (the 3)
      ])

    test('initialize computes maxDiceUsable = 1 with both dice playable at start', () => {
      const board = makeBoard()
      const play = Play.initialize(board, movingPlayer('white', 'clockwise', [6, 3]))
      expect(play.maxDiceUsable).toBe(1)
      expect([...(play.dieValuesPlayableAtStart ?? [])].sort()).toEqual([3, 6])
    })

    test('initialize converts the smaller-die move to a completed no-move', () => {
      const board = makeBoard()
      const play = Play.initialize(board, movingPlayer('white', 'clockwise', [6, 3]))
      const smaller = play.moves.find((m) => m.dieValue === 3)
      const larger = play.moves.find((m) => m.dieValue === 6)
      expect(smaller?.stateKind).toBe('completed')
      expect(smaller?.moveKind).toBe('no-move')
      expect(larger?.stateKind).toBe('ready')
    })

    test('attempting the smaller die (3) plays the larger (6) instead', () => {
      const board = makeBoard()
      const play = Play.initialize(board, movingPlayer('white', 'clockwise', [6, 3]))
      const result = Play.move(board, play, originAt(board, 'clockwise', 9), 3)
      const executed = result.play.moves.find(
        (m) => m.stateKind === 'completed' && m.moveKind !== 'no-move'
      )
      expect(executed?.dieValue).toBe(6)
      expect(diceUsed(result.play)).toBe(1)
    })

    test('playing the larger die (6) is accepted', () => {
      const board = makeBoard()
      const play = Play.initialize(board, movingPlayer('white', 'clockwise', [6, 3]))
      const result = Play.move(board, play, originAt(board, 'clockwise', 9), 6)
      expect(diceUsed(result.play)).toBe(1)
    })
  })

  describe('last checker bears off with either die (production game 2d98cf14)', () => {
    // One checker on the player's 2-point, 14 already off. Roll [3,5]: either
    // die bears off and ends the game, so maxDiceUsable is 1 and the rules
    // require the larger die (5). The robot picked the 3 and every turn
    // attempt was rejected, freezing the game in 'moving'.
    const makeBoardClockwise = (): BackgammonBoard =>
      Board.buildBoard([
        {
          position: { clockwise: 2, counterclockwise: 23 },
          checkers: { color: 'white', qty: 1 },
        },
        {
          position: 'off',
          direction: 'clockwise',
          checkers: { color: 'white', qty: 14 },
        },
        {
          position: { clockwise: 13, counterclockwise: 12 },
          checkers: { color: 'black', qty: 5 },
        },
        {
          position: { clockwise: 19, counterclockwise: 6 },
          checkers: { color: 'black', qty: 5 },
        },
        {
          position: { clockwise: 24, counterclockwise: 1 },
          checkers: { color: 'black', qty: 5 },
        },
      ])

    test('initialize prunes the smaller die: 3 is a no-move, 5 is a ready bear-off', () => {
      const board = makeBoardClockwise()
      const play = Play.initialize(board, movingPlayer('white', 'clockwise', [3, 5]))
      expect(play.maxDiceUsable).toBe(1)
      expect([...(play.dieValuesPlayableAtStart ?? [])].sort()).toEqual([3, 5])
      const smaller = play.moves.find((m) => m.dieValue === 3)
      const larger = play.moves.find((m) => m.dieValue === 5)
      expect(smaller?.stateKind).toBe('completed')
      expect(smaller?.moveKind).toBe('no-move')
      expect(larger?.stateKind).toBe('ready')
      expect(larger?.moveKind).toBe('bear-off')
    })

    test('moving the last checker bears off with the 5, no throw', () => {
      const board = makeBoardClockwise()
      const play = Play.initialize(board, movingPlayer('white', 'clockwise', [3, 5]))
      const result = Play.move(board, play, originAt(board, 'clockwise', 2))
      const executed = result.play.moves.find(
        (m) => m.stateKind === 'completed' && m.moveKind !== 'no-move'
      )
      expect(executed?.dieValue).toBe(5)
      expect(diceUsed(result.play)).toBe(1)
      expect(result.play.moves.some((m) => m.stateKind === 'ready')).toBe(false)
      expect(result.board.off.clockwise.checkers.length).toBe(15)
    })

    test('roll order [5,3] behaves the same', () => {
      const board = makeBoardClockwise()
      const play = Play.initialize(board, movingPlayer('white', 'clockwise', [5, 3]))
      const smaller = play.moves.find((m) => m.dieValue === 3)
      expect(smaller?.moveKind).toBe('no-move')
      const result = Play.move(board, play, originAt(board, 'clockwise', 2))
      const executed = result.play.moves.find(
        (m) => m.stateKind === 'completed' && m.moveKind !== 'no-move'
      )
      expect(executed?.dieValue).toBe(5)
      expect(result.board.off.clockwise.checkers.length).toBe(15)
    })

    test('counterclockwise mirror behaves the same', () => {
      const board = Board.buildBoard([
        {
          position: { clockwise: 23, counterclockwise: 2 },
          checkers: { color: 'white', qty: 1 },
        },
        {
          position: 'off',
          direction: 'counterclockwise',
          checkers: { color: 'white', qty: 14 },
        },
        {
          position: { clockwise: 12, counterclockwise: 13 },
          checkers: { color: 'black', qty: 5 },
        },
        {
          position: { clockwise: 6, counterclockwise: 19 },
          checkers: { color: 'black', qty: 5 },
        },
        {
          position: { clockwise: 1, counterclockwise: 24 },
          checkers: { color: 'black', qty: 5 },
        },
      ])
      const play = Play.initialize(
        board,
        movingPlayer('white', 'counterclockwise', [3, 5])
      )
      expect(play.maxDiceUsable).toBe(1)
      const smaller = play.moves.find((m) => m.dieValue === 3)
      expect(smaller?.moveKind).toBe('no-move')
      const result = Play.move(
        board,
        play,
        originAt(board, 'counterclockwise', 2)
      )
      const executed = result.play.moves.find(
        (m) => m.stateKind === 'completed' && m.moveKind !== 'no-move'
      )
      expect(executed?.dieValue).toBe(5)
      expect(result.board.off.counterclockwise.checkers.length).toBe(15)
    })
  })

  describe('doubles', () => {
    // One mobile checker on 13 can play two 6s (13->7->1); a blocked back
    // checker on 24 caps usage at 2 of the four 6s.
    test('initialize computes maxDiceUsable = 2 and the two sixes complete', () => {
      const board = buildBoard([
        { point: 13, color: 'white', qty: 1 },
        { point: 24, color: 'white', qty: 1 },
        { point: 18, color: 'black', qty: 2 }, // blocks 24->18
      ])
      const play = Play.initialize(board, movingPlayer('white', 'clockwise', [6, 6]))
      expect(play.maxDiceUsable).toBe(2)

      const first = Play.move(board, play, originAt(board, 'clockwise', 13), 6)
      const second = Play.move(
        first.board,
        first.play as BackgammonPlayMoving,
        originAt(first.board, 'clockwise', 7),
        6
      )
      expect(diceUsed(second.play)).toBe(2)
    })
  })
})
