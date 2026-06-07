import {
  BackgammonBoard,
  BackgammonCheckerContainer,
  BackgammonCube,
  BackgammonDieValue,
  BackgammonMoveCompletedNoMove,
  BackgammonMoveCompletedWithMove,
  BackgammonMoveOrigin,
  BackgammonMoveReady,
  BackgammonMoves,
  BackgammonMoveSkeleton,
  BackgammonPlayerMoving,
  BackgammonPlayerRolling,
  BackgammonPlayMoving,
  BackgammonPlayResult,
  BackgammonPlayStateKind,
} from '@nodots/backgammon-types'
import { Board, generateId } from '..'
import { debug, logger } from '../utils/logger'
import { MustUseBothDiceError, MustUseLargerDieError } from './errors'
export * from '../index'

export interface MoveExecutionOptions {
  readonly desiredDestinationId?: string
  readonly expectedDieValue?: BackgammonDieValue
}

const allowedMoveKinds = ['point-to-point', 'reenter', 'bear-off'] as const
type AllowedMoveKind = (typeof allowedMoveKinds)[number]
function isAllowedMoveKind(kind: any): kind is AllowedMoveKind {
  return allowedMoveKinds.includes(kind)
}

// Pure function types for immutable dice auto-switching
interface MoveExecutionPlan {
  readonly targetMoveId: string
  readonly effectiveDieValue: BackgammonDieValue
  readonly autoSwitched: boolean
  readonly originalDieValue: BackgammonDieValue
  readonly newDiceOrder: readonly [BackgammonDieValue, BackgammonDieValue]
  readonly updatedMoves: ReadonlyArray<BackgammonMoveReady>
  readonly matchingMove: any // The fresh move calculation result
}

interface ExecutionResult {
  readonly newPlay: BackgammonPlayMoving
  readonly newBoard: BackgammonBoard
  readonly completedMove: BackgammonMoveCompletedWithMove
  readonly executionPlan: MoveExecutionPlan
}

// PlayProps is now imported from @nodots/backgammon-types

export class Play {
  id?: string = generateId()
  cube?: BackgammonCube
  stateKind?: BackgammonPlayStateKind
  moves?: BackgammonMoves = []
  board!: BackgammonBoard
  player!: BackgammonPlayerRolling | BackgammonPlayerMoving

