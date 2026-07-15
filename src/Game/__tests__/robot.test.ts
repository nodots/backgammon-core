import { describe, expect, it } from '@jest/globals'
import { BackgammonGame, BackgammonGameMoved } from '@nodots/backgammon-types'
import { Game } from '../index'

// Build a real game rolled into play, then force it to 'moved' so the
// turn-confirmation path can run. isRobot controls both players.
function buildMovedGame(isRobot: boolean): BackgammonGameMoved {
  const game = Game.createNewGame(
    { userId: 'p1', isRobot },
    { userId: 'p2', isRobot }
  )
  const rolledForStart = Game.rollForStart(game)
  const rolled = Game.roll(rolledForStart)
  // Forcing to 'moved' for the confirmation-path fixture.
  return {
    ...rolled,
    stateKind: 'moved',
    activePlayer: { ...rolled.activePlayer, stateKind: 'moved' },
  } as any
}

describe('Game.handleRobotMovedState()', () => {
  it('confirms the turn when in moved state with a robot active player', () => {
    const moved = buildMovedGame(true)
    const result = Game.handleRobotMovedState(moved)
    expect(result.stateKind).toBe('rolling')
  })

  it('returns the game unchanged when the active player is human', () => {
    const moved = buildMovedGame(false)
    const result = Game.handleRobotMovedState(moved)
    expect(result).toBe(moved)
    expect(result.stateKind).toBe('moved')
  })

  it('returns the game unchanged when not in moved state', () => {
    const notMoved = { stateKind: 'rolling' } as unknown as BackgammonGame
    expect(Game.handleRobotMovedState(notMoved)).toBe(notMoved)
  })
})

describe('Game.confirmTurnWithRobotAutomation()', () => {
  it('confirms the turn and returns a rolling game (both robots)', async () => {
    const moved = buildMovedGame(true)
    const result = await Game.confirmTurnWithRobotAutomation(moved)
    expect(result.stateKind).toBe('rolling')
    // Next player is a robot; automation is external so the game is returned as-is.
    expect(result.activePlayer?.isRobot).toBe(true)
  })

  it('confirms the turn when the next player is human', async () => {
    const moved = buildMovedGame(false)
    const result = await Game.confirmTurnWithRobotAutomation(moved)
    expect(result.stateKind).toBe('rolling')
    expect(result.activePlayer?.isRobot).toBe(false)
  })
})
