import { describe, expect, it } from '@jest/globals'
import { BackgammonGame } from '@nodots/backgammon-types'
import { Game } from '../index'

// A complete, restorable game state.
function buildRestorableGame(): BackgammonGame {
  return Game.createNewGame(
    { userId: 'player1', isRobot: false },
    { userId: 'player2', isRobot: false }
  )
}

describe('Game.restoreState() — characterization', () => {
  it('returns the state unchanged for a valid, restorable game', () => {
    const game = buildRestorableGame()
    const restored = Game.restoreState(game)
    expect(restored).toBe(game)
  })

  it('throws when state is null or undefined', () => {
    // Defensive branch; the signature forbids null.
    expect(() => Game.restoreState(null as any)).toThrow(
      'Cannot restore: state is null or undefined'
    )
  })

  it('throws when stateKind is missing', () => {
    const game = buildRestorableGame()
    const noKind = { ...game, stateKind: undefined } as any
    expect(() => Game.restoreState(noKind)).toThrow(
      'invalid state - missing stateKind'
    )
  })

  it('throws when there are not exactly 2 players', () => {
    const game = buildRestorableGame()
    const onePlayer = { ...game, players: [game.players[0]] } as any
    expect(() => Game.restoreState(onePlayer)).toThrow(
      'must have exactly 2 players'
    )
  })

  it('throws when the board is missing', () => {
    const game = buildRestorableGame()
    const noBoard = { ...game, board: undefined } as any
    expect(() => Game.restoreState(noBoard)).toThrow(
      'invalid state - missing board'
    )
  })

  it('throws when the cube is missing', () => {
    const game = buildRestorableGame()
    const noCube = { ...game, cube: undefined } as any
    expect(() => Game.restoreState(noCube)).toThrow(
      'invalid state - missing cube'
    )
  })

  it('throws when the stateKind is not restorable', () => {
    const game = buildRestorableGame()
    const badKind = { ...game, stateKind: 'not-a-real-state' } as any
    expect(() => Game.restoreState(badKind)).toThrow(
      "Cannot restore: invalid stateKind 'not-a-real-state'"
    )
  })
})