  // Pure function: Plan the move execution without mutations
  private static planMoveExecution(
    board: BackgammonBoard,
    play: BackgammonPlayMoving,
    origin: BackgammonMoveOrigin,
    preferredDieValue?: BackgammonDieValue,
    options?: MoveExecutionOptions
  ): MoveExecutionPlan {
    const movesArray = play.moves
    const readyMoves = movesArray.filter((m) => m.stateKind === 'ready')

    if (readyMoves.length === 0) {
      throw new Error('No ready moves available')
    }

    const desiredDestinationId = options?.desiredDestinationId
    const expectedDieValue = options?.expectedDieValue

    // Get initial die values (no mutation)
    // Must-use-larger-die: when one die can be played this turn and more
    // than one die value is still ready, the larger die is the only choice
    // the rules allow. Plays persisted before initialize pruned the
    // smaller-die move (stale plays from the database) still carry both
    // moves as ready — prefer the larger die for them.
    const distinctReadyDice = [...new Set(readyMoves.map((m) => m.dieValue))]
    const largerDieMandatory =
      typeof expectedDieValue !== 'number' &&
      play.maxDiceUsable === 1 &&
      distinctReadyDice.length >= 2
    let firstDieValue =
      expectedDieValue ??
      (largerDieMandatory
        ? distinctReadyDice.reduce((a, b) => (b > a ? b : a))
        : readyMoves[0].dieValue)
    const otherMoves = readyMoves.filter((m) => m.dieValue !== firstDieValue)
    let secondDieValue =
      otherMoves.length > 0 ? otherMoves[0].dieValue : firstDieValue

    // If a preferred die is provided and both dice are distinct, bias order to try it first
    if (
      typeof preferredDieValue === 'number' &&
      preferredDieValue !== firstDieValue &&
      preferredDieValue !== secondDieValue
    ) {
      // no-op when preferred doesn't match either available die
    } else if (
      typeof preferredDieValue === 'number' &&
      preferredDieValue !== firstDieValue
    ) {
      const tmp = firstDieValue
      firstDieValue = preferredDieValue
      secondDieValue = tmp
    }

    // Check for auto-switch opportunity
    const moveResult = (() => {
      // Exact-mode: when a destination or explicit die is provided, avoid auto-switching.
      if (desiredDestinationId || typeof expectedDieValue === 'number') {
        const dieToUse = expectedDieValue ?? firstDieValue
        const moves = Board.getPossibleMoves(
          board,
          play.player,
          dieToUse
        ) as BackgammonMoveSkeleton[]
        const matching = moves.find(
          (pm) =>
            pm.origin.id === origin.id &&
            (!desiredDestinationId || pm.destination.id === desiredDestinationId)
        )
        if (!matching) {
          throw new Error(
            `Invalid move: No legal move from origin ${origin.id} to destination ${desiredDestinationId ?? 'unknown'} with die ${dieToUse}`
          )
        }
        return {
          moves,
          usedDieValue: dieToUse,
          autoSwitched: false,
          originalDieValue: dieToUse,
        }
      }

      return Board.getPossibleMoves(
        board,
        play.player,
        firstDieValue,
        secondDieValue,
        origin
      ) as {
        moves: BackgammonMoveSkeleton[]
        usedDieValue: BackgammonDieValue
        autoSwitched: boolean
        originalDieValue: BackgammonDieValue
      }
    })()

    let matchingMove = moveResult.moves.find(
      (pm) =>
        pm.origin.id === origin.id &&
        (!desiredDestinationId || pm.destination.id === desiredDestinationId)
    )
    if (!matchingMove) {
      throw new Error(
        `Invalid move: No legal moves available from origin ${origin.id}`
      )
    }

    // Prevent duplicate die usage validation (pure check)
    const currentRoll = play.player.dice.currentRoll
    const isDoubles = currentRoll[0] === currentRoll[1]
    const completedMoves = movesArray.filter((m) => m.stateKind === 'completed')
    const alreadyUsedDieValue = completedMoves.some(
      (m) => m.dieValue === moveResult.usedDieValue
    )

    if (!isDoubles && alreadyUsedDieValue) {
      throw new Error(
        `Die value ${moveResult.usedDieValue} has already been used in this turn. Available dice: [${currentRoll.join(', ')}]. This prevents invalid duplicate die usage.`
      )
    }

    // Plan new dice order (pure calculation)
    const deriveNewDiceOrder = (): [BackgammonDieValue, BackgammonDieValue] => {
      if (!Array.isArray(currentRoll) || currentRoll.length !== 2) {
        return [firstDieValue, secondDieValue]
      }
      const [d1, d2] = currentRoll
      if (d1 === d2) return [d1, d2]
      const used = moveResult.usedDieValue
      if (moveResult.autoSwitched && d1 !== d2) {
        return [d2, d1]
      }
      if (used === d1) return [d1, d2]
      if (used === d2) return [d2, d1]
      return [d1, d2]
    }
    const newDiceOrder = deriveNewDiceOrder()

    // Find target move
    // When expectedDieValue is explicitly set (AI/GNU moves), find by origin/destination only
    // The die to consume is determined by expectedDieValue, not the Move's pre-assigned die
    // NO FALLBACKS for AI moves - GNU is GOD
    let targetMove: typeof readyMoves[0] | undefined

    if (typeof expectedDieValue === 'number') {
      // AI move: match by origin and destination only, ignore pre-assigned die
      targetMove = readyMoves.find((m) =>
        m.possibleMoves.some(
          (pm) =>
            pm.origin.id === origin.id &&
            (!desiredDestinationId || pm.destination.id === desiredDestinationId)
        )
      )
      if (!targetMove) {
        // No fallback - throw error with diagnostic info
        throw new Error(
          `[CORE] Cannot execute GNU-planned move: No ready move has origin=${origin.id}` +
          (desiredDestinationId ? ` destination=${desiredDestinationId}` : '') +
          `. expectedDieValue=${expectedDieValue}. Available moves: ${readyMoves.map(m =>
            `die=${m.dieValue}:[${m.possibleMoves.map(pm => pm.origin.id).join(',')}]`
          ).join('; ')}`
        )
      }
    } else {
      // Human move: use original logic with die matching
      targetMove = readyMoves.find(
        (m) =>
          m.dieValue === moveResult.usedDieValue &&
          m.possibleMoves.some(
            (pm) =>
              pm.origin.id === origin.id &&
              (!desiredDestinationId || pm.destination.id === desiredDestinationId)
          )
      )
      if (!targetMove) {
        // For human moves, try relaxing die constraint
        targetMove = readyMoves.find((m) =>
          m.possibleMoves.some(
            (pm) =>
              pm.origin.id === origin.id &&
              (!desiredDestinationId || pm.destination.id === desiredDestinationId)
          )
        )
      }
      if (!targetMove) {
        throw new Error(
          `[CORE] No valid move found for origin=${origin.id}. ` +
          `Available moves: ${readyMoves.map(m =>
            `die=${m.dieValue}:[${m.possibleMoves.map(pm => pm.origin.id).join(',')}]`
          ).join('; ')}`
        )
      }
    }

    // Plan updated moves (pure calculation)
    // CRITICAL FIX: When expectedDieValue differs from targetMove.dieValue,
    // we need to consume the move with the expected die, not the targetMove.
    // This happens when a reentry move has possibleMoves from multiple dice.
    // Example: Die 1's reentry move has bar→24 (die 1) AND bar→21 (die 4).
    // If robot picks bar→21, expectedDieValue=4, but targetMove.dieValue=1.
    // We should consume die 4's move, keeping die 1 available.
    let moveToConsume = targetMove
    if (typeof expectedDieValue === 'number' && expectedDieValue !== targetMove.dieValue) {
      // Find the move that actually has this die value
      const moveWithExpectedDie = readyMoves.find(m => m.dieValue === expectedDieValue)
      if (moveWithExpectedDie) {
        // Consume the move with the expected die value instead
        moveToConsume = moveWithExpectedDie
        debug('Play.planMoveExecution: Die swap - consuming different move', {
          targetMoveDie: targetMove.dieValue,
          expectedDieValue,
          consumingMoveId: moveWithExpectedDie.id,
          consumingMoveDie: moveWithExpectedDie.dieValue,
        })
      }
    }
    const updatedMoves = readyMoves.filter((move) => move.id !== moveToConsume.id)

    debug('Play.planMoveExecution: Planning completed', {
      targetMoveId: targetMove.id,
      consumedMoveId: moveToConsume.id,
      effectiveDieValue: moveResult.usedDieValue,
      autoSwitched: moveResult.autoSwitched,
      originalDieValue: moveResult.originalDieValue,
      newDiceOrder,
      updatedMovesCount: updatedMoves.length,
    })

    // When expectedDieValue is set (AI move), use it as the effective die
    // This ensures GNU's specified die is consumed, not the pre-assigned one
    const finalEffectiveDie = expectedDieValue ?? moveResult.usedDieValue
    return {
      targetMoveId: moveToConsume.id,  // Use the consumed move's ID, not the matched move
      effectiveDieValue: finalEffectiveDie,
      autoSwitched: moveResult.autoSwitched,
      originalDieValue: moveResult.originalDieValue,
      newDiceOrder,
      updatedMoves,
      matchingMove,
    }
  }

