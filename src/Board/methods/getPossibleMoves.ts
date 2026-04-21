import {
  BackgammonBoard,
  BackgammonDieValue,
  BackgammonMoveOrigin,
  BackgammonMoveSkeleton,
  BackgammonPlayer,
  BackgammonPoint,
} from '@nodots/backgammon-types'
import { debug } from '../../utils/logger'
import { Board } from '../index'

/**
 * Directional Position Helpers
 *
 * Golden Rule (unchanged): We never "walk" the board manually or create ad‑hoc
 * containers. We always resolve containers by comparing against the player's
 * directional coordinates, e.g.
 *    points.find(p => p.position[player.direction] === <position>)
 *
 * IMPORTANT: In our representation, p.position.clockwise and
 * p.position.counterclockwise are expressed in each player's moving coordinate
 * system such that advancing toward bearing‑off corresponds to DECREASING the
 * numeric position in that system. That is why the original implementation
 * always used `originPos - die` for destination computation regardless of
 * direction, and why reentry used `25 - die`.
 *
 * These helpers preserve that behavior while keeping the intent explicit.
 */
function computeDestinationPosition(
  originPos: number,
  dieValue: BackgammonDieValue,
  direction: 'clockwise' | 'counterclockwise'
): number {
  // In directional coordinates, advancing always subtracts the die value.
  // See note above — both position.clockwise and position.counterclockwise
  // are oriented so that forward movement is originPos - dieValue.
  return originPos - dieValue
}

function computeReentryPosition(
  dieValue: BackgammonDieValue,
  direction: 'clockwise' | 'counterclockwise'
): number {
  // In directional coordinates, reentry point is represented as 25 - die.
  // The directional mapping in p.position[...] ensures the correct container
  // is resolved via the Golden Rule lookup.
  return 25 - dieValue
}

