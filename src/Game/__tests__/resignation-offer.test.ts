import { describe, expect, it } from '@jest/globals'
import { BackgammonGame } from '@nodots/backgammon-types'
import { Game } from '../index'

// Build a game forced into 'rolling' state, mirroring the setup used by
// cube-resign-characterization.test.ts.
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

describe('Game.offerResign()', () => {
  it('records a pending offer without completing the game', () => {
    const rolling = buildRollingGame()
    const offering = rolling.activePlayer!

    const offered = Game.offerResign(rolling, offering as any, 1)

    expect(offered.stateKind).toBe('rolling')
    expect(offered.resignationOffer?.offeredById).toBe(offering.id)
    expect(offered.resignationOffer?.points).toBe(1)
    expect(offered.winner).toBeUndefined()
  })

  it('increments stateVersion', () => {
    const rolling = buildRollingGame()
    const before = rolling.stateVersion ?? 0
    const offered = Game.offerResign(rolling, rolling.activePlayer! as any, 2)
    expect(offered.stateVersion).toBe(before + 1)
  })

  it('throws when resignation is disabled by settings', () => {
    const base = buildRollingGame()
    const rolling = { ...base, settings: { allowResign: false } } as any
    expect(() =>
      Game.offerResign(rolling, rolling.activePlayer, 1)
    ).toThrow('Resignation is not allowed')
  })

  it('throws when the game is already completed', () => {
    const base = buildRollingGame()
    const completed = { ...base, stateKind: 'completed' } as any
    expect(() =>
      Game.offerResign(completed, base.activePlayer! as any, 1)
    ).toThrow('Cannot resign a completed game')
  })

  it('throws when an offer is already pending', () => {
    const rolling = buildRollingGame()
    const offered = Game.offerResign(rolling, rolling.activePlayer! as any, 1)
    expect(() =>
      Game.offerResign(offered, offered.activePlayer! as any, 1)
    ).toThrow('already pending')
  })
})

describe('Game.canRespondToResign()', () => {
  it('is true only for the opponent while an offer is pending', () => {
    const rolling = buildRollingGame()
    const offering = rolling.activePlayer!
    const opponent = rolling.players.find((p) => p.id !== offering.id)!

    expect(Game.canRespondToResign(rolling, opponent as any)).toBe(false)

    const offered = Game.offerResign(rolling, offering as any, 1)
    expect(Game.canRespondToResign(offered, opponent as any)).toBe(true)
    expect(Game.canRespondToResign(offered, offering as any)).toBe(false)
  })
})

describe('Game.acceptResign()', () => {
  it('completes the game with the accepter as winner at the offered points', () => {
    const rolling = buildRollingGame()
    const offering = rolling.activePlayer!
    const opponent = rolling.players.find((p) => p.id !== offering.id)!

    const offered = Game.offerResign(rolling, offering as any, 1)
    const completed = Game.acceptResign(offered, opponent as any)

    expect(completed.stateKind).toBe('completed')
    expect(completed.winner).toBe(opponent.id)
    expect((completed as any).winType).toBe('simple')
    expect((completed as any).pointsWon).toBe(1)
    expect((completed as any).endReason).toBe('resignation')
    expect(completed.resignationOffer).toBeUndefined()
  })

  it('scores a gammon offer as 2x the cube value', () => {
    const rolling = buildRollingGame()
    const offering = rolling.activePlayer!
    const opponent = rolling.players.find((p) => p.id !== offering.id)!

    const offered = Game.offerResign(rolling, offering as any, 2)
    const completed = Game.acceptResign(offered, opponent as any)

    expect((completed as any).winType).toBe('gammon')
    // Fresh cube value is undefined -> treated as 1, so 2 * 1 = 2.
    expect((completed as any).pointsWon).toBe(2)
  })

  it('multiplies by the live cube value', () => {
    const base = buildRollingGame()
    const offering = base.activePlayer!
    const opponent = base.players.find((p) => p.id !== offering.id)!
    const at4 = { ...base, cube: { ...base.cube, value: 4 } } as any

    const offered = Game.offerResign(at4, offering as any, 1)
    const completed = Game.acceptResign(offered, opponent as any)

    expect((completed as any).pointsWon).toBe(4)
  })

  it('Jacoby rule reduces a gammon to simple when the cube is centered', () => {
    const base = buildRollingGame()
    const rolling = { ...base, rules: { useJacobyRule: true } } as any
    const offering = rolling.activePlayer
    const opponent = rolling.players.find((p: any) => p.id !== offering.id)

    const offered = Game.offerResign(rolling, offering, 2)
    const completed = Game.acceptResign(offered, opponent)

    expect((completed as any).winType).toBe('simple')
    expect((completed as any).pointsWon).toBe(1)
  })

  it('throws when the offering player tries to accept their own offer', () => {
    const rolling = buildRollingGame()
    const offering = rolling.activePlayer!
    const offered = Game.offerResign(rolling, offering as any, 1)
    expect(() => Game.acceptResign(offered, offering as any)).toThrow(
      'Cannot respond to resignation'
    )
  })

  it('throws when no offer is pending', () => {
    const rolling = buildRollingGame()
    const opponent = rolling.players.find(
      (p) => p.id !== rolling.activePlayer!.id
    )!
    expect(() => Game.acceptResign(rolling, opponent as any)).toThrow(
      'Cannot respond to resignation'
    )
  })
})

describe('Game.declineResign()', () => {
  it('clears the offer and play resumes in the same state', () => {
    const rolling = buildRollingGame()
    const offering = rolling.activePlayer!
    const opponent = rolling.players.find((p) => p.id !== offering.id)!

    const offered = Game.offerResign(rolling, offering as any, 1)
    const declined = Game.declineResign(offered, opponent as any)

    expect(declined.stateKind).toBe('rolling')
    expect(declined.resignationOffer).toBeUndefined()
    expect(declined.winner).toBeUndefined()
    expect(declined.activePlayer?.id).toBe(offering.id)
  })

  it('throws when the offering player tries to decline their own offer', () => {
    const rolling = buildRollingGame()
    const offering = rolling.activePlayer!
    const offered = Game.offerResign(rolling, offering as any, 1)
    expect(() => Game.declineResign(offered, offering as any)).toThrow(
      'Cannot respond to resignation'
    )
  })

  it('throws when no offer is pending', () => {
    const rolling = buildRollingGame()
    const opponent = rolling.players.find(
      (p) => p.id !== rolling.activePlayer!.id
    )!
    expect(() => Game.declineResign(rolling, opponent as any)).toThrow(
      'Cannot respond to resignation'
    )
  })
})