  // Pure function: Execute the planned move
  private static executePlannedMove(
    board: BackgammonBoard,
    play: BackgammonPlayMoving,
    plan: MoveExecutionPlan
  ): ExecutionResult {
    // Detect if a hit will occur before executing the move (pure check)
    let isHit = false
    if (plan.matchingMove.destination.kind === 'point') {
      const destination = Board.getCheckerContainer(
        board,
        plan.matchingMove.destination.id
      )
      if (
        destination.kind === 'point' &&
        destination.checkers.length === 1 &&
        destination.checkers[0].color !== play.player.color
      ) {
        isHit = true
        debug('Play.executePlannedMove: Hit detected', {
          destinationId: plan.matchingMove.destination.id,
          hitCheckerColor: destination.checkers[0].color,
          movingPlayerColor: play.player.color,
        })
      }
    }

    // Execute move on board (pure - returns new board)
    const newBoard = Board.moveChecker(
      board,
      plan.matchingMove.origin,
      plan.matchingMove.destination,
      play.player.direction
    )

    // Create completed move (pure)
    const completedMove: BackgammonMoveCompletedWithMove = {
      id: plan.targetMoveId,
      player: play.player,
      dieValue: plan.effectiveDieValue,
      stateKind: 'completed',
      moveKind: isAllowedMoveKind(
        plan.matchingMove.moveKind || 'point-to-point'
      )
        ? plan.matchingMove.moveKind || 'point-to-point'
        : 'point-to-point',
      possibleMoves: [],
      origin: plan.matchingMove.origin,
      destination: plan.matchingMove.destination,
      isHit: isHit,
    }

    // Update remaining moves with fresh possible moves based on new board state
    // CRITICAL: Preserve each move's original die value - don't reassign by index
    // The moves already know what die value they represent from initialization
    const updatedMovesWithCorrectDiceAndMoves = plan.updatedMoves.map(
      (move) => {
        // Use the move's existing die value (already correct from initialization)
        const dieValue = move.dieValue

        // Recalculate possible moves based on new board state
        const freshPossibleMoves = Board.getPossibleMoves(
          newBoard,
          play.player,
          dieValue
        ) as BackgammonMoveSkeleton[]

        if (freshPossibleMoves.length === 0) {
          // No moves possible - convert to completed no-move
          const noMove: BackgammonMoveCompletedNoMove = {
            id: move.id,
            player: move.player,
            dieValue: dieValue,
            stateKind: 'completed',
            moveKind: 'no-move',
            possibleMoves: [],
            isHit: false,
            origin: undefined,
            destination: undefined,
          }
          return noMove
        }

        // Update move with fresh possible moves (keep original die value)
        const firstPossibleMove = freshPossibleMoves[0]
        const updatedMove: BackgammonMoveReady = {
          ...move,
          dieValue: dieValue, // Keep original die value
          possibleMoves: freshPossibleMoves,
          moveKind:
            firstPossibleMove.destination.kind === 'off'
              ? 'bear-off'
              : firstPossibleMove.origin.kind === 'bar'
                ? 'reenter'
                : 'point-to-point',
        }
        return updatedMove
      }
    )

    const finalReadyMoves = updatedMovesWithCorrectDiceAndMoves.filter(
      (m) => m.stateKind === 'ready'
    )

    debug('Play.executePlannedMove: Updated remaining moves', {
      finalReadyMovesCount: finalReadyMoves.length,
      finalReadyDiceValues: finalReadyMoves.map((m) => m.dieValue),
    })

    // Create new play state (pure)
    // CRITICAL FIX: Include ALL existing completed moves (including no-moves from initialization)
    const existingCompletedMoves = play.moves.filter(
      (m) => m.stateKind === 'completed' && m.id !== plan.targetMoveId
    )
    const finalMoves = [
      ...existingCompletedMoves,
      ...updatedMovesWithCorrectDiceAndMoves,
      completedMove,
    ]
    const allMovesCompleted = finalMoves.every(
      (m) => m.stateKind === 'completed'
    )

    // Properly construct the new play object
    const newPlay: BackgammonPlayMoving = {
      ...play,
      moves: finalMoves,
      board: newBoard,
      stateKind: 'moving', // Always return 'moving' - caller handles transition to 'moved'
      player: {
        ...play.player,
        dice: {
          ...play.player.dice,
          currentRoll: [...plan.newDiceOrder] as [
            BackgammonDieValue,
            BackgammonDieValue,
          ],
        },
      },
    }

    debug('Play.executePlannedMove: Execution completed', {
      targetMoveId: plan.targetMoveId,
      newBoardState: 'updated',
      allMovesCompleted,
      finalMovesCount: finalMoves.length,
    })

    return {
      newPlay,
      newBoard,
      completedMove,
      executionPlan: plan,
    }
  }

