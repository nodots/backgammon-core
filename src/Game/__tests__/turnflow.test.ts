import { describe, expect, it } from '@jest/globals'
import type {
  BackgammonCheckerContainerImport,
  BackgammonGameMoving,
  BackgammonPlayerInactive,
  BackgammonPlayerRollingForStart,
} from '@nodots/backgammon-types'
import { Board } from '../../Board'
import { Cube } from '../../Cube'
import { Dice } from '../../Dice'
import { Play } from '../../Play'
import { Player } from '../../Player'
import { Game } from '../index'

const pointCC = (
  posCC: number,
  qty: number,
  color: 'black' | 'white'
): BackgammonCheckerContainerImport => ({
  // Branded position literals; the arithmetic result is a plain number.
  position: { clockwise: (25 - posCC) as any, counterclockwise: posCC as any },
  checkers: { qty, color },
})

// Moving game: a single black checker at CC 24, open board, roll [1,2].
// Both dice are legal, so the play has two ready moves and an empty undo stack.
function buildMovingGame(): BackgammonGameMoving {
  const board = Board.buildBoard([pointCC(24, 1, 'black')])
  const blackRolling = Player.initialize(
    'black',
    'counterclockwise',
    'rolling',
    false
  ) as any
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
  return Game.initialize(
    [blackMoving, whiteInactive] as any,
    'turnflow-game',
    'moving',
    board,
    Cube.initialize(),
    play,
    'black',
    blackMoving,
    whiteInactive
  ) as BackgammonGameMoving
}

function ccOriginCheckerId(game: BackgammonGameMoving): string {
  const originPoint = Board.getPoints(game.board).find(
    (p) => p.position.counterclockwise === 24
  )!
  return originPoint.checkers.find((c) => c.color === 'black')!.id
}

// A game forced into 'rolling' state, ready for Game.roll's rolling branch.
// The active-color player in the players array must also be 'rolling' with
// rolling dice, since Game.roll reads it via getPlayersForColor.
function buildRollingGame() {
  const game = Game.createNewGame(
    { userId: 'p1', isRobot: false },
    { userId: 'p2', isRobot: false }
  )
  const rfs = Game.rollForStart(game)
  const activeColor = rfs.activeColor
  const activeRolling = {
    ...rfs.activePlayer,
    stateKind: 'rolling',
    dice: Dice.initialize(rfs.activePlayer.color, 'rolling'),
  }
  const inactive = { ...rfs.inactivePlayer, stateKind: 'inactive' }
  const players = rfs.players.map((p) =>
    p.color === activeColor ? activeRolling : inactive
  )
  return {
    ...rfs,
    stateKind: 'rolling',
    players,
    activePlayer: activeRolling,
    inactivePlayer: inactive,
  } as any
}

describe('Game.roll()', () => {
  it('rolls from rolled-for-start using the roll-for-start values', () => {
    const game = Game.createNewGame(
      { userId: 'p1', isRobot: false },
      { userId: 'p2', isRobot: false }
    )
    const rolledForStart = Game.rollForStart(game)
    const rolled = Game.roll(rolledForStart)
    expect(['moving', 'moved']).toContain(rolled.stateKind)
    expect(rolled.activePlayer.dice.currentRoll).toBeDefined()
  })

  it('rolls from rolling state (generates new dice)', () => {
    const rolled = Game.roll(buildRollingGame())
    expect(['moving', 'moved']).toContain(rolled.stateKind)
  })

  it('rolls from doubled state after a double', () => {
    const doubled = Game.double(buildRollingGame())
    const rolled = Game.roll(doubled as any)
    expect(['moving', 'moved']).toContain(rolled.stateKind)
  })

  it('throws on an unexpected state', () => {
    expect(() => Game.roll({ stateKind: 'moving' } as any)).toThrow()
  })
})

describe('Game.switchDice()', () => {
  it('swaps the dice order and regenerates moves', () => {
    const game = buildMovingGame()
    const before = game.activePlayer.dice.currentRoll
    const switched = Game.switchDice(game)
    expect(switched.activePlayer.dice.currentRoll).toEqual([
      before![1],
      before![0],
    ])
  })

  it('throws when not in moving state', () => {
    const game = buildMovingGame()
    expect(() => Game.switchDice({ ...game, stateKind: 'rolling' } as any)).toThrow(
      'Cannot switch dice'
    )
  })

  it('throws when moves are not all undone', () => {
    const game = buildMovingGame()
    // Mark a move completed so not-all-undone.
    ;(game.activePlay as any).moves[0].stateKind = 'completed'
    expect(() => Game.switchDice(game)).toThrow('all moves are undone')
  })
})

describe('Game.executeAndRecalculate()', () => {
  it('executes a move from an origin container', () => {
    const game = buildMovingGame()
    const originId = Board.getPoints(game.board).find(
      (p) => p.position.counterclockwise === 24
    )!.id
    const after = Game.executeAndRecalculate(game, originId)
    expect(after).toBeDefined()
    expect(['moving', 'moved', 'completed']).toContain(after.stateKind)
  })

  it('throws when no checker exists in the origin', () => {
    const game = buildMovingGame()
    const emptyOrigin = Board.getPoints(game.board).find(
      (p) => p.checkers.length === 0
    )!.id
    expect(() => Game.executeAndRecalculate(game, emptyOrigin)).toThrow(
      'checker found in container'
    )
  })
})

describe('Game.checkAndCompleteTurn()', () => {
  it('returns the game unchanged when moves are incomplete', () => {
    const game = buildMovingGame()
    const result = Game.checkAndCompleteTurn(game)
    // Both dice still playable from CC24, so the turn is not complete.
    expect(result.stateKind).toBe('moving')
  })

  it('returns the game unchanged for an invalid game structure', () => {
    const broken = { stateKind: 'moving' } as any
    expect(Game.checkAndCompleteTurn(broken)).toBe(broken)
  })
})

describe('Game.toMoved()', () => {
  it('throws when not in moving state', () => {
    const game = buildMovingGame()
    expect(() => Game.toMoved({ ...game, stateKind: 'rolling' } as any)).toThrow(
      "Must be in 'moving' state"
    )
  })

  it('throws when not all moves are completed', () => {
    const game = buildMovingGame()
    expect(() => Game.toMoved(game)).toThrow('not all moves are completed')
  })

  it('transitions to moved when all moves are completed', () => {
    const game = buildMovingGame()
    ;(game.activePlay as any).moves.forEach((m: any) => {
      m.stateKind = 'completed'
    })
    const moved = Game.toMoved(game)
    expect(moved.stateKind).toBe('moved')
  })
})

describe('Game.moveAndFinalize()', () => {
  it('executes a move and returns a valid state', () => {
    const game = buildMovingGame()
    const after = Game.moveAndFinalize(game, ccOriginCheckerId(game))
    expect(['moving', 'moved', 'completed']).toContain(after.stateKind)
  })
})

