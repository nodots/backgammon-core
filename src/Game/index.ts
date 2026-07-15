import {
  BackgammonBoard,
  BackgammonChecker,
  BackgammonColor,
  BackgammonCube,
  BackgammonCubeValue,
  BackgammonDieValue,
  BackgammonGame,
  BackgammonGameDoubled,
  BackgammonGameMoved,
  BackgammonGameMoving,
  BackgammonGameRolledForStart,
  BackgammonGameRolling,
  BackgammonGameRollingForStart,
  BackgammonGameStateKind,
  BackgammonMoveSkeleton,
  BackgammonPlay,
  BackgammonPlayer,
  BackgammonPlayerActive,
  BackgammonPlayerDoubled,
  BackgammonPlayerInactive,
  BackgammonPlayerMoving,
  BackgammonPlayerRolledForStart,
  BackgammonPlayerRolling,
  BackgammonPlayers,
  BackgammonPlayerWinner,
  BackgammonPlayMoving,
  BackgammonRoll,
} from '@nodots/backgammon-types'
import { generateId, Player } from '..'
import { Board } from '../Board'
import { exportToGnuPositionId } from '../Board/gnuPositionId'
import { Checker } from '../Checker'
import { Cube } from '../Cube'
import { BackgammonMoveDirection } from '../Play'
import { debug, logger } from '../utils/logger'
import {
  acceptDouble,
  canAcceptDouble,
  canOfferDouble,
  canRefuseDouble,
  double,
  refuseDouble,
  resign,
} from './cube'
import {
  canGetPossibleMoves,
  canPlayerRoll,
  canRoll,
  canRollForStart,
} from './guards'
import { restoreState, rollForStart } from './lifecycle'
import {
  checkAndCompleteTurn,
  confirmTurn,
  executeAndRecalculate,
  getPlayersForColor,
  move,
  moveAndFinalize,
  roll,
  startMove,
  switchDice,
  toMoved,
} from './turnFlow'
import { createBaseGameProperties, incrementStateVersion } from './shared'
import { canUndoActivePlay, undoLastInActivePlay } from './undo'

export * from '../index'
// Import tuple aliases from types package
import type {
  BackgammonGameCompleted,
  BackgammonPlayersMovingTuple,
  BackgammonPlayersRolledForStartTuple,
  BackgammonPlayersRollingForStartTuple,
  BackgammonPlayersRollingTuple,
} from '@nodots/backgammon-types'
import { executeRobotTurn } from './executeRobotTurn'

export class Game {
  id: string = generateId()
  stateKind!: BackgammonGameStateKind
  players!: BackgammonPlayers
  board!: Board
  cube!: Cube
  activeColor!: BackgammonColor
  activePlay!: BackgammonPlay
  activePlayer!: BackgammonPlayerActive
  inactivePlayer!: BackgammonPlayerInactive

  /**
   * Gets the GNU Position ID for the current board state
   * This is calculated dynamically based on the current game state
   */
  get gnuPositionId(): string {
    try {
      return exportToGnuPositionId(this as any)
    } catch (error) {
      logger.warn('Failed to generate gnuPositionId:', error)
      return ''
    }
  }

  public static createNewGame = function createNewGame(
    player1: { userId: string; isRobot: boolean },
    player2: { userId: string; isRobot: boolean },
    options?: {
      rules?: {
        useCrawfordRule?: boolean
        useJacobyRule?: boolean
        useBeaverRule?: boolean
        useRaccoonRule?: boolean
        useMurphyRule?: boolean
        useHollandRule?: boolean
      }
    }
  ): BackgammonGameRollingForStart {
    let blackDirection: BackgammonMoveDirection
    let whiteDirection: BackgammonMoveDirection

    if (Math.random() < 0.5) {
      blackDirection = 'clockwise'
      whiteDirection = 'counterclockwise'
    } else {
      blackDirection = 'counterclockwise'
      whiteDirection = 'clockwise'
    }

    const white = Player.initialize(
      'white',
      whiteDirection,
      'rolling-for-start',
      player1.isRobot,
      player1.userId
    )
    const black = Player.initialize(
      'black',
      blackDirection,
      'rolling-for-start',
      player2.isRobot,
      player2.userId
    )

    const players = [white, black]

    // Ensure players is a tuple of length 2
    const playersTuple = players as [(typeof players)[0], (typeof players)[1]]

    const board = Board.createBoardForPlayers(
      blackDirection === 'clockwise' ? 'black' : 'white',
      blackDirection === 'counterclockwise' ? 'black' : 'white'
    )

    // Initialize game
    let game = Game.initialize(
      playersTuple,
      generateId(),
      'rolling-for-start',
      board
    ) as BackgammonGameRollingForStart

    const playersWithCorrectPipCounts = Player.recalculatePipCounts(game)
    game = {
      ...game,
      players:
        playersWithCorrectPipCounts as BackgammonPlayersRollingForStartTuple,
      // Apply game rules if provided
      rules: {
        ...game.rules,
        ...options?.rules,
      },
    }

    return game
  }