  // Pure main function: Orchestrates the entire move process
  public static pureMove = function pureMove(
    board: BackgammonBoard,
    play: BackgammonPlayMoving,
    origin: BackgammonMoveOrigin,
    preferredDieValue?: BackgammonDieValue,
    options?: MoveExecutionOptions
  ): BackgammonPlayResult {
    // Handle case where there are no ready moves
    // IMPORTANT: Do NOT collapse the moves array to a single no-move.
    // Preserve existing completed/no-move entries so dice count remains correct.
    const movesArray = play.moves
    const anyReadyMove = movesArray.find((m) => m.stateKind === 'ready')
    if (!anyReadyMove) {
      debug('Play.pureMove: No ready moves found in activePlay.moves — preserving existing moves')

      // If moves already exist (completed/no-move), return them unchanged
      if (Array.isArray(movesArray) && movesArray.length > 0) {
        // Return immutable result with unchanged play/board; pick a representative completed move
        const repMove =
          (movesArray.find((m) => m.stateKind === 'completed') as BackgammonMoveCompletedNoMove) ||
          ({
            id: generateId(),
            player: play.player,
            dieValue: play.player.dice.currentRoll[0],
            stateKind: 'completed',
            moveKind: 'no-move',
            possibleMoves: [],
            isHit: false,
            origin: undefined,
            destination: undefined,
          } as BackgammonMoveCompletedNoMove)
        return {
          play: { ...play },
          board,
          move: repMove,
        } as BackgammonPlayResult
      }

      // If for some reason moves are empty, synthesize per-die no-move entries (2 or 4)
      const roll = play.player.dice.currentRoll
      const isDoubles = roll[0] === roll[1]
      const diceToProcess = isDoubles ? [roll[0], roll[0], roll[0], roll[0]] : [roll[0], roll[1]]
      const synthesized: BackgammonMoveCompletedNoMove[] = diceToProcess.map((dieValue) => ({
        id: generateId(),
        player: play.player,
        dieValue: dieValue,
        stateKind: 'completed',
        moveKind: 'no-move',
        possibleMoves: [],
        isHit: false,
        origin: undefined,
        destination: undefined,
      }))
      return {
        play: { ...play, moves: synthesized },
        board,
        move: synthesized[0],
      } as BackgammonPlayResult
    }

    let plan: MoveExecutionPlan | undefined = undefined
    // Step 1: Plan the execution (pure)

    try {
      plan = Play.planMoveExecution(
        board,
        play,
        origin,
        preferredDieValue,
        options
      )
    } catch (e) {
      throw e
    }

    // Step 2: Execute the plan (pure)
    const result = Play.executePlannedMove(board, play, plan)

    // Step 3: Validate the completed sequence against the turn-start dice budget.
    // The maximum number of dice any legal ordering can use was computed in
    // Play.initialize (play.maxDiceUsable) from the turn-start board. Enforcing
    // it here — once no ready moves remain — guarantees the player used as many
    // dice as the rules require, regardless of which ordering they chose.
    const resultHasReadyMoves = result.newPlay.moves.some(
      (m) => m.stateKind === 'ready'
    )

    if (!resultHasReadyMoves) {
      const maxDiceUsable = play.maxDiceUsable
      const actualDiceUsed = result.newPlay.moves.filter(
        (m) => m.stateKind === 'completed' && m.moveKind !== 'no-move'
      ).length

      // Only enforce when the budget was computed (plays produced by
      // Play.initialize). Guards against undefined for legacy/synthetic plays.
      if (typeof maxDiceUsable === 'number') {
        if (actualDiceUsed < maxDiceUsable) {
          throw MustUseBothDiceError(
            `Must use ${maxDiceUsable} dice when legally possible; only ${actualDiceUsed} used. A legal ordering exists that uses more dice.`
          )
        }

        // Must-use-larger-die rule: when only one die can be used and both were
        // individually playable from the turn-start board, the larger must be used.
        const playableAtStart = play.dieValuesPlayableAtStart ?? []
        if (maxDiceUsable === 1 && actualDiceUsed === 1) {
          const usedMove = result.newPlay.moves.find(
            (m) => m.stateKind === 'completed' && m.moveKind !== 'no-move'
          )
          const distinctPlayable = [...new Set(playableAtStart)]
          if (
            usedMove &&
            distinctPlayable.length >= 2 &&
            usedMove.dieValue < Math.max(...distinctPlayable)
          ) {
            throw MustUseLargerDieError(
              `Must use the larger die (${Math.max(
                ...distinctPlayable
              )}) when only one die can be played; ${usedMove.dieValue} was used.`
            )
          }
        }
      }

      // Update play stateKind to 'moved' when no ready moves remain
      // This preserves all moves including no-moves
      const finalPlay: BackgammonPlayMoving = {
        ...result.newPlay,
        stateKind: 'moved' as any, // Need to cast since 'moved' isn't in BackgammonPlayMoving type
      }

      return {
        play: finalPlay,
        board: result.newBoard,
        move: result.completedMove,
        autoSwitched: plan.autoSwitched,
        originalDieValue: plan.originalDieValue,
        usedDieValue: plan.effectiveDieValue,
      } as BackgammonPlayResult
    }

    // Return immutable result with play still in 'moving' state
    return {
      play: result.newPlay,
      board: result.newBoard,
      move: result.completedMove,
      autoSwitched: plan.autoSwitched,
      originalDieValue: plan.originalDieValue,
      usedDieValue: plan.effectiveDieValue,
    } as BackgammonPlayResult
  }

  public static move = function move(
    board: BackgammonBoard,
    play: BackgammonPlayMoving,
    origin: BackgammonMoveOrigin,
    preferredDieValue?: BackgammonDieValue,
    options?: MoveExecutionOptions
  ): BackgammonPlayResult {
    // Delegate to pure function implementation to fix dice auto-switching bugs
    return Play.pureMove(board, play, origin, preferredDieValue, options)
  }

  // Helper: Partition moves into reentry vs regular based on bar state
  // Creates one reentry move per checker on bar, but includes possibleMoves
  // from ALL dice that can reenter, allowing player to choose which die to use
  private static partitionMovesForBarReentry(
    board: BackgammonBoard,
    player: BackgammonPlayerMoving,
    diceValues: BackgammonDieValue[]
  ): {
    reentryMoves: BackgammonMoveReady[]
    regularDiceValues: BackgammonDieValue[]
  } {
    const bar =
      player.direction === 'clockwise'
        ? board.bar.clockwise
        : board.bar.counterclockwise
    const checkersOnBar = bar.checkers.filter(
      (c) => c.color === player.color
    ).length

    if (checkersOnBar === 0) {
      return { reentryMoves: [], regularDiceValues: diceValues }
    }

    // Collect ALL reentry options from ALL dice
    const allReentryMoves: BackgammonMoveSkeleton[] = []
    const diceUsedForReentry: BackgammonDieValue[] = []
    const regularDiceValues: BackgammonDieValue[] = []

    for (const dieValue of diceValues) {
      const possibleMoves = Board.getPossibleMoves(
        board,
        player,
        dieValue
      ) as BackgammonMoveSkeleton[]

      if (possibleMoves.length > 0 && possibleMoves[0].origin.kind === 'bar') {
        // This die can reenter - collect its moves
        allReentryMoves.push(...possibleMoves)
        diceUsedForReentry.push(dieValue)
      } else {
        // This die cannot reenter
        regularDiceValues.push(dieValue)
      }
    }

    // Create reentry move objects - one per checker on bar
    // Each reentry move includes ALL possible destinations from ALL viable dice
    const reentryMoves: BackgammonMoveReady[] = []
    for (let i = 0; i < Math.min(checkersOnBar, diceUsedForReentry.length); i++) {
      // Use the first viable die as the "default" but include all options
      const primaryDie = diceUsedForReentry[i]
      reentryMoves.push({
        id: generateId(),
        player,
        dieValue: primaryDie,
        stateKind: 'ready',
        moveKind: 'reenter',
        // Include ALL reentry options so robot can pick any die
        possibleMoves: allReentryMoves,
      })
    }

    // Remaining dice that could reenter but aren't needed go to regular
    for (let i = checkersOnBar; i < diceUsedForReentry.length; i++) {
      regularDiceValues.push(diceUsedForReentry[i])
    }

    return { reentryMoves, regularDiceValues }
  }

  // Helper: Simulate executing moves on a board
  private static simulateMoves(
    board: BackgammonBoard,
    moves: BackgammonMoveReady[],
    direction: 'clockwise' | 'counterclockwise'
  ): BackgammonBoard {
    let simulatedBoard = board

    for (const move of moves) {
      if (move.possibleMoves.length > 0) {
        const firstMove = move.possibleMoves[0]
        simulatedBoard = Board.moveChecker(
          simulatedBoard,
          firstMove.origin,
          firstMove.destination,
          direction
        )
      }
    }

    return simulatedBoard
  }

