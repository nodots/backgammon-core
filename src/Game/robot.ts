import {
  BackgammonGame,
  BackgammonGameMoved,
} from '@nodots/backgammon-types'
import { debug, logger } from '../utils/logger'
import { confirmTurn } from './turnFlow'

/**
 * Handle robot automation for games in 'moved' state
 * If the active player is a robot and the game is in 'moved' state, automatically confirm the turn
 * @param game - Game in any state
 * @returns Game with turn confirmed if robot automation was applied, otherwise unchanged
 */
export function handleRobotMovedState(game: BackgammonGame): BackgammonGame {
  // Only handle games in 'moved' state with robot active player
  if (game.stateKind === 'moved' && game.activePlayer.isRobot) {
    debug('Robot in moved state, auto-confirming turn')
    return confirmTurn(game as BackgammonGameMoved)
  }
  return game
}

/**
 * Async wrapper for confirmTurn that handles robot automation
 * @param game - Game in 'moving' state
 * @returns Promise<BackgammonGame> - Updated game state with robot automation if needed
 */
export async function confirmTurnWithRobotAutomation(
  game: BackgammonGameMoved
): Promise<BackgammonGame> {
  // Call the pure sync function first
  const confirmedGame = confirmTurn(game)

  // Check if the next player is a robot and handle automation
  if (confirmedGame.activePlayer?.isRobot) {
    try {
      // Dynamic import to avoid circular dependencies
      // Robot automation moved to @nodots/backgammon-robots package

      // Robot automation is now external - return game as-is
      logger.info('🤖 Robot automation is now handled externally')
      return confirmedGame
    } catch (error) {
      logger.error(
        '🤖 Robot automation error during turn transition (confirmTurn):',
        error
      )
      // Return original game state if robot automation throws
      return confirmedGame
    }
  }

  return confirmedGame
}