  /**
   * @internal - Low-level constructor for scripts and internal use only.
   * Use Game.createNewGame() for normal game creation.
   */
  // Overloads by stateKind for typed returns
  public static initialize(
    players: BackgammonPlayers,
    id?: string,
    stateKind?: 'rolling-for-start',
    board?: BackgammonBoard,
    cube?: BackgammonCube,
    activePlay?: BackgammonPlay,
    activeColor?: BackgammonColor,
    activePlayer?: BackgammonPlayer,
    inactivePlayer?: BackgammonPlayer
  ): BackgammonGameRollingForStart
  public static initialize(
    players: BackgammonPlayersRolledForStartTuple,
    id: string | undefined,
    stateKind: 'rolled-for-start',
    board: BackgammonBoard,
    cube: BackgammonCube,
    activePlay: undefined,
    activeColor: BackgammonColor,
    activePlayer: BackgammonPlayerRolledForStart,
    inactivePlayer: BackgammonPlayerRolledForStart
  ): BackgammonGameRolledForStart
  public static initialize(
    players: BackgammonPlayers,
    id: string | undefined,
    stateKind: 'rolling',
    board: BackgammonBoard,
    cube: BackgammonCube,
    activePlay: undefined,
    activeColor: BackgammonColor,
    activePlayer: BackgammonPlayerRolling,
    inactivePlayer: BackgammonPlayerInactive
  ): BackgammonGameRolling
  public static initialize(
    players: BackgammonPlayers,
    id: string | undefined,
    stateKind: 'rolling',
    board: BackgammonBoard | undefined,
    cube: BackgammonCube | undefined,
    activePlay: undefined,
    activeColor: BackgammonColor,
    activePlayer: BackgammonPlayerRolling,
    inactivePlayer: BackgammonPlayerInactive
  ): BackgammonGameRolling
  public static initialize(
    players: BackgammonPlayers,
    id: string | undefined,
    stateKind: 'moving',
    board: BackgammonBoard,
    cube: BackgammonCube,
    activePlay: BackgammonPlayMoving,
    activeColor: BackgammonColor,
    activePlayer: BackgammonPlayerMoving,
    inactivePlayer: BackgammonPlayerInactive
  ): BackgammonGameMoving
  // Broad overload to accommodate test helpers using defaults
  public static initialize(
    players: BackgammonPlayers,
    id?: string,
    stateKind?: BackgammonGameStateKind,
    board?: BackgammonBoard,
    cube?: BackgammonCube,
    activePlay?: BackgammonPlay,
    activeColor?: BackgammonColor,
    activePlayer?: BackgammonPlayer,
    inactivePlayer?: BackgammonPlayer
  ): BackgammonGame
  public static initialize(
    players: BackgammonPlayers,
    id: string | undefined,
    stateKind: 'moving',
    board: BackgammonBoard | undefined,
    cube: BackgammonCube | undefined,
    activePlay: BackgammonPlayMoving,
    activeColor: BackgammonColor,
    activePlayer: BackgammonPlayerMoving,
    inactivePlayer: BackgammonPlayerInactive
  ): BackgammonGameMoving
  public static initialize(
    players: BackgammonPlayers,
    id: string = generateId(),
    stateKind: BackgammonGameStateKind = 'rolling-for-start',
    board: BackgammonBoard = Board.initialize(),
    cube: BackgammonCube = Cube.initialize(),
    activePlay?: BackgammonPlay,
    activeColor?: BackgammonColor,
    activePlayer?: BackgammonPlayer,
    inactivePlayer?: BackgammonPlayer
  ): BackgammonGame {
    switch (stateKind) {
      case 'rolling-for-start':
        return {
          ...createBaseGameProperties(),
          id,
          stateKind,
          players,
          board,
          cube,
        } as BackgammonGameRollingForStart
      case 'rolled-for-start':
        if (!activeColor) throw new Error('Active color must be provided')
        if (!activePlayer) throw new Error('Active player must be provided')
        if (!inactivePlayer) throw new Error('Inactive player must be provided')
        return {
          ...createBaseGameProperties(),
          id,
          stateKind,
          players,
          board,
          cube,
          activeColor,
          activePlayer,
          inactivePlayer,
        } as BackgammonGameRolledForStart
      case 'rolling':
        if (!activeColor) throw new Error('Active color must be provided')
        if (!activePlayer) throw new Error('Active player must be provided')
        if (!inactivePlayer) throw new Error('Inactive player must be provided')
        return {
          ...createBaseGameProperties(),
          id,
          stateKind,
          players,
          board,
          cube,
          activeColor,
          activePlayer,
          inactivePlayer,
        } as BackgammonGameRolling
      case 'moving':
        if (!activeColor) throw new Error('Active color must be provided')
        if (!activePlayer) throw new Error('Active player must be provided')
        if (!inactivePlayer) throw new Error('Inactive player must be provided')
        if (!activePlay) throw new Error('Active play must be provided')
        return {
          ...createBaseGameProperties(),
          id,
          stateKind,
          players,
          board,
          cube,
          activeColor,
          activePlayer,
          inactivePlayer,
          activePlay,
        } as BackgammonGameMoving
      case 'moved':
        throw new Error('Game cannot be initialized in the moved state')
      case 'completed':
        throw new Error('Game cannot be initialized in the completed state')
      case 'doubled':
        throw new Error('Game cannot be initialized in the doubled state')
    }
    // Exhaustiveness check
    const _exhaustiveCheck: never = stateKind
    throw new Error(`Unhandled stateKind: ${stateKind}`)
  }