  // Helper: Create moves for given dice values on given board
  // CRITICAL FIX: For non-doubles, don't mark a die as no-move if playing the other die first
  // might open up moves for it. This implements backgammon's "use both dice if possible" rule.
  private static createMovesForDiceValues(
    board: BackgammonBoard,
    player: BackgammonPlayerMoving,
    diceValues: BackgammonDieValue[]
  ): Array<BackgammonMoveReady | BackgammonMoveCompletedNoMove> {
    const isDoubles = diceValues.length > 2 ||
      (diceValues.length === 2 && diceValues[0] === diceValues[1])

    // First pass: calculate possibleMoves for each die on current board
    const initialMoves = diceValues.map((dieValue) => {
      const possibleMoves = Board.getPossibleMoves(
        board,
        player,
        dieValue
      ) as BackgammonMoveSkeleton[]
      return { dieValue, possibleMoves }
    })

    // For non-doubles, check sequence-dependent moves:
    // If die A has moves but die B doesn't, check if playing die A first opens moves for die B
    if (!isDoubles && diceValues.length === 2) {
      const [die1Info, die2Info] = initialMoves

      // Check if die1 has moves but die2 doesn't - would playing die1 first open moves for die2?
      if (die1Info.possibleMoves.length > 0 && die2Info.possibleMoves.length === 0) {
        const couldOpenMoves = Play.checkIfDieOpensMovesForOther(
          board, player, die1Info.dieValue, die2Info.dieValue, die1Info.possibleMoves
        )
        if (couldOpenMoves) {
          // Keep die2 as ready with empty possibleMoves - it will be recalculated after die1 is played
          debug('Play.createMovesForDiceValues: Die', die1Info.dieValue,
            'can open moves for die', die2Info.dieValue, '- keeping as ready')
          // Mark die2 as potentially playable
          initialMoves[1] = { ...die2Info, possibleMoves: [] as BackgammonMoveSkeleton[], keepAsReady: true } as any
        }
      }

      // Check the reverse: die2 has moves but die1 doesn't
      if (die2Info.possibleMoves.length > 0 && die1Info.possibleMoves.length === 0) {
        const couldOpenMoves = Play.checkIfDieOpensMovesForOther(
          board, player, die2Info.dieValue, die1Info.dieValue, die2Info.possibleMoves
        )
        if (couldOpenMoves) {
          debug('Play.createMovesForDiceValues: Die', die2Info.dieValue,
            'can open moves for die', die1Info.dieValue, '- keeping as ready')
          initialMoves[0] = { ...die1Info, possibleMoves: [] as BackgammonMoveSkeleton[], keepAsReady: true } as any
        }
      }
    }

    // Second pass: convert to Move objects
    return initialMoves.map((moveInfo) => {
      const { dieValue, possibleMoves } = moveInfo
      const keepAsReady = (moveInfo as any).keepAsReady === true

      if (possibleMoves.length === 0 && !keepAsReady) {
        return {
          id: generateId(),
          player,
          dieValue,
          stateKind: 'completed',
          moveKind: 'no-move',
          possibleMoves: [],
          origin: undefined,
          destination: undefined,
          isHit: false,
        } as BackgammonMoveCompletedNoMove
      }

      // For sequence-dependent moves, keep as ready even with empty possibleMoves
      // possibleMoves will be recalculated after the first die is played
      const firstMove = possibleMoves[0]
      const moveKind = possibleMoves.length === 0
        ? 'point-to-point'
        : firstMove.destination.kind === 'off'
          ? 'bear-off'
          : firstMove.origin.kind === 'bar'
            ? 'reenter'
            : 'point-to-point'

      const move = {
        id: generateId(),
        player,
        dieValue,
        stateKind: 'ready',
        moveKind,
        possibleMoves,
      } as BackgammonMoveReady
      if (keepAsReady) {
        (move as any)._sequenceDependent = true
      }
      return move
    })
  }

  // Helper: Check if playing one die first would open up moves for another die
  // This is used to detect sequence-dependent moves (e.g., 6-3 where only 6 is playable
  // initially, but playing 6 first opens a move for the 3)
  private static checkIfDieOpensMovesForOther(
    board: BackgammonBoard,
    player: BackgammonPlayerMoving,
    playableDie: BackgammonDieValue,
    blockedDie: BackgammonDieValue,
    playableMoves: BackgammonMoveSkeleton[]
  ): boolean {
    // Try each possible move with the playable die and check if it opens moves for the blocked die
    for (const move of playableMoves) {
      try {
        // Simulate the move
        const boardAfterMove = Board.moveChecker(
          board,
          move.origin,
          move.destination,
          player.direction
        )

        // Check if the blocked die now has moves
        const newPossibleMoves = Board.getPossibleMoves(
          boardAfterMove,
          player,
          blockedDie
        ) as BackgammonMoveSkeleton[]

        if (newPossibleMoves.length > 0) {
          return true // Found a sequence that uses both dice
        }
      } catch {
        // Move simulation failed, skip this option
        continue
      }
    }
    return false
  }

