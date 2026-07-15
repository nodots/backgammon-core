import { describe, expect, it } from '@jest/globals'
import { BackgammonGame } from '@nodots/backgammon-types'
import { Game } from '../index'

// Minimal game shape for exercising the pure state predicates.
function gameWith(
  stateKind: string,
  extra: Partial<BackgammonGame> = {}
): BackgammonGame {
  return {
    stateKind,
    activeColor: 'white',
    players: [
      { id: 'p1', color: 'white' },
      { id: 'p2', color: 'black' },
    ],
    ...extra,
    // Predicate-only fixture; the full BackgammonGame shape is not needed.
  } as any
}

describe('Game.canRoll()', () => {
  it.each(['rolled-for-start', 'rolling', 'doubled'])(
    'is true in %s state',
    (kind) => {
      expect(Game.canRoll(gameWith(kind))).toBe(true)
    }
  )

  it.each(['rolling-for-start', 'moving', 'moved', 'completed'])(
    'is false in %s state',
    (kind) => {
      expect(Game.canRoll(gameWith(kind))).toBe(false)
    }
  )
})

describe('Game.canRollForStart()', () => {
  it('is true only in rolling-for-start state', () => {
    expect(Game.canRollForStart(gameWith('rolling-for-start'))).toBe(true)
    expect(Game.canRollForStart(gameWith('rolling'))).toBe(false)
  })
})

describe('Game.canGetPossibleMoves()', () => {
  it('is true only in moving state', () => {
    expect(Game.canGetPossibleMoves(gameWith('moving'))).toBe(true)
    expect(Game.canGetPossibleMoves(gameWith('rolling'))).toBe(false)
  })
})

describe('Game.canPlayerRoll()', () => {
  it('is false when the game cannot roll at all', () => {
    expect(Game.canPlayerRoll(gameWith('moving'), 'p1')).toBe(false)
  })

  it('is true for the active player in a rollable state', () => {
    expect(Game.canPlayerRoll(gameWith('rolling'), 'p1')).toBe(true)
  })

  it('is false for the non-active player', () => {
    expect(Game.canPlayerRoll(gameWith('rolling'), 'p2')).toBe(false)
  })

  it('is true regardless of id when there is no activeColor', () => {
    const g = gameWith('rolling', { activeColor: undefined as any })
    expect(Game.canPlayerRoll(g, 'anyone')).toBe(true)
  })
})