  // ============================================================================
  // GAME STATE TRANSITION METHODS
  // ============================================================================

  public static rollForStart = function (
    game: BackgammonGameRollingForStart
  ): BackgammonGameRolledForStart {
    return rollForStart(game)
  }

  public static roll = roll

  public static switchDice = switchDice

  public static move = move

  public static moveAndFinalize = moveAndFinalize

  public static toMoved = toMoved

  public static executeAndRecalculate = executeAndRecalculate

  public static checkAndCompleteTurn = checkAndCompleteTurn

  public static confirmTurn = confirmTurn

  /**
   * Handle robot automation for games in 'moved' state
   * If the active player is a robot and the game is in 'moved' state, automatically confirm the turn
   * @param game - Game in any state
   * @returns Game with turn confirmed if robot automation was applied, otherwise unchanged
   */
  public static handleRobotMovedState = function handleRobotMovedState(
    game: BackgammonGame
  ): BackgammonGame {
    // Only handle games in 'moved' state with robot active player
    if (game.stateKind === 'moved' && game.activePlayer.isRobot) {
      debug('Robot in moved state, auto-confirming turn')
      return Game.confirmTurn(game as BackgammonGameMoved)
    }
    return game
  }

  public static executeRobotTurn = executeRobotTurn

  public static activePlayer = function activePlayer(
    game: BackgammonGame
  ): BackgammonPlayerActive {
    const activePlayer = game.players.find(
      (p) => p.color === game.activeColor && p.stateKind !== 'inactive'
    )
    if (!activePlayer) {
      throw new Error('Active player not found')
    }
    return activePlayer as BackgammonPlayerActive
  }

  public static inactivePlayer = function inactivePlayer(
    game: BackgammonGame
  ): BackgammonPlayerInactive {
    const inactivePlayer = game.players.find(
      (p) => p.color !== game.activeColor && p.stateKind === 'inactive'
    )
    if (!inactivePlayer) {
      throw new Error('Inactive player not found')
    }
    return inactivePlayer as BackgammonPlayerInactive
  }