  public static initialize = function initialize(
    board: BackgammonBoard,
    player: BackgammonPlayerMoving
  ): BackgammonPlayMoving {
    const roll = player.dice.currentRoll
    const isDoubles = roll[0] === roll[1]
    const diceToProcess = isDoubles
      ? [roll[0], roll[0], roll[0], roll[0]]
      : [roll[0], roll[1]]

    // Step 1: Separate bar reentry moves from regular moves
    const { reentryMoves, regularDiceValues } =
      Play.partitionMovesForBarReentry(board, player, diceToProcess)

    // Step 2: Create simulated board after all reentries
    const boardAfterReentries = Play.simulateMoves(
      board,
      reentryMoves,
      player.direction
    )

    // Step 3: Create regular moves using simulated board
    const regularMoves = Play.createMovesForDiceValues(
      boardAfterReentries,
      player,
      regularDiceValues
    )

    // Step 4: Combine all moves
    const allMoves = [...reentryMoves, ...regularMoves]

    // Step 5: Compute the maximum number of dice any legal ordering can use,
    // measured from the turn-start board. This is the authoritative target for
    // the must-use-both-dice / must-use-larger-die rules, enforced later in
    // pureMove. Reentries are mandatory and consume one die each; regular dice
    // are explored against the post-reentry board (matching how their
    // possibleMoves were derived above) across both orderings.
    const playableReentries = reentryMoves.filter(
      (m) => m.moveKind !== 'no-move'
    ).length

    const regularPlay = {
      id: generateId(),
      board: boardAfterReentries,
      player,
      moves: regularMoves,
      stateKind: 'moving',
    } as BackgammonPlayMoving

    const distinctRegular = [...new Set(regularDiceValues)]
    let maxFromRegular = 0
    if (regularDiceValues.length > 0) {
      maxFromRegular =
        distinctRegular.length >= 2
          ? Math.max(
              Play.testSequenceDiceUsage(boardAfterReentries, regularPlay, [
                distinctRegular[0],
                distinctRegular[1],
              ]),
              Play.testSequenceDiceUsage(boardAfterReentries, regularPlay, [
                distinctRegular[1],
                distinctRegular[0],
              ])
            )
          : // Single value: doubles (2-4 same dice) or one leftover regular die
            Play.testSequenceDiceUsage(
              boardAfterReentries,
              regularPlay,
              regularDiceValues
            )
    }

    const maxDiceUsable = playableReentries + maxFromRegular
    const dieValuesPlayableAtStart = [
      ...new Set(
        allMoves
          .filter(
            (m) =>
              Array.isArray((m as BackgammonMoveReady).possibleMoves) &&
              (m as BackgammonMoveReady).possibleMoves.length > 0
          )
          .map((m) => m.dieValue)
      ),
    ] as BackgammonDieValue[]

    // Must-use-larger-die rule, applied at turn start: when one die can be
    // played this turn and both dice had moves from the turn-start board,
    // the rules require the larger die. pureMove rejects the smaller die
    // after execution; converting its move to a completed no-move here means
    // the option is never offered to humans or robots. Production game
    // 2d98cf14: one checker on the 2-point, roll [3,5] — either die bears
    // off, the robot picked 3 and every turn attempt was rejected.
    if (
      maxDiceUsable === 1 &&
      dieValuesPlayableAtStart.length >= 2 &&
      playableReentries === 0
    ) {
      const largerDie = dieValuesPlayableAtStart.reduce((a, b) =>
        b > a ? b : a
      )
      for (let i = 0; i < allMoves.length; i++) {
        const move = allMoves[i]
        if (
          move.stateKind === 'ready' &&
          move.dieValue !== largerDie &&
          // cast: _sequenceDependent is a private marker set above, not on the move type
          !(move as any)._sequenceDependent
        ) {
          allMoves[i] = {
            id: move.id,
            player,
            dieValue: move.dieValue,
            stateKind: 'completed',
            moveKind: 'no-move',
            possibleMoves: [],
            origin: undefined,
            destination: undefined,
            isHit: false,
            // cast: literal matches the no-move constructions elsewhere in this function
          } as BackgammonMoveCompletedNoMove
        }
      }
    }

    // Check if all moves are no-moves and auto-complete the play
    const allMovesAreNoMoves = allMoves.every(
      (move) => move.moveKind === 'no-move'
    )

    if (allMovesAreNoMoves) {
      debug(
        'Play.initialize: Auto-completing play - no legal moves available for any die value'
      )

      // Convert all moves to completed no-moves
      const completedMoves = allMoves.map((move) => ({
        ...move,
        stateKind: 'completed' as const,
        moveKind: 'no-move' as const,
        possibleMoves: [],
        isHit: false,
        origin: undefined,
        destination: undefined,
      }))

      return {
        id: generateId(),
        board,
        player,
        moves: completedMoves,
        stateKind: 'moving',
        maxDiceUsable,
        dieValuesPlayableAtStart,
      } as BackgammonPlayMoving
    }

    // Guard: ensure we have exactly one move per die (or four for doubles)
    const expectedCount = diceToProcess.length
    if (allMoves.length !== expectedCount) {
      debug('Play.initialize: Normalizing moves to expected count', {
        have: allMoves.length,
        expected: expectedCount,
        roll,
      })

      // Count current occurrences by die value
      const counts = new Map<number, number>()
      for (const mv of allMoves) {
        counts.set(mv.dieValue, (counts.get(mv.dieValue) || 0) + 1)
      }

      // Build target counts from diceToProcess
      const targetCounts = new Map<number, number>()
      diceToProcess.forEach((d) => targetCounts.set(d, (targetCounts.get(d) || 0) + 1))

      // For any shortfall, add completed no-move entries
      const normalized = [...allMoves]
      for (const [dieValue, target] of targetCounts.entries()) {
        const have = counts.get(dieValue) || 0
        for (let i = have; i < target; i++) {
          normalized.push({
            id: generateId(),
            player,
            dieValue: dieValue as any,
            stateKind: 'completed',
            moveKind: 'no-move',
            possibleMoves: [],
            origin: undefined,
            destination: undefined,
            isHit: false,
          } as BackgammonMoveCompletedNoMove)
        }
      }

      return {
        id: generateId(),
        board,
        player,
        moves: normalized,
        stateKind: 'moving',
        maxDiceUsable,
        dieValuesPlayableAtStart,
      } as BackgammonPlayMoving
    }

    return {
      id: generateId(),
      board,
      player,
      moves: allMoves,
      stateKind: 'moving',
      maxDiceUsable,
      dieValuesPlayableAtStart,
    } as BackgammonPlayMoving
  }

  public static startMove = function startMove(
    play: BackgammonPlayMoving
  ): BackgammonPlayMoving {
    logger.debug('[Play] Starting move:', {
      playId: play.id,
      playerColor: play.player.color,
      playerState: play.player.stateKind,
      movesCount: play.moves.length,
      stateKind: play.stateKind,
    })
    return {
      ...play,
      stateKind: 'moving',
      player: { ...play.player, stateKind: 'moving' },
      moves: [...play.moves],
    } as BackgammonPlayMoving
  }

