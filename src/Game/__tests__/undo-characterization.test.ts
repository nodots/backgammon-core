import { describe, it, expect } from '@jest/globals'
import { Board } from '../../Board'
import { Game } from '..'
import { Player } from '../../Player'
import { Play } from '../../Play'
import { Cube } from '../../Cube'
import type {
  BackgammonCheckerContainerImport,
  BackgammonGameMoving,
  BackgammonPlayerInactive,
  BackgammonPlayerRolling,
} from '@nodots/backgammon-types'

// Helper to define a point by counterclockwise position.
const pointCC = (
  posCC: number,
  qty: number,
  color: 'black' | 'white'
): BackgammonCheckerContainerImport => ({
  // Positions are branded numeric literals in the type; the arithmetic result
  // is a plain number, so narrow it back for the import shape.
  position: { clockwise: (25 - posCC) as any, counterclockwise: posCC as any },
  checkers: { qty, color },
})

// Build a moving-state game with a single black checker at CC 24 and an open
// board, so die 1 (CC 24 -> CC 23) is legal. Fresh activePlay has no undo stack.
function buildMovingGame(): BackgammonGameMoving {
  const boardImport: BackgammonCheckerContainerImport[] = [pointCC(24, 1, 'black')]
  const board = Board.buildBoard(boardImport)

  const blackRolling = Player.initialize(
    'black',
    'counterclockwise',
    'rolling',
    false
  ) as BackgammonPlayerRolling
  const blackRolled = Player.roll(blackRolling)
  blackRolled.dice.currentRoll = [1, 2]
  const blackMoving = Player.toMoving(blackRolled)

  const whiteInactive = Player.initialize(
    'white',
    'clockwise',
    'inactive',
    false
  ) as BackgammonPlayerInactive

  const play = Play.initialize(board, blackMoving)

  // Composing a moving game from parts requires the loose tuple shape used by
  // the other Game unit tests.
  return Game.initialize(
    [blackMoving, whiteInactive] as any,
    'undo-char-game',
    'moving',
    board,
    Cube.initialize(),
    play,
    'black',
    blackMoving,
    whiteInactive
  ) as BackgammonGameMoving
}

// Find the id of the black checker at CC 24 on a game's board.
function ccOriginCheckerId(game: BackgammonGameMoving): string {
  const originPoint = Board.getPoints(game.board).find(
    (p) => p.position.counterclockwise === 24
  )!
  return originPoint.checkers.find((c) => c.color === 'black')!.id
}

describe('Game.canUndoActivePlay() — characterization', () => {
  it('returns false for a falsy game', () => {
    // Exercising the defensive null branch; the signature forbids undefined.
    expect(Game.canUndoActivePlay(undefined as any)).toBe(false)
  })

  it('returns false when stateKind is not moving or moved', () => {
    const game = buildMovingGame()
    const rolling = { ...game, stateKind: 'rolling' } as any
    expect(Game.canUndoActivePlay(rolling)).toBe(false)
  })

  it('returns false when activePlay has no undo stack', () => {
    const game = buildMovingGame()
    expect(Game.canUndoActivePlay(game)).toBe(false)
  })

  it('returns false when the undo stack is empty', () => {
    const game = buildMovingGame()
    ;(game.activePlay as any).undo = { frames: [] }
    expect(Game.canUndoActivePlay(game)).toBe(false)
  })

  it('returns true after a real move pushes a snapshot', () => {
    const game = buildMovingGame()
    const after = Game.move(game, ccOriginCheckerId(game)) as BackgammonGameMoving
    expect(Game.canUndoActivePlay(after)).toBe(true)
  })
})

describe('Game.undoLastInActivePlay() — characterization', () => {
  it('throws when no game state is provided', () => {
    // Defensive branch; the signature forbids undefined.
    expect(() => Game.undoLastInActivePlay(undefined as any)).toThrow(
      'No game state provided'
    )
  })

  it('throws when stateKind is not moving or moved', () => {
    const game = buildMovingGame()
    const rolling = { ...game, stateKind: 'rolling' } as any
    expect(() => Game.undoLastInActivePlay(rolling)).toThrow(
      "Cannot undo in rolling state"
    )
  })

  it('throws when there are no moves to undo', () => {
    const game = buildMovingGame()
    ;(game.activePlay as any).undo = { frames: [] }
    expect(() => Game.undoLastInActivePlay(game)).toThrow('No moves to undo')
  })

  it('throws when the undo snapshot is not a moving state', () => {
    const game = buildMovingGame()
    ;(game.activePlay as any).undo = { frames: [{ stateKind: 'moved' }] }
    expect(() => Game.undoLastInActivePlay(game)).toThrow(
      'Undo snapshot is invalid or not a moving state'
    )
  })

  it('returns the pre-move moving snapshot on the happy path', () => {
    const game = buildMovingGame()
    const before = Game.canUndoActivePlay(game)
    expect(before).toBe(false)

    const after = Game.move(game, ccOriginCheckerId(game)) as BackgammonGameMoving
    const restored = Game.undoLastInActivePlay(after)

    expect(restored.stateKind).toBe('moving')
    // The frame is the exact pre-move snapshot: undo stack was empty in it.
    expect(Game.canUndoActivePlay(restored)).toBe(false)
    // Popping the only frame empties the stack.
    expect(Game.canUndoActivePlay(after)).toBe(false)
  })
})