  public static getPlayersForColor = getPlayersForColor

  /**
   * Restores a game to a previous state
   * This is the new architecture for state restoration - CORE validates but doesn't manage history
   * @param state Complete game state to restore to
   * @returns Validated game state
   */
  public static restoreState = function (
    state: BackgammonGame
  ): BackgammonGame {
    return restoreState(state)
  }

  public static startMove = startMove

  // --- Doubling Cube Logic ---

  public static canOfferDouble(
    game: BackgammonGame,
    player: BackgammonPlayerActive
  ): boolean {
    return canOfferDouble(game, player)
  }

  // --- Player Management ---

  /**
   * Validates if rolling is allowed in the current game state
   */
  public static canRoll(game: BackgammonGame): boolean {
    return canRoll(game)
  }

  /**
   * Validates if rolling for start is allowed in the current game state
   */
  public static canRollForStart(game: BackgammonGame): boolean {
    return canRollForStart(game)
  }

  /**
   * Validates if the specified player can roll in the current game state
   */
  public static canPlayerRoll(game: BackgammonGame, playerId: string): boolean {
    return canPlayerRoll(game, playerId)
  }

  /**
   * Validates if moves can be calculated for the current game state
   */
  public static canGetPossibleMoves(game: BackgammonGame): boolean {
    return canGetPossibleMoves(game)
  }

  // --- Checker Management ---

  /**
   * Finds a checker in the game board by ID
   * @param game - The game containing the board to search
   * @param checkerId - The ID of the checker to find
   * @returns The checker object or null if not found
   */
  public static findChecker(
    game: BackgammonGame,
    checkerId: string
  ): BackgammonChecker | null {
    try {
      return Checker.getChecker(game.board, checkerId)
    } catch {
      return null
    }
  }

  public static canAcceptDouble(
    game: BackgammonGame,
    player: BackgammonPlayerActive
  ): boolean {
    return canAcceptDouble(game, player)
  }

  public static acceptDouble(
    game: BackgammonGame,
    player: BackgammonPlayerActive
  ): BackgammonGame {
    return acceptDouble(game, player)
  }

  public static canRefuseDouble(
    game: BackgammonGame,
    player: BackgammonPlayerActive
  ): boolean {
    return canRefuseDouble(game, player)
  }

  public static refuseDouble(
    game: BackgammonGame,
    player: BackgammonPlayerActive
  ): BackgammonGame {
    return refuseDouble(game, player)
  }

  public static resign(
    game: BackgammonGame,
    resigningPlayer: BackgammonPlayer,
    points: 1 | 2 | 3 = 1
  ): BackgammonGameCompleted {
    return resign(game, resigningPlayer, points)
  }


  /**
   * Async wrapper for confirmTurn that handles robot automation
   * @param game - Game in 'moving' state
   * @returns Promise<BackgammonGame> - Updated game state with robot automation if needed
   */
  public static confirmTurnWithRobotAutomation =
    async function confirmTurnWithRobotAutomation(
      game: BackgammonGameMoved
    ): Promise<BackgammonGame> {
      // Call the pure sync function first
      const confirmedGame = Game.confirmTurn(game)

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

  // processRobotTurn method removed - now handled by @nodots/backgammon-robots package

  // undoLastMove removed - use database-driven state restoration via API endpoints instead

  /**
   * Execute doubling action from rolling state (before rolling dice)
   * Transitions from 'rolling' to 'doubled' state and offers double to opponent
   */
  public static double = function (
    game: BackgammonGameRolling
  ): BackgammonGameDoubled {
    return double(game)
  }

  /**
   * Undo the last executed move within the current activePlay using the turn-local undo stack.
   * Returns the exact pre-move moving game state.
   */
  public static undoLastInActivePlay = function (
    game: BackgammonGame
  ): BackgammonGameMoving {
    return undoLastInActivePlay(game)
  }

  /**
   * Game-level check for whether an undo is currently possible within activePlay.
   */
  public static canUndoActivePlay = function (game: BackgammonGame): boolean {
    return canUndoActivePlay(game)
  }
}
