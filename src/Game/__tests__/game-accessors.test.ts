import { describe, expect, it } from '@jest/globals'
import { Board } from '../../Board'
import { Game } from '../index'

// A real game rolled into 'moving' state (board + active/inactive players).
function buildMovingGame() {
  const game = Game.createNewGame(
    { userId: 'p1', isRobot: false },
    { userId: 'p2', isRobot: false }
  )
  const rolledForStart = Game.rollForStart(game)
  return Game.roll(rolledForStart)
}

describe('Game.activePlayer() / inactivePlayer()', () => {
  it('returns the active and inactive players by color/state', () => {
    const g = buildMovingGame()
    const active = Game.activePlayer(g)
    const inactive = Game.inactivePlayer(g)
    expect(active.color).toBe(g.activeColor)
    expect(inactive.color).not.toBe(g.activeColor)
    expect(inactive.stateKind).toBe('inactive')
  })

  it('throws when no active player matches', () => {
    const g = buildMovingGame()
    const broken = { ...g, activeColor: undefined } as any
    expect(() => Game.activePlayer(broken)).toThrow('Active player not found')
  })

  it('throws when no inactive player matches', () => {
    const g = buildMovingGame()
    // Both players share activeColor so none is inactive-for-that-color.
    const broken = {
      ...g,
      players: g.players.map((p) => ({ ...p, color: g.activeColor })),
    } as any
    expect(() => Game.inactivePlayer(broken)).toThrow('Inactive player not found')
  })
})

describe('Game.getPlayersForColor()', () => {
  it('returns [active, inactive] for the given color', () => {
    const g = buildMovingGame()
    const [active, inactive] = Game.getPlayersForColor(g.players, g.activeColor)
    expect(active.color).toBe(g.activeColor)
    expect(inactive.color).not.toBe(g.activeColor)
  })

  it('throws when a matching player is missing', () => {
    const g = buildMovingGame()
    const oneColor = g.players.map((p) => ({ ...p, color: 'white' })) as any
    expect(() => Game.getPlayersForColor(oneColor, 'white')).toThrow(
      'Players not found'
    )
  })
})

describe('Game.findChecker()', () => {
  it('returns the checker when it exists on the board', () => {
    const g = buildMovingGame()
    const anyChecker = Board.getCheckers(g.board)[0]
    const found = Game.findChecker(g, anyChecker.id)
    expect(found?.id).toBe(anyChecker.id)
  })

  it('returns null when the checker id is not found', () => {
    const g = buildMovingGame()
    expect(Game.findChecker(g, 'no-such-checker')).toBeNull()
  })
})

describe('Game.createNewGame() with rules', () => {
  it('merges provided rules onto the base game', () => {
    const g = Game.createNewGame(
      { userId: 'p1', isRobot: false },
      { userId: 'p2', isRobot: true },
      { rules: { useJacobyRule: true, useBeaverRule: true } }
    )
    expect(g.rules?.useJacobyRule).toBe(true)
    expect(g.rules?.useBeaverRule).toBe(true)
    expect(g.stateKind).toBe('rolling-for-start')
    expect(g.players).toHaveLength(2)
  })
})