// Core move calculation logic - now internal use only
const getBasicPossibleMoves = function getBasicPossibleMoves(
  board: BackgammonBoard,
  player: BackgammonPlayer,
  dieValue: BackgammonDieValue
): BackgammonMoveSkeleton[] {
  const possibleMoves: BackgammonMoveSkeleton[] = []
  const playerPoints = Board.getPoints(board).filter(
    (p: BackgammonPoint) =>
      p.checkers.length > 0 && p.checkers[0].color === player.color
  )
  const playerDirection = player.direction
  const bar = board.bar[playerDirection]

  // If player has no checkers left, return empty array
  if (playerPoints.length === 0 && bar.checkers.length === 0) {
    return possibleMoves
  }

  // If player has checkers on the bar, they must move those first
  if (bar.checkers.length > 0) {
    // Reentry: compute scalar position within player's directional coords,
    // then resolve the container by the Golden Rule lookup.
    const reentryPoint = computeReentryPosition(dieValue, playerDirection)
    const possibleDestination = Board.getPoints(board).find(
      (p: BackgammonPoint) =>
        // Point must be empty, have only one opponent checker (hit), or have player's own checkers (stacking)
        (p.checkers.length === 0 ||
          (p.checkers.length === 1 && p.checkers[0].color !== player.color) ||
          (p.checkers.length > 0 && p.checkers[0].color === player.color)) &&
        // Point must match the reentry point for the player's direction
        p.position[playerDirection] === reentryPoint
    )

    // DIAGNOSTIC: Log reentry search when tracing is enabled.
    // Guarded for browser bundles — `process` is Node-only.
    if (
      typeof process !== 'undefined' &&
      process.env?.NDBG_AI_TRACE === '1' &&
      !possibleDestination
    ) {
      const allPoints = Board.getPoints(board)
      const targetPoint = allPoints.find((p: BackgammonPoint) => p.position[playerDirection] === reentryPoint)
      console.log(`[CORE][TRACE] Reentry blocked for die ${dieValue}:`, {
        reentryPoint,
        playerDirection,
        targetPointExists: !!targetPoint,
        targetPointCheckers: targetPoint?.checkers?.length ?? 'N/A',
        targetPointCheckerColor: targetPoint?.checkers?.[0]?.color ?? 'N/A',
        targetPointPosCW: targetPoint?.position?.clockwise ?? 'N/A',
        targetPointPosCCW: targetPoint?.position?.counterclockwise ?? 'N/A',
      })
    }

    if (possibleDestination) {
      possibleMoves.push({
        origin: bar,
        destination: possibleDestination,
        dieValue,
        direction: playerDirection,
      })
    }
    return possibleMoves
  }

  // Calculate allCheckersInHome before the loop
  const homeBoardPoints = Board.getPoints(board).filter((p) => {
    const pos = p.position[playerDirection]
    return pos >= 1 && pos <= 6
  })
  const homeBoardPointIds = new Set(homeBoardPoints.map((p) => p.id))
  const allCheckersInHome = playerPoints.every((p) =>
    homeBoardPointIds.has(p.id)
  )

  // Handle both regular point-to-point moves and bearing-off moves
  playerPoints.forEach(function mapPlayerPoints(point) {
    const originPosition = point.position[playerDirection]
    // Compute scalar destination in player's directional coords.
    const destinationPosition = computeDestinationPosition(
      originPosition,
      dieValue,
      playerDirection
    )

    // Handle regular point-to-point moves
    if (destinationPosition >= 1 && destinationPosition <= 24) {
      const possibleDestination = Board.getPoints(board).find(
        (p: BackgammonPoint) =>
          // Point must be empty, have only one opponent checker (hit), or have player's own checkers (stacking)
          (p.checkers.length === 0 ||
            (p.checkers.length === 1 && p.checkers[0].color !== player.color) ||
            (p.checkers.length > 0 && p.checkers[0].color === player.color)) &&
          // Point must match the destination position using the player's direction
          p.position[playerDirection] === destinationPosition
      )

      if (possibleDestination) {
        possibleMoves.push({
          origin: point,
          destination: possibleDestination,
          dieValue,
          direction: playerDirection,
        })
      }
    }

    // Handle bearing-off moves when all checkers are in home board
    if (allCheckersInHome && destinationPosition < 1) {
      // Check for exact bear-off match
      if (originPosition === dieValue) {
        const off = board.off[playerDirection]
        possibleMoves.push({
          origin: point,
          destination: off,
          dieValue,
          direction: playerDirection,
        })
      } else {
        // Higher die rule: check if no checkers exist on higher points
        const checkersOnHigherPoints = playerPoints.some(
          (p) => p.position[playerDirection] > dieValue
        )
        if (!checkersOnHigherPoints) {
          // No checkers on higher points - can bear off from highest point
          const highestPoint = playerPoints.reduce((highest, current) =>
            current.position[playerDirection] > highest.position[playerDirection] ? current : highest
          )
          if (point.id === highestPoint.id) {
            const off = board.off[playerDirection]
            possibleMoves.push({
              origin: point,
              destination: off,
              dieValue,
              direction: playerDirection,
            })
          }
        }
      }
    }
  })

  // Bearing-off logic has been moved into the main loop above

  return possibleMoves
}

/**
 * Enhanced getPossibleMoves that consolidates all three previous functions
 * Always uses intelligent dice switching when possible for optimal move selection
 *
 * @param board - Current board state
 * @param player - Player making the move
 * @param dieValue - Primary die value to try
 * @param otherDieValue - Optional: Other die value for intelligent switching
 * @param origin - Optional: Specific origin for position-specific switching
 * @returns Enhanced result with moves, dice switching info, and backward compatibility
 */
