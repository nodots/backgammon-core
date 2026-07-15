import { describe, expect, it } from '@jest/globals'
import { BackgammonGame } from '@nodots/backgammon-types'
import { Game } from '../index'

// Build a game forced into 'rolling' state, mirroring the setup used by
// crawford-jacoby-rules.test.ts.
function buildRollingGame(): BackgammonGame {
  const game = Game.createNewGame(
    { userId: 'player1', isRobot: false },
    { userId: 'player2', isRobot: false }
  )
  const rolledForStart = Game.rollForStart(game)
  // Forcing state shape for a unit fixture; matches the sibling cube tests.
  return {
    ...rolledForStart,
    stateKind: 'rolling',
    activePlayer: { ...rolledForStart.activePlayer, stateKind: 'rolling' },
    inactivePlayer: { ...rolledForStart.inactivePlayer, stateKind: 'inactive' },
  } as any
}

describe('Game.double() — characterization', () => {
  it('offers the cube: doubled state, value 2, offeredBy the active player', () => {
    const rolling = buildRollingGame()
    const offeringId = rolling.activePlayer!.id

    const doubled = Game.double(rolling as any)

    expect(doubled.stateKind).toBe('doubled')
    expect(doubled.cube.stateKind).toBe('offered')
    expect(doubled.cube.value).toBe(2)
    expect(doubled.cube.offeredBy?.id).toBe(offeringId)
  })

  it('throws when not in rolling state', () => {
    const rolling = buildRollingGame()
    const notRolling = { ...rolling, stateKind: 'moving' } as any
    expect(() => Game.double(notRolling)).toThrow('Cannot double from moving state')
  })
})

describe('Game.canAcceptDouble() / acceptDouble() — characterization', () => {
  it('canAcceptDouble is true for the non-offering player, false for the offering player', () => {
    const rolling = buildRollingGame()
    const doubled = Game.double(rolling as any)
    const offering = doubled.cube.offeredBy!
    const accepting = doubled.players.find((p) => p.id !== offering.id)!

    expect(Game.canAcceptDouble(doubled, accepting as any)).toBe(true)
    expect(Game.canAcceptDouble(doubled, offering as any)).toBeFalsy()
  })

  it('acceptDouble transfers the cube to the accepter and returns to rolling', () => {
    const rolling = buildRollingGame()
    const doubled = Game.double(rolling as any)
    const offering = doubled.cube.offeredBy!
    const accepting = doubled.players.find((p) => p.id !== offering.id)!

    const accepted = Game.acceptDouble(doubled, accepting as any)

    expect(accepted.stateKind).toBe('rolling')
    expect(accepted.cube.stateKind).toBe('doubled')
    expect(accepted.cube.value).toBe(2)
    expect(accepted.cube.owner?.id).toBe(accepting.id)
    expect(accepted.cube.offeredBy).toBeUndefined()
    // The original offering player is put back on roll.
    expect(accepted.activePlayer?.id).toBe(offering.id)
  })

  it('acceptDouble throws when the caller cannot accept', () => {
    const rolling = buildRollingGame()
    const doubled = Game.double(rolling as any)
    const offering = doubled.cube.offeredBy!
    expect(() => Game.acceptDouble(doubled, offering as any)).toThrow(
      'Cannot accept double'
    )
  })

  it('acceptDouble at 64 completes the game (maxxed cube)', () => {
    const doubled = Game.double(buildRollingGame() as any)
    const offering = doubled.cube.offeredBy!
    const accepting = doubled.players.find((p) => p.id !== offering.id)!
    // Force the offered value to the max; accepting it ends the game.
    const at64 = { ...doubled, cube: { ...doubled.cube, value: 64 } } as any
    const done = Game.acceptDouble(at64, accepting as any)
    expect(done.stateKind).toBe('completed')
    expect((done as any).pointsWon).toBe(64)
    expect(done.cube.stateKind).toBe('maxxed')
  })
})

describe('Game.refuseDouble() — characterization', () => {
  it('reverts to a doubled cube at half value when refusing a non-first double', () => {
    const doubled = Game.double(buildRollingGame() as any)
    const offering = doubled.cube.offeredBy!
    const refusing = doubled.players.find((p) => p.id !== offering.id)!
    // Cube already at 4 before this offer (a re-double, not the first double).
    const at4 = {
      ...doubled,
      cube: { ...doubled.cube, value: 4, owner: offering },
    } as any
    const done = Game.refuseDouble(at4, refusing as any)
    expect(done.stateKind).toBe('completed')
    // Winner gets the pre-double value: 4 / 2 = 2.
    expect((done as any).pointsWon).toBe(2)
    expect(done.cube.stateKind).toBe('doubled')
  })
})

describe('Game.resign() — characterization', () => {
  it('completes the game with the opponent as winner (simple, 1 point)', () => {
    const rolling = buildRollingGame()
    const resigningPlayer = rolling.activePlayer!
    const opponent = rolling.players.find((p) => p.id !== resigningPlayer.id)!

    const completed = Game.resign(rolling, resigningPlayer as any, 1)

    expect(completed.stateKind).toBe('completed')
    expect(completed.winner).toBe(opponent.id)
    expect((completed as any).winType).toBe('simple')
    expect((completed as any).pointsWon).toBe(1)
    expect((completed as any).endReason).toBe('resignation')
  })

  it('scores a gammon resignation as 2x the cube value', () => {
    const rolling = buildRollingGame()
    const completed = Game.resign(rolling, rolling.activePlayer! as any, 2)
    expect((completed as any).winType).toBe('gammon')
    // Fresh cube value is undefined -> treated as 1, so 2 * 1 = 2.
    expect((completed as any).pointsWon).toBe(2)
  })

  it('Jacoby rule reduces a gammon to simple when the cube is centered', () => {
    const base = buildRollingGame()
    const rolling = { ...base, rules: { useJacobyRule: true } } as any
    const completed = Game.resign(rolling, rolling.activePlayer, 2)
    expect((completed as any).winType).toBe('simple')
    expect((completed as any).pointsWon).toBe(1)
  })

  it('throws when resignation is disabled by settings', () => {
    const base = buildRollingGame()
    const rolling = { ...base, settings: { allowResign: false } } as any
    expect(() => Game.resign(rolling, rolling.activePlayer, 1)).toThrow(
      'Resignation is not allowed'
    )
  })

  it('throws when the game is already completed', () => {
    const base = buildRollingGame()
    const completedGame = { ...base, stateKind: 'completed' } as any
    expect(() => Game.resign(completedGame, base.activePlayer!, 1)).toThrow(
      'Cannot resign a completed game'
    )
  })
})
