import {
  BackgammonColor,
  BackgammonGame,
  BackgammonGameRolledForStart,
  BackgammonGameRollingForStart,
  BackgammonPlayerRollingForStart,
  BackgammonPlayersRolledForStartTuple,
  RESTORABLE_GAME_STATE_KINDS,
} from '@nodots/backgammon-types'
import { Player } from '..'
import { logger } from '../utils/logger'
import { incrementStateVersion } from './shared'

export function rollForStart(
  game: BackgammonGameRollingForStart
): BackgammonGameRolledForStart {
  const { players } = game
  const clockwise = players.find(
    (p) => p.direction === 'clockwise' && p.stateKind === 'rolling-for-start'
  )
  const counterclockwise = players.find(
    (p) =>
      p.direction === 'counterclockwise' && p.stateKind === 'rolling-for-start'
  )

  if (!clockwise || !counterclockwise) {
    throw new Error(
      'Cannot rollForStart without clockwise and counterclockwise players'
    )
  }

  // Roll dice for both players
  const rolledClockwise = Player.rollForStart(
    clockwise as BackgammonPlayerRollingForStart
  )
  const rolledCounterclockwise = Player.rollForStart(
    counterclockwise as BackgammonPlayerRollingForStart
  )

  // Determine who goes first based on the rolls
  const clockwiseRoll = rolledClockwise.dice.currentRoll![0]
  const counterclockwiseRoll = rolledCounterclockwise.dice.currentRoll![0]

  let activeColor: BackgammonColor
  if (clockwiseRoll > counterclockwiseRoll) {
    activeColor = clockwise.color
  } else if (counterclockwiseRoll > clockwiseRoll) {
    activeColor = counterclockwise.color
  } else {
    // Tie - need to reroll (for now, default to clockwise)
    return rollForStart(game)
  }

  const rollingForStartPlayers = [rolledClockwise, rolledCounterclockwise]
  const activePlayer = rollingForStartPlayers.find(
    (p) => p.color === activeColor
  )!
  const inactivePlayer = rollingForStartPlayers.find(
    (p) => p.color !== activeColor
  )!

  return incrementStateVersion({
    ...game,
    stateKind: 'rolled-for-start',
    activeColor,
    // Ensure tuple order is [active, inactive] for stricter typing
    players: [
      activePlayer,
      inactivePlayer,
    ] as BackgammonPlayersRolledForStartTuple,
    activePlayer,
    inactivePlayer,
  } as BackgammonGameRolledForStart)
}

/**
 * Restores a game to a previous state
 * This is the new architecture for state restoration - CORE validates but doesn't manage history
 * @param state Complete game state to restore to
 * @returns Validated game state
 */
export function restoreState(state: BackgammonGame): BackgammonGame {
  // Validate that this is a valid game state
  if (!state) {
    throw new Error('Cannot restore: state is null or undefined')
  }

  if (!state.stateKind) {
    throw new Error('Cannot restore: invalid state - missing stateKind')
  }

  if (!state.players || state.players.length !== 2) {
    throw new Error(
      'Cannot restore: invalid state - must have exactly 2 players'
    )
  }

  if (!state.board) {
    throw new Error('Cannot restore: invalid state - missing board')
  }

  if (!state.cube) {
    throw new Error('Cannot restore: invalid state - missing cube')
  }

  // Validate state kind is one of the known restorable states from TYPES
  if (!RESTORABLE_GAME_STATE_KINDS.includes(state.stateKind)) {
    throw new Error(`Cannot restore: invalid stateKind '${state.stateKind}'`)
  }

  // State is valid - return it
  // Note: We return the state as-is because it's already a complete, valid game state
  // The API layer is responsible for persisting this state
  logger.info(`State restored successfully to ${state.stateKind}`)
  return state
}