  /**
   * Validates if a move from the specified origin is legal
   * Returns true if the origin has valid moves, false otherwise
   * This is a defensive check to prevent invalid move attempts
   */
  static canMoveFrom(
    play: BackgammonPlayMoving,
    board: BackgammonBoard,
    origin: BackgammonCheckerContainer
  ): boolean {
    // Check if play is active and has moves
    if (!play || !play.moves || play.moves.length === 0) {
      debug('Play.canMoveFrom: No active play or moves')
      return false
    }

    // Check if any moves are ready
    const movesArray = play.moves
    const readyMoves = movesArray.filter((m) => m.stateKind === 'ready')
    if (readyMoves.length === 0) {
      debug('Play.canMoveFrom: No ready moves available')
      return false
    }

    // Get fresh possible moves with intelligent dice switching
    const dieValue = readyMoves[0].dieValue
    const otherReadyMoves = readyMoves.filter((m) => m.dieValue !== dieValue)
    const otherDieValue =
      otherReadyMoves.length > 0 ? otherReadyMoves[0].dieValue : dieValue

    const moveResult = Board.getPossibleMoves(
      board,
      play.player,
      dieValue,
      otherDieValue
    ) as {
      moves: BackgammonMoveSkeleton[]
      usedDieValue: BackgammonDieValue
      autoSwitched: boolean
      originalDieValue: BackgammonDieValue
    }

    // Check if the origin has any valid moves
    const hasValidMove = moveResult.moves.some((m) => m.origin.id === origin.id)

    debug('Play.canMoveFrom: Validation result', {
      originId: origin.id,
      hasValidMove,
      validOrigins: moveResult.moves.map((m) => m.origin.id),
    })

    return hasValidMove
  }

  /**
   * Returns the list of valid origin container IDs that have legal moves
   * This can be used by UI to highlight or enable only valid checkers
   */
  static getValidOrigins(
    play: BackgammonPlayMoving,
    board: BackgammonBoard
  ): string[] {
    // Check if play is active and has moves
    if (!play || !play.moves || play.moves.length === 0) {
      return []
    }

    // Check if any moves are ready
    const movesArray = play.moves
    const readyMoves = movesArray.filter((m) => m.stateKind === 'ready')
    if (readyMoves.length === 0) {
      return []
    }

    // Get fresh possible moves with intelligent dice switching
    const dieValue = readyMoves[0].dieValue
    const otherReadyMoves = readyMoves.filter((m) => m.dieValue !== dieValue)
    const otherDieValue =
      otherReadyMoves.length > 0 ? otherReadyMoves[0].dieValue : dieValue

    const moveResult = Board.getPossibleMoves(
      board,
      play.player,
      dieValue,
      otherDieValue
    ) as {
      moves: BackgammonMoveSkeleton[]
      usedDieValue: BackgammonDieValue
      autoSwitched: boolean
      originalDieValue: BackgammonDieValue
    }

    // Return unique origin IDs
    const uniqueOrigins = new Set(moveResult.moves.map((m) => m.origin.id))
    return Array.from(uniqueOrigins)
  }

  /**
   * Validates if a move sequence violates mandatory dice usage rules
   * According to backgammon rules:
   * 1. A player MUST use both dice if legally possible
   * 2. If only one die can be used, the player MUST use the larger value if possible
   * 3. A player cannot voluntarily forfeit the use of a die if there's a legal move
   */
  static validateMoveSequence(
    board: BackgammonBoard,
    play: BackgammonPlayMoving
  ): { isValid: boolean; error?: string; alternativeSequences?: any[] } {
    if (!play.moves || play.moves.length === 0) {
      return { isValid: true }
    }

    const movesArray = play.moves

    // Get completed and ready moves from the current sequence
    const completedMoves = movesArray.filter((m) => m.stateKind === 'completed')
    const readyMoves = movesArray.filter((m) => m.stateKind === 'ready')

    // If there are still ready moves, the sequence is not complete yet
    if (readyMoves.length > 0) {
      return { isValid: true } // Validation happens when sequence is complete
    }

    // All moves are completed - validate the sequence
    const nonNoMoves = completedMoves.filter((m) => m.moveKind !== 'no-move')
    const noMoves = completedMoves.filter((m) => m.moveKind === 'no-move')

    // If all moves were used (no no-moves), the sequence is valid
    if (noMoves.length === 0) {
      return { isValid: true }
    }

    // Check if there was an alternative sequence that would use more dice
    const alternativeSequences = Play.findAlternativeSequences(board, play)

    const currentDiceUsed = nonNoMoves.length
    const maxPossibleDiceUsed = Math.max(
      currentDiceUsed,
      ...alternativeSequences.map((seq) => seq.diceUsed)
    )

    // Rule violation: alternative sequence could use more dice
    if (maxPossibleDiceUsed > currentDiceUsed) {
      const betterSequence = alternativeSequences.find(
        (seq) => seq.diceUsed === maxPossibleDiceUsed
      )

      if (maxPossibleDiceUsed === 2 && currentDiceUsed === 1) {
        return {
          isValid: false,
          error: 'Must use both dice when legally possible',
          alternativeSequences: [betterSequence],
        }
      } else if (currentDiceUsed === 1) {
        // Check if larger die could have been used
        const completedMove = nonNoMoves[0]
        const availableDice = movesArray.map((m) => m.dieValue)
        const largerDie = Math.max(...availableDice)

        if (completedMove.dieValue < largerDie) {
          return {
            isValid: false,
            error: 'Must use larger die when only one die can be used',
            alternativeSequences: [betterSequence],
          }
        }
      }
    }

    return { isValid: true }
  }

  /**
   * Determines if both dice can be legally used from the current board state
   * Analyzes all possible move sequences using activePlay.moves
   */
  static canUseBothDice(
    board: BackgammonBoard,
    play: BackgammonPlayMoving
  ): boolean {
    if (!play.moves || play.moves.length === 0) {
      return false
    }

    const movesArray = play.moves
    const readyMoves = movesArray.filter((m) => m.stateKind === 'ready')

    // Need at least 2 ready moves to use both dice
    if (readyMoves.length < 2) {
      return false
    }

    // Get unique die values from ready moves
    const dieValues = [...new Set(readyMoves.map((m) => m.dieValue))]

    // For doubles, we might have 4 moves with same die value
    if (dieValues.length === 1) {
      // Check if at least 2 moves have possibleMoves
      return (
        readyMoves.filter((m) => m.possibleMoves && m.possibleMoves.length > 0)
          .length >= 2
      )
    }

    // For mixed rolls, check if moves exist for both die values
    return dieValues.every((dieValue) => {
      const movesForDie = readyMoves.filter((m) => m.dieValue === dieValue)
      return movesForDie.some(
        (m) => m.possibleMoves && m.possibleMoves.length > 0
      )
    })
  }

