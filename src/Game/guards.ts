import { BackgammonGame } from '@nodots/backgammon-types'

/**
 * Validates if rolling is allowed in the current game state.
 */
export function canRoll(game: BackgammonGame): boolean {
  return (
    game.stateKind === 'rolled-for-start' ||
    game.stateKind === 'rolling' ||
    game.stateKind === 'doubled'
  )
}

/**
 * Validates if rolling for start is allowed in the current game state.
 */
export function canRollForStart(game: BackgammonGame): boolean {
  return game.stateKind === 'rolling-for-start'
}

/**
 * Validates if the specified player can roll in the current game state.
 */
export function canPlayerRoll(game: BackgammonGame, playerId: string): boolean {
  if (!canRoll(game)) {
    return false
  }

  // Check if the player is the active player
  if (game.activeColor) {
    const activePlayer = game.players.find((p) => p.color === game.activeColor)
    if (!activePlayer || activePlayer.id !== playerId) {
      return false
    }
  }

  return true
}

/**
 * Validates if moves can be calculated for the current game state.
 */
export function canGetPossibleMoves(game: BackgammonGame): boolean {
  return game.stateKind === 'moving'
}
