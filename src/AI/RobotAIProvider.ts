import type {
  BackgammonGame,
  BackgammonGameMoving,
  BackgammonGameRolling,
  BackgammonPlayMoving,
  BackgammonMoveReady,
} from '@nodots/backgammon-types'

/**
 * RobotAIProvider Interface
 *
 * This interface defines the contract for AI providers that can execute
 * complete robot turns in a backgammon game. Implementations of this interface
 * are responsible for analyzing the game state, selecting optimal moves, and
 * executing the full sequence of moves for a robot player's turn.
 *
 * The separation of concerns is:
 * - CORE: Defines this interface and game rules
 * - AI: Implements this interface with specific AI strategies (GNU, Nodots, etc.)
 * - API: Calls CORE's executeRobotTurn which delegates to registered provider
 *
 * @example
 * ```typescript
 * class GNUAIProvider implements RobotAIProvider {
 *   async executeRobotTurn(game: BackgammonGameMoving): Promise<BackgammonGameRolling> {
 *     // Use GNU Backgammon hints to determine and execute moves
 *     // Return updated game in rolling state for next player
 *   }
 * }
 * ```
 */
export interface RobotAIProvider {
  /**
   * Execute a complete robot turn
   *
   * Takes a game in the 'moving' state where a robot player needs to make moves,
   * analyzes the position, selects and executes all moves for this turn, and
   * returns the game in 'rolling' state ready for the next player.
   *
   * @param game - The current game state with a robot as the active player
   * @returns Promise resolving to the updated game state after all moves are executed
   * @throws Error if the active player is not a robot
   * @throws Error if move execution fails
   */
  executeRobotTurn(
    game: BackgammonGameMoving
  ): Promise<BackgammonGameRolling>

  /**
   * Select the best single move from a play's available moves.
   * This is used by tooling and scenarios where only move selection is needed
   * without executing a full robot turn.
   */
  selectBestMove(
    play: BackgammonPlayMoving,
    playerUserId?: string
  ): Promise<BackgammonMoveReady | undefined>

  /**
   * Respond to a pending resignation offer (game.resignationOffer) made by
   * the robot's opponent: 'accept' completes the game at the offered points,
   * 'decline' resumes play. Optional -- callers treat a provider without this
   * method as accepting (the pre-offer-flow behavior, where any resignation
   * ended the game immediately).
   */
  decideResignationResponse?(
    game: BackgammonGame
  ): Promise<'accept' | 'decline'>
}