export const getPossibleMoves = function getPossibleMoves(
  board: BackgammonBoard,
  player: BackgammonPlayer,
  dieValue: BackgammonDieValue,
  otherDieValue?: BackgammonDieValue,
  origin?: BackgammonMoveOrigin
): BackgammonMoveSkeleton[] | {
  moves: BackgammonMoveSkeleton[]
  usedDieValue: BackgammonDieValue
  autoSwitched: boolean
  originalDieValue: BackgammonDieValue
} {
  // Backward compatibility: when no otherDieValue provided, return simple array
  if (!otherDieValue) {
    return getBasicPossibleMoves(board, player, dieValue)
  }

  // Position-specific switching when origin is provided
  if (origin) {
    // Get all possible moves for the original die value
    const originalMoves = getBasicPossibleMoves(board, player, dieValue)

    // Check if the specific origin can move with the original die
    const originCanMoveWithOriginalDie = originalMoves.some(
      (move) => move.origin.id === origin.id
    )

    if (originCanMoveWithOriginalDie) {
      // Original die can move from this position, use it
      return {
        moves: originalMoves,
        usedDieValue: dieValue,
        autoSwitched: false,
        originalDieValue: dieValue,
      }
    }

    // Original die cannot move from this position, try the other die
    const alternativeMoves = getBasicPossibleMoves(board, player, otherDieValue)

    // Check if the specific origin can move with the alternative die
    const originCanMoveWithAlternativeDie = alternativeMoves.some(
      (move) => move.origin.id === origin.id
    )

    if (originCanMoveWithAlternativeDie) {
      // Alternative die can move from this position, auto-switch
      debug(
        'Board.getPossibleMoves: Auto-switching dice for position',
        {
          originId: origin.id,
          originalDie: dieValue,
          switchedToDie: otherDieValue,
          movesFound: alternativeMoves.length,
        }
      )
      return {
        moves: alternativeMoves,
        usedDieValue: otherDieValue,
        autoSwitched: true,
        originalDieValue: dieValue,
      }
    }

    // Neither die can move from this position, return original die with no moves
    return {
      moves: originalMoves,
      usedDieValue: dieValue,
      autoSwitched: false,
      originalDieValue: dieValue,
    }
  }

  // Standard intelligent dice switching
  // First try with the original die value
  const originalMoves = getBasicPossibleMoves(board, player, dieValue)

  if (originalMoves.length > 0) {
    // Original die has moves, use it
    return {
      moves: originalMoves,
      usedDieValue: dieValue,
      autoSwitched: false,
      originalDieValue: dieValue,
    }
  }

  // Original die has no moves, try the other die value
  const alternativeMoves = getBasicPossibleMoves(board, player, otherDieValue)

  if (alternativeMoves.length > 0) {
    // Alternative die has moves, use it (automatic dice switching)
    debug(
      'Board.getPossibleMoves: Auto-switching dice',
      {
        originalDie: dieValue,
        switchedToDie: otherDieValue,
        movesFound: alternativeMoves.length,
      }
    )
    return {
      moves: alternativeMoves,
      usedDieValue: otherDieValue,
      autoSwitched: true,
      originalDieValue: dieValue,
    }
  }

  // Neither die value has moves, return empty with original die
  return {
    moves: [],
    usedDieValue: dieValue,
    autoSwitched: false,
    originalDieValue: dieValue,
  }
}

/**
 * @deprecated Use getPossibleMoves(board, player, dieValue, otherDieValue) instead
 * This function is kept for backward compatibility during transition
 */
export const getPossibleMovesWithIntelligentDiceSwitching =
  function getPossibleMovesWithIntelligentDiceSwitching(
    board: BackgammonBoard,
    player: BackgammonPlayer,
    dieValue: BackgammonDieValue,
    otherDieValue: BackgammonDieValue
  ): {
    moves: BackgammonMoveSkeleton[]
    usedDieValue: BackgammonDieValue
    autoSwitched: boolean
    originalDieValue: BackgammonDieValue
  } {
    // Delegate to the enhanced getPossibleMoves function
    const result = getPossibleMoves(board, player, dieValue, otherDieValue)

    // Type assertion safe because we know otherDieValue is provided
    return result as {
      moves: BackgammonMoveSkeleton[]
      usedDieValue: BackgammonDieValue
      autoSwitched: boolean
      originalDieValue: BackgammonDieValue
    }
  }

/**
 * @deprecated Use getPossibleMoves(board, player, dieValue, otherDieValue, origin) instead
 * This function is kept for backward compatibility during transition
 */
export const getPossibleMovesWithPositionSpecificAutoSwitch =
  function getPossibleMovesWithPositionSpecificAutoSwitch(
    board: BackgammonBoard,
    player: BackgammonPlayer,
    origin: BackgammonMoveOrigin,
    dieValue: BackgammonDieValue,
    otherDieValue: BackgammonDieValue
  ): {
    moves: BackgammonMoveSkeleton[]
    usedDieValue: BackgammonDieValue
    autoSwitched: boolean
    originalDieValue: BackgammonDieValue
  } {
    // Delegate to the enhanced getPossibleMoves function with origin
    const result = getPossibleMoves(board, player, dieValue, otherDieValue, origin)

    // Type assertion safe because we know otherDieValue is provided
    return result as {
      moves: BackgammonMoveSkeleton[]
      usedDieValue: BackgammonDieValue
      autoSwitched: boolean
      originalDieValue: BackgammonDieValue
    }
  }