  /**
   * Finds alternative move sequences that could use more dice
   * Uses activePlay.moves structure to simulate different sequences
   */
  static findAlternativeSequences(
    board: BackgammonBoard,
    play: BackgammonPlayMoving
  ): Array<{ sequence: any[]; diceUsed: number }> {
    if (!play.moves || play.moves.length === 0) {
      return []
    }

    const movesArray = play.moves
    const allSequences: Array<{ sequence: any[]; diceUsed: number }> = []

    // CRITICAL FIX: Actually test both dice usage by trying all possible move sequences
    // This replaces the incomplete stub implementation that caused the validation bug

    // Get all unique dice values from the moves
    const diceValues = movesArray
      .map((m) => m.dieValue)
      .filter((v, i, arr) => arr.indexOf(v) === i)

    if (diceValues.length >= 2) {
      // Test both possible orders: first die then second die, and second die then first die
      const maxUsable1 = this.testSequenceDiceUsage(board, play, [
        diceValues[0],
        diceValues[1],
      ])
      const maxUsable2 = this.testSequenceDiceUsage(board, play, [
        diceValues[1],
        diceValues[0],
      ])

      if (maxUsable1 > 0) {
        allSequences.push({ sequence: [], diceUsed: maxUsable1 })
      }
      if (maxUsable2 > 0 && maxUsable2 !== maxUsable1) {
        allSequences.push({ sequence: [], diceUsed: maxUsable2 })
      }
    } else if (diceValues.length === 1) {
      // Doubles case - test how many of the same die can be used
      const doublesUsable = this.testSequenceDiceUsage(board, play, [
        diceValues[0],
        diceValues[0],
        diceValues[0],
        diceValues[0],
      ])
      if (doublesUsable > 0) {
        allSequences.push({ sequence: [], diceUsed: doublesUsable })
      }
    }

    return allSequences
  }

  /**
   * Test how many dice can actually be used by trying to execute moves in sequence
   * This is the proper implementation that was missing, causing validation to fail
   */
  private static testSequenceDiceUsage(
    board: BackgammonBoard,
    play: BackgammonPlayMoving,
    diceSequence: BackgammonDieValue[]
  ): number {
    const clonePlay = (
      sourcePlay: BackgammonPlayMoving
    ): BackgammonPlayMoving => {
      return JSON.parse(JSON.stringify(sourcePlay))
    }

    const cloneBoard = (sourceBoard: BackgammonBoard): BackgammonBoard => {
      return JSON.parse(JSON.stringify(sourceBoard))
    }

    const exploreSequence = (
      currentBoard: BackgammonBoard,
      currentPlay: BackgammonPlayMoving,
      remainingDice: BackgammonDieValue[]
    ): number => {
      if (remainingDice.length === 0) {
        return 0
      }

      let maxDiceUsed = 0
      const [currentDie, ...restDice] = remainingDice

      const movesArray = currentPlay.moves
      const readyMoves = movesArray.filter(
        (m) =>
          m.stateKind === 'ready' &&
          m.dieValue === currentDie &&
          Array.isArray(m.possibleMoves) &&
          m.possibleMoves.length > 0
      )

      if (readyMoves.length === 0) {
        return 0
      }

      for (const readyMove of readyMoves) {
        const possibleMoves =
          readyMove.possibleMoves as BackgammonMoveSkeleton[]

        for (const moveSkeleton of possibleMoves) {
          if (!moveSkeleton.origin?.id) {
            continue
          }

          try {
            const boardClone = cloneBoard(currentBoard)
            const playClone = clonePlay(currentPlay)

            const originOnCloneCandidate = Board.getCheckerContainer(
              boardClone,
              moveSkeleton.origin.id
            )

            if (
              originOnCloneCandidate.kind !== 'point' &&
              originOnCloneCandidate.kind !== 'bar'
            ) {
              continue
            }

            const originOnClone = originOnCloneCandidate as BackgammonMoveOrigin

            const moveResult = Play.pureMove(
              boardClone,
              playClone,
              originOnClone
            )
            const nextPlay = moveResult.play as BackgammonPlayMoving
            const nextBoard = moveResult.board

            const diceUsedInBranch =
              1 + exploreSequence(nextBoard, nextPlay, restDice)

            if (diceUsedInBranch > maxDiceUsed) {
              maxDiceUsed = diceUsedInBranch

              if (maxDiceUsed === remainingDice.length) {
                return maxDiceUsed
              }
            }
          } catch (error) {
            // Ignore branches that fail due to invalid simulated moves
            continue
          }
        }
      }

      return maxDiceUsed
    }

    const startingBoard = cloneBoard(board)
    const startingPlay = clonePlay(play)

    return exploreSequence(startingBoard, startingPlay, diceSequence.slice())
  }

  /**
   * Returns the mandatory move sequence when backgammon rules dictate a specific sequence
   * This enforces rules like "must use both dice" and "must use larger die"
   */
  static getMandatoryMoveSequence(
    board: BackgammonBoard,
    play: BackgammonPlayMoving
  ): { isMandatory: boolean; sequence?: any[]; reason?: string } {
    // FIX: Only validate when sequence is complete (no ready moves)
    // This prevents validation of incomplete sequences, matching pureMove() behavior
    const hasReadyMoves = play.moves.some((m) => m.stateKind === 'ready')
    if (hasReadyMoves) {
      return { isMandatory: false } // Don't validate incomplete sequences
    }

    const validation = Play.validateMoveSequence(board, play)

    if (validation.isValid) {
      return { isMandatory: false }
    }

    // Return the alternative sequence that uses more dice
    if (
      validation.alternativeSequences &&
      validation.alternativeSequences.length > 0
    ) {
      return {
        isMandatory: true,
        sequence: validation.alternativeSequences[0].sequence,
        reason: validation.error,
      }
    }

    return { isMandatory: false }
  }
}
