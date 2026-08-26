import { BackgammonColor, BackgammonGame, BackgammonMoveDirection } from '@nodots/backgammon-types'
import type { MoveHint, MoveStep } from '@nodots/gnubg-hints'
import { exportToGnuPositionId } from '../Board/gnuPositionId'
import { logger } from '../utils/logger'

// AI module interface for dependency injection
export interface AiModuleInterface {
  gnubgHints: {
    isAvailable: () => Promise<boolean>
    getBuildInstructions: () => string
    // The engine config is a mutable process-global shared with robot turn
    // execution; analysis must be able to re-assert its own config per run.
    configure?: (config: {
      evalPlies?: number
      moveFilter?: number
      usePruning?: boolean
      noise?: number
    }) => void | Promise<void>
    getMoveHints: (request: any, maxHints?: number) => Promise<MoveHint[]>
    // Prefer positionId-based hints when available to match robot path
    getHintsFromPositionId?: (
      positionId: string,
      dice: [number, number],
      maxHints?: number,
      activePlayerDirection?: BackgammonMoveDirection,
      activePlayerColor?: BackgammonColor,
    ) => Promise<MoveHint[]>
  }
  buildHintContextFromGame: (game: BackgammonGame, overrides?: any) => {
    request: any
  }
}

// Engine settings PR analysis runs at, independent of any robot's skill
// config. 2-ply, deterministic, with the widest move filter (numeric value of
// MoveFilterSetting.Huge — not imported to keep @nodots/gnubg-hints a
// type-only dependency). Matches what the api's pr routes have historically
// configured.
export const ANALYSIS_HINTS_CONFIG = {
  evalPlies: 2,
  moveFilter: 4,
  usePruning: true,
  noise: 0,
} as const

// Lazy-loaded ai module reference
let aiModule: AiModuleInterface | null = null

async function getAiModule(): Promise<AiModuleInterface> {
  if (!aiModule) {
    // Dynamic import with string indirection to prevent TypeScript from resolving at compile time
    const moduleName = '@nodots/backgammon-ai'
    const ai = await (Function('m', 'return import(m)')(moduleName) as Promise<any>)
    // Ensure shared config is initialized once
    try {
      if (typeof ai.initializeGnubgHints === 'function' && ai.DEFAULT_HINTS_CONFIG) {
        await ai.initializeGnubgHints({ config: ai.DEFAULT_HINTS_CONFIG })
      }
    } catch {}
    aiModule = {
      gnubgHints: ai.gnubgHints,
      buildHintContextFromGame: ai.buildHintContextFromGame,
    }
  }
  return aiModule
}

// Allow tests to inject a mock ai module
export function setAiModuleForTesting(module: AiModuleInterface | null): void {
  aiModule = module
}

export interface PRMoveAnalysis {
  player: string
  moveNumber: number
  positionId: string
  moveExecuted: string
  bestMove: string
  equityLoss: number
  errorType: 'none' | 'doubtful' | 'error' | 'blunder' | 'very_bad'
  matchedRank?: number | null
  matchStrategy?: 'ordered' | 'unordered' | 'alt-ordered' | 'alt-unordered' | 'final-board' | 'prefix' | 'subset' | 'worst'
}

export interface PlayerPR {
  player: string
  totalMoves: number
  analyzedMoves: number
  totalEquityLoss: number
  errors: {
    doubtful: number
    error: number
    blunder: number
    veryBad: number
  }
  averageEquityLoss: number
  performanceRating: number
  // Matching diagnostics (optional; populated when available)
  matchedRank1?: number
  matchedRank2?: number
  matchedRank3Plus?: number
  fallbackWorst?: number
  matchOrdered?: number
  matchUnordered?: number
  matchAltOrdered?: number
  matchAltUnordered?: number
  matchFinalBoard?: number
}

export interface PRCalculationResult {
  gameId: string
  playerResults: Record<string, PlayerPR>
  analysisComplete: boolean
  error?: string
}

interface ExecutedMoveStep extends MoveStep {}

export class PerformanceRatingCalculator {
  constructor() {}

  private resolveDiceOrThrow(
    state: BackgammonGame,
    playerId: string
  ): [number, number] {
    const rollFromActivePlay = (state as any)?.activePlay?.player?.dice
      ?.currentRoll
    if (Array.isArray(rollFromActivePlay) && rollFromActivePlay.length === 2) {
      return [
        rollFromActivePlay[0] ?? 0,
        rollFromActivePlay[1] ?? 0,
      ] as [number, number]
    }

    const players = (state as any)?.players || []
    const match = players.find(
      (p: any) => p?.userId === playerId || p?.id === playerId
    )
    const rollFromPlayer = match?.dice?.currentRoll
    if (Array.isArray(rollFromPlayer) && rollFromPlayer.length === 2) {
      return [rollFromPlayer[0] ?? 0, rollFromPlayer[1] ?? 0] as [number, number]
    }

    throw new Error(
      `Missing dice for player ${playerId} in game state ${state?.id || ''}`
    )
  }

  /**
   * Calculate Performance Rating for all players in a game
   */
  async calculateGamePR(
    gameId: string,
    gameStates: BackgammonGame[],
    moveActions: Array<{ player: string, move: any, dice?: number[] }>
  ): Promise<PRCalculationResult> {
    try {
      logger.info(`Starting PR calculation for game ${gameId}`)

      const ai = await getAiModule()
      const isAvailable = await ai.gnubgHints.isAvailable()
      if (!isAvailable) {
        throw new Error(
          `${ai.gnubgHints.getBuildInstructions()}\n\nGNU Backgammon hints are required for performance rating analysis.`
        )
      }

      // Re-assert the analysis config for every run. The engine config is a
      // process-global that robot turns overwrite with per-robot skill
      // settings; without this, a game against "GNU Beginner" would be
      // analyzed at the robot's weakened settings (or the robot's play
      // analyzed by the exact engine call that chose it, yielding PR 0.0).
      // The config must be complete — partial configs merge into whatever
      // the previous caller left behind.
      await ai.gnubgHints.configure?.(ANALYSIS_HINTS_CONFIG)

      const playerStats: Record<string, PlayerPR> = {}

      // Group consecutive actions into full-turn sequences by (player, dice)
      let i = 0
      let turnIndex = 0
      while (i < moveActions.length) {
        const start = i
        const head = moveActions[i]
        const startState = gameStates[i]
        if (!startState) {
          throw new Error(
            `calculateGamePR: no game state for action index ${i}. ` +
            `Game ${gameId}, totalStates=${gameStates.length}, totalActions=${moveActions.length}`
          )
        }

        // Ensure stats bucket exists
        if (!playerStats[head.player]) {
          playerStats[head.player] = {
            player: head.player,
            totalMoves: 0,
            analyzedMoves: 0,
            totalEquityLoss: 0,
            errors: { doubtful: 0, error: 0, blunder: 0, veryBad: 0 },
            averageEquityLoss: 0,
            performanceRating: 0,
          }
        }
        playerStats[head.player].totalMoves++

        // Group contiguous actions for the same player into one turn.
        // Turn boundaries are detected by:
        // 1. Dice change (sorted to ignore order swaps like [3,6] vs [6,3])
        // 2. Move count exceeds what the dice allow (non-doubles: 2, doubles: 4)
        const headDiceKey = this.sortedDiceKey(head.dice)
        const isDoubles = Array.isArray(head.dice) && head.dice.length >= 2 && head.dice[0] === head.dice[1]
        const maxMovesForDice = isDoubles ? 4 : 2
        let j = i
        while (j + 1 < moveActions.length && moveActions[j + 1].player === head.player) {
          const nextDiceKey = this.sortedDiceKey(moveActions[j + 1].dice)
          if (headDiceKey !== null && nextDiceKey !== null && headDiceKey !== nextDiceKey) {
            break
          }
          // A single turn can't have more moves than the dice allow
          if (j + 1 - start >= maxMovesForDice) {
            break
          }
          j += 1
        }

        // Resolve dice for this turn. The dice come from extractStatesAndMoves
        // which uses lastDiceByPlayer (populated from roll-dice history actions).
        // With the engine fix for rolling->moved transitions, every turn has a
        // properly recorded roll-dice action.
        let diceTuple: [number, number]
        if (Array.isArray(head.dice) && head.dice.length >= 2) {
          diceTuple = [head.dice[0], head.dice[1]]
        } else {
          try {
            diceTuple = this.resolveDiceOrThrow(startState, head.player)
          } catch (err) {
            throw new Error(
              `PR: missing dice for player ${head.player} at turn ${turnIndex + 1}: ${String(err)}`
            )
          }
        }

        logger.info(
          `Analyzing turn ${turnIndex + 1} by ${head.player} (actions ${start}..${j}, dice=${diceTuple})`
        )

        try {
          let turnAnalysis = await this.analyzeTurnWithGnuBG(
            startState,
            diceTuple,
            moveActions.slice(start, j + 1),
            head.player,
            turnIndex + 1,
          )

          // Fallback: if full-turn analysis fails (e.g., no exact sequence match or hint retrieval issue),
          // attempt per-move analysis and aggregate equity losses to avoid dropping the turn entirely.
          if (!turnAnalysis) {
            let aggLoss = 0
            let anyAnalyzed = false
            for (let k = start; k <= j; k++) {
              const stepAnalysis = await this.analyzeMoveWithGnuBG(
                gameStates[k],
                diceTuple,
                moveActions[k].move,
                head.player,
                turnIndex + 1,
              )
              if (stepAnalysis) {
                aggLoss += Math.max(0, stepAnalysis.equityLoss)
                anyAnalyzed = true
              }
            }
            if (anyAnalyzed) {
              turnAnalysis = {
                player: head.player,
                moveNumber: turnIndex + 1,
                positionId: exportToGnuPositionId(startState),
                moveExecuted: 'per-move-aggregate',
                bestMove: 'per-move-aggregate',
                equityLoss: aggLoss,
                errorType: this.classifyError(aggLoss),
              }
            }
          }

          if (turnAnalysis) {
            playerStats[head.player].analyzedMoves++
            playerStats[head.player].totalEquityLoss += turnAnalysis.equityLoss

            // Matching diagnostics
            const ps = playerStats[head.player]
            const r = turnAnalysis.matchedRank ?? 0
            const strat = turnAnalysis.matchStrategy
            if (r === 1) ps.matchedRank1 = (ps.matchedRank1 ?? 0) + 1
            else if (r === 2) ps.matchedRank2 = (ps.matchedRank2 ?? 0) + 1
            else if (r && r >= 3) ps.matchedRank3Plus = (ps.matchedRank3Plus ?? 0) + 1
            if (strat === 'ordered') ps.matchOrdered = (ps.matchOrdered ?? 0) + 1
            if (strat === 'unordered') ps.matchUnordered = (ps.matchUnordered ?? 0) + 1
            if (strat === 'alt-ordered') ps.matchAltOrdered = (ps.matchAltOrdered ?? 0) + 1
            if (strat === 'alt-unordered') ps.matchAltUnordered = (ps.matchAltUnordered ?? 0) + 1
            if (strat === 'final-board') ps.matchFinalBoard = (ps.matchFinalBoard ?? 0) + 1

            switch (turnAnalysis.errorType) {
              case 'doubtful':
                playerStats[head.player].errors.doubtful++
                break
              case 'error':
                playerStats[head.player].errors.error++
                break
              case 'blunder':
                playerStats[head.player].errors.blunder++
                break
              case 'very_bad':
                playerStats[head.player].errors.veryBad++
                break
            }
          }
        } catch (error) {
          // Log and skip rather than killing the entire PR calculation.
          // A single unanalyzable turn should not void the whole game.
          logger.warn(`Skipping turn ${turnIndex + 1} (analysis failed): ${error}`)
        }

        i = j + 1
        turnIndex += 1
      }

      for (const player of Object.values(playerStats)) {
        if (player.analyzedMoves > 0) {
          player.averageEquityLoss =
            player.totalEquityLoss / player.analyzedMoves
          // Standard GNU BG PR formula: AEL (in equity units [-1,1]) * 500
          // Produces millipoints-per-move scale matching established PR ranges:
          // World Class: < 3.0, Expert: 3-5, Advanced: 5-7.5, Intermediate: 7.5-12.5
          player.performanceRating = player.averageEquityLoss * 500
        }
      }

      logger.info(`PR calculation complete for game ${gameId}`)

      return {
        gameId,
        playerResults: playerStats,
        analysisComplete: true,
      }
    } catch (error) {
      logger.error(`PR calculation failed for game ${gameId}:`, error)
      return {
        gameId,
        playerResults: {},
        analysisComplete: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async analyzeMoveWithGnuBG(
    gameState: BackgammonGame,
    dice: [number, number],
    moveExecuted: any,
    playerId: string,
    moveNumber: number,
  ): Promise<PRMoveAnalysis | null> {
    try {
      const ai = await getAiModule()

      // Find the executing player to get their direction for correct hint context
      const executingPlayer = gameState.players.find(
        (p) => p.id === playerId || p.userId === playerId
      )
      if (!executingPlayer) {
        logger.warn(`Player ${playerId} not found in game state for PR analysis (move ${moveNumber})`)
        return null
      }

      // Pass executing player's color and direction to ensure hints match their perspective
      const { request } = ai.buildHintContextFromGame(gameState, {
        dice,
        activePlayerColor: executingPlayer.color,
        activePlayerDirection: executingPlayer.direction,
      })

      // Prefer board-based hints (with activePlayerColor) first; then PID fallback
      const posId = exportToGnuPositionId(gameState)
      let hints: MoveHint[] = []
      try { hints = await ai.gnubgHints.getMoveHints({ ...request, dice }, 64) } catch {}
      if (!Array.isArray(hints) || hints.length === 0) {
        const reversed: [number, number] = [dice?.[1] ?? 0, dice?.[0] ?? 0]
        try { hints = await ai.gnubgHints.getMoveHints({ ...request, dice: reversed }, 64) } catch {}
      }
      if (!Array.isArray(hints) || hints.length === 0) {
        try {
          if (typeof ai.gnubgHints.getHintsFromPositionId === 'function') {
            hints = await ai.gnubgHints.getHintsFromPositionId(posId, dice, 64, executingPlayer.direction, executingPlayer.color)
          }
        } catch {}
      }
      if (!Array.isArray(hints) || hints.length === 0) {
        try {
          if (typeof ai.gnubgHints.getHintsFromPositionId === 'function') {
            const rev: [number, number] = [dice?.[1] ?? 0, dice?.[0] ?? 0]
            hints = await ai.gnubgHints.getHintsFromPositionId(posId, rev, 64, executingPlayer.direction, executingPlayer.color)
          }
        } catch {}
      }
      if (!Array.isArray(hints) || hints.length === 0) {
        logger.warn('No hints returned for PR analysis')
        return null
      }

      const bestHint = hints[0]
      const actualStep = this.extractActualMoveStep(
        moveExecuted,
        playerId,
        gameState,
      )

      // Debug: log the actual step and hints for comparison
      logger.info(`Move ${moveNumber} - actualStep: ${JSON.stringify(actualStep)}`)
      logger.info(`Move ${moveNumber} - bestHint moves: ${JSON.stringify(bestHint?.moves)}`)
      logger.info(`Move ${moveNumber} - all hint steps: ${JSON.stringify(hints.slice(0, 3).map(h => h.moves))}`)

      if (!actualStep) {
        const posId = exportToGnuPositionId(gameState)
        throw new Error(
          `analyzeMoveWithGnuBG: extractActualMoveStep returned null. ` +
          `Move ${moveNumber}, positionId=${posId}, dice=${JSON.stringify(dice)}, ` +
          `moveExecuted=${JSON.stringify(moveExecuted)}`
        )
      }

      let actualHint = this.findHintForStep(hints, actualStep)
      if (!actualHint) {
        const altStep = this.extractActualMoveStep(moveExecuted, playerId, gameState)
        if (altStep) actualHint = this.findHintForStep(hints, altStep)
      }
      if (!actualHint) {
        const posId = exportToGnuPositionId(gameState)
        throw new Error(
          `analyzeMoveWithGnuBG: no hint matched player's move. ` +
          `Move ${moveNumber}, positionId=${posId}, dice=${JSON.stringify(dice)}, ` +
          `actualStep=${JSON.stringify({ from: actualStep.from, to: actualStep.to, kind: actualStep.moveKind, fromC: actualStep.fromContainer, toC: actualStep.toContainer })}, ` +
          `hintsCount=${hints.length}, ` +
          `topHintMoves=${JSON.stringify(hints[0]?.moves?.map((m: MoveStep) => ({ from: m.from, to: m.to, kind: m.moveKind })))}`
        )
      }

      // Addon returns equity in [-1, 1] range (cubeful equity can exceed this
      // slightly with gammon/backgammon potential). No normalization needed.
      // Prefer addon-provided difference field; fall back to equity subtraction.
      const diffRaw = (actualHint as any)?.difference as number | null | undefined
      let equityLoss: number
      if (typeof diffRaw === 'number' && Number.isFinite(diffRaw)) {
        // difference = actualEquity - bestEquity, so it's <= 0; take absolute value
        equityLoss = Math.max(0, Math.min(0.5, Math.abs(diffRaw)))
      } else {
        const bestEquity = (bestHint?.evaluation?.cubefulEquity ?? bestHint?.equity) as number | null
        const actualEquity = (actualHint?.evaluation?.cubefulEquity ?? actualHint?.equity) as number | null
        if (bestEquity === null || !Number.isFinite(bestEquity as number) ||
            actualEquity === null || !Number.isFinite(actualEquity as number)) {
          logger.warn(`Unable to determine equities for move ${moveNumber}: best=${bestEquity}, actual=${actualEquity}`)
          return null
        }
        equityLoss = Math.max(0, Math.min(0.5, (bestEquity as number) - (actualEquity as number)))
      }
      const errorType = this.classifyError(equityLoss)

      return {
        player: playerId,
        moveNumber,
        positionId: exportToGnuPositionId(gameState),
        moveExecuted: actualStep ? this.formatMoveStep(actualStep) : 'unknown',
        bestMove: this.formatHint(bestHint),
        equityLoss,
        errorType,
      }
    } catch (error) {
      logger.error(`GNU BG analysis failed for move ${moveNumber}: ${error}`)
      throw error
    }
  }

  // Analyze a full turn (sequence of steps) against GNU hint sequences
  private async analyzeTurnWithGnuBG(
    gameState: BackgammonGame,
    dice: [number, number],
    actions: Array<{ player: string; move: any }>,
    playerId: string,
    turnNumber: number,
  ): Promise<PRMoveAnalysis | null> {
    try {
      const ai = await getAiModule()

      // Find the executing player to get their direction for correct hint context
      const executingPlayer = gameState.players.find(
        (p) => p.id === playerId || p.userId === playerId
      )
      if (!executingPlayer) {
        logger.warn(`Player ${playerId} not found in game state for PR analysis`)
        return null
      }

      // Pass executing player's color and direction to ensure hints match their perspective
      const { request } = ai.buildHintContextFromGame(gameState, {
        dice,
        activePlayerColor: executingPlayer.color,
        activePlayerDirection: executingPlayer.direction,
      })

      // Use snapshot dice directly. Do NOT use inferDiceFromActions -- the dieValue
      // fields in action payloads are corrupt in some game histories (see issue #275).
      // The snapshot dice are the authoritative source, proven reliable by diagnostics.
      let hints: MoveHint[] = []
      const posId = exportToGnuPositionId(gameState)
      const reversed: [number, number] = [dice[1], dice[0]]
      try { hints = await ai.gnubgHints.getMoveHints({ ...request, dice }, 64) } catch {}
      if (!Array.isArray(hints) || hints.length === 0) {
        try { hints = await ai.gnubgHints.getMoveHints({ ...request, dice: reversed }, 64) } catch {}
      }
      if (!Array.isArray(hints) || hints.length === 0) {
        try {
          if (typeof ai.gnubgHints.getHintsFromPositionId === 'function') {
            hints = await ai.gnubgHints.getHintsFromPositionId(posId, dice, 64, executingPlayer.direction, executingPlayer.color)
          }
        } catch {}
      }
      if (!Array.isArray(hints) || hints.length === 0) {
        try {
          if (typeof ai.gnubgHints.getHintsFromPositionId === 'function') {
            hints = await ai.gnubgHints.getHintsFromPositionId(posId, reversed, 64, executingPlayer.direction, executingPlayer.color)
          }
        } catch {}
      }
      if (!Array.isArray(hints) || hints.length === 0) {
        logger.warn('No hints returned for PR analysis (turn)')
        return null
      }

      // Build actual sequence from actions
      const sequence: MoveStep[] = []
      for (const a of actions) {
        const step = this.extractActualMoveStep(a.move, playerId, gameState)
        if (step) sequence.push(step)
      }

      let hintsUsed = hints
      let altHintsCache: MoveHint[] | null = null
      let bestHint = hintsUsed[0]
      let matched = this.findHintForSequence(hintsUsed, sequence)
      let matchStrategy: 'ordered' | 'unordered' | 'alt-ordered' | 'alt-unordered' | 'final-board' | 'prefix' | 'subset' | 'worst' = 'ordered'
      // Lightweight secondary pass: try reversed dice order if ordered match fails
      if (!matched) {
        try {
          const swapped: [number, number] = [dice[1], dice[0]]
          const altHints = await ai.gnubgHints.getMoveHints({ ...request, dice: swapped }, 64)
          if (Array.isArray(altHints) && altHints.length > 0) {
            altHintsCache = altHints
            const tryAltOrdered = this.findHintForSequence(altHints, sequence)
            if (tryAltOrdered) {
              matched = tryAltOrdered
              hintsUsed = altHints
              bestHint = altHints[0]
              matchStrategy = 'alt-ordered'
            } else if (this.areStepsIndependent(sequence)) {
              const tryAltUnordered = this.findHintForSequenceUnordered(altHints, sequence)
              if (tryAltUnordered) {
                matched = tryAltUnordered
                hintsUsed = altHints
                bestHint = altHints[0]
                matchStrategy = 'alt-unordered'
              }
            }
          }
        } catch {}
      }
      if (!matched) {
        // Only allow unordered matching when steps are independent
        if (this.areStepsIndependent(sequence)) {
          matched = this.findHintForSequenceUnordered(hints, sequence)
          if (matched) matchStrategy = 'unordered'
        }
      }
      if (!matched) {
        const alt: MoveStep[] = []
        for (const a of actions) {
          const s = this.extractActualMoveStep(a.move, playerId, gameState)
          if (s) alt.push(s)
        }
        matched = this.findHintForSequence(hintsUsed, alt)
        if (matched) matchStrategy = 'alt-ordered'
        if (!matched && this.areStepsIndependent(alt)) {
          matched = this.findHintForSequenceUnordered(hintsUsed, alt)
          if (matched) matchStrategy = 'alt-unordered'
        }
      }
      // Prefer final-board equality when ordered/unordered did not match
      const isDoubles = dice && dice[0] === dice[1] && dice[0] > 0
      if (!matched) {
        const activeDirection =
          (request as any)?.activePlayerDirection ??
          (gameState as any)?.activePlayer?.direction
        if (!activeDirection) {
          logger.warn('Skipping final-board matching: missing active player direction')
        } else {
          const initialSig = this.buildGnuBoardSignature(
            gameState,
            activeDirection
          )
          const execSig = this.applyStepsToSignature(initialSig, sequence)
          // Compare against hints with same number of steps first; then allow longer hints that start with same count
          const candidateHints = hintsUsed.slice()
          let fbMatch: MoveHint | undefined
          for (const h of candidateHints) {
            const steps = Array.isArray(h.moves) ? h.moves.slice(0, sequence.length) : []
            if (steps.length < sequence.length) continue
            const sig = this.applyStepsToSignature(initialSig, steps)
            if (this.signaturesEqual(execSig, sig)) {
              fbMatch = h
              break
            }
          }
          if (!fbMatch && altHintsCache && altHintsCache.length > 0) {
            for (const h of altHintsCache) {
              const steps = Array.isArray(h.moves) ? h.moves.slice(0, sequence.length) : []
              if (steps.length < sequence.length) continue
              const sig = this.applyStepsToSignature(initialSig, steps)
              if (this.signaturesEqual(execSig, sig)) {
                fbMatch = h
                // switch to alt hints context for consistent ranking
                hintsUsed = altHintsCache
                bestHint = altHintsCache[0]
                break
              }
            }
          }
          if (fbMatch) {
            matched = fbMatch
            matchStrategy = 'final-board'
          }
        }
      }
      if (!matched) {
        // Try longest-prefix on current and alt hints; prefer larger prefix
        let byPrefix = this.findHintByLongestPrefix(hintsUsed, sequence)
        if (altHintsCache && altHintsCache.length > 0) {
          const byPrefixAlt = this.findHintByLongestPrefix(altHintsCache, sequence)
          if (byPrefixAlt) {
            // Compare prefix lengths via helper
            const len = (h: MoveHint | undefined) => {
              if (!h || !Array.isArray(h.moves)) return 0
              const moves = h.moves as MoveStep[]
              let pref = 0
              const max = Math.min(moves.length, sequence.length)
              for (let i = 0; i < max; i++) {
                if (this.stepsEqual(moves[i], sequence[i])) pref += 1
                else break
              }
              return pref
            }
            if (len(byPrefixAlt) > len(byPrefix)) {
              byPrefix = byPrefixAlt
              hintsUsed = altHintsCache
              bestHint = altHintsCache[0]
            }
          }
        }
        if (byPrefix) {
          matched = byPrefix
          matchStrategy = 'prefix'
        }
      }
      // Subset matching for partial plays (e.g., 3 of 4 doubles when 4th blocked)
      if (!matched) {
        const bySubset = this.findHintForSequenceSubset(hintsUsed, sequence)
        if (!bySubset && altHintsCache && altHintsCache.length > 0) {
          const bySubsetAlt = this.findHintForSequenceSubset(altHintsCache, sequence)
          if (bySubsetAlt) {
            matched = bySubsetAlt
            hintsUsed = altHintsCache
            bestHint = altHintsCache[0]
            matchStrategy = 'subset'
          }
        } else if (bySubset) {
          matched = bySubset
          matchStrategy = 'subset'
        }
      }
      // Fallback: no strategy matched. Use worst hint with capped equity loss
      // instead of throwing, so the turn is still counted rather than killing
      // the entire PR calculation.
      if (!matched) {
        const posId = exportToGnuPositionId(gameState)
        logger.warn(
          `analyzeTurnWithGnuBG: no hint matched player's move sequence. ` +
          `Turn ${turnNumber}, positionId=${posId}, dice=${JSON.stringify(dice)}, ` +
          `sequence=${JSON.stringify(sequence.map(s => ({ from: s.from, to: s.to, kind: s.moveKind, fromC: s.fromContainer, toC: s.toContainer })))}, ` +
          `hintsCount=${hintsUsed.length}, ` +
          `strategies_tried=[ordered,unordered,alt-ordered,alt-unordered,final-board,prefix,subset]. ` +
          `Falling back to worst hint.`
        )
        matched = hintsUsed[hintsUsed.length - 1]
        matchStrategy = 'worst'
      }
      const actualHint = matched

      // Log for debugging
      const rank = this.getHintRank(hintsUsed, matched)
      logger.info(`Turn ${turnNumber} - sequence: ${JSON.stringify(sequence)}`)
      logger.info(`Turn ${turnNumber} - bestHint moves: ${JSON.stringify(bestHint?.moves)}`)
      logger.info(`Turn ${turnNumber} - matched strategy=${matchStrategy}, rank=${rank ?? 'n/a'}`)

      // Addon returns equity in [-1, 1] range. No normalization needed.
      // Prefer addon-provided difference field; fall back to equity subtraction.
      const diffRaw = (actualHint as any)?.difference as number | null | undefined
      let equityLoss: number
      if (typeof diffRaw === 'number' && Number.isFinite(diffRaw)) {
        // difference = actualEquity - bestEquity, so it's <= 0; take absolute value
        equityLoss = Math.max(0, Math.min(0.5, Math.abs(diffRaw)))
      } else {
        const bestEquity = (bestHint?.evaluation?.cubefulEquity ?? bestHint?.equity) as number | null
        const actualEquity = (actualHint?.evaluation?.cubefulEquity ?? actualHint?.equity) as number | null
        if (bestEquity === null || !Number.isFinite(bestEquity as number) ||
            actualEquity === null || !Number.isFinite(actualEquity as number)) {
          logger.warn(`Unable to determine equities for turn ${turnNumber}: best=${bestEquity}, actual=${actualEquity}`)
          return null
        }
        equityLoss = Math.max(0, Math.min(0.5, (bestEquity as number) - (actualEquity as number)))
      }
      const errorType = this.classifyError(equityLoss)

      return {
        player: playerId,
        moveNumber: turnNumber,
        positionId: exportToGnuPositionId(gameState),
        moveExecuted: sequence.map((s) => this.formatMoveStep(s)).join(' '),
        bestMove: this.formatHint(bestHint),
        equityLoss,
        errorType,
        matchedRank: rank,
        matchStrategy,
      }
    } catch (error) {
      logger.error(`GNU BG analysis failed for turn ${turnNumber}: ${error}`)
      throw error
    }
  }

  private extractActualMoveStep(
    move: any,
    playerId: string,
    gameState: BackgammonGame,
  ): ExecutedMoveStep | null {
    const payload = move?.makeMove ?? move

    if (!payload) {
      return null
    }

    // History stores userId in player_id field, so check both id and userId
    const executingPlayer = gameState.players.find((p) => p.id === playerId || p.userId === playerId)
    if (!executingPlayer) {
      logger.debug(`extractActualMoveStep: player ${playerId} not found`)
      return null
    }

    let moveKind = (payload.moveKind || 'point-to-point') as MoveStep['moveKind']

    // Extract positions from history payload
    let originPosition: number | null = null
    let destinationPosition: number | null = null

    if (moveKind === 'reenter') {
      originPosition = 0
      destinationPosition = typeof payload.destinationPosition === 'number'
        ? payload.destinationPosition
        : null
    } else if (moveKind === 'bear-off') {
      originPosition = typeof payload.originPosition === 'number'
        ? payload.originPosition
        : null
      destinationPosition = 0
    } else {
      originPosition = typeof payload.originPosition === 'number'
        ? payload.originPosition
        : null
      destinationPosition = typeof payload.destinationPosition === 'number'
        ? payload.destinationPosition
        : null
    }

    // Infer moveKind from positions when the payload label is wrong.
    // The game engine sometimes labels bear-off/reenter as "point-to-point".
    // gnubg-hints uses: bar -> from=0/fromContainer='bar', off -> to=0/toContainer='off'
    // Points are 1-24, so from=0 can only be bar and to=0 can only be off.
    if (destinationPosition === 0 && moveKind !== 'bear-off') {
      moveKind = 'bear-off'
    }
    if (originPosition === 0 && moveKind !== 'reenter') {
      moveKind = 'reenter'
    }
    if (originPosition === 25) {
      // Some code paths use 25 for bar; convert to 0 to match hint format
      moveKind = 'reenter'
      originPosition = 0
    }

    if (originPosition === null || destinationPosition === null) {
      logger.debug(`extractActualMoveStep: missing positions - origin=${originPosition}, dest=${destinationPosition}`)
      return null
    }

    const fromContainer: MoveStep['fromContainer'] = moveKind === 'reenter' ? 'bar' : 'point'
    const toContainer: MoveStep['toContainer'] = moveKind === 'bear-off' ? 'off' : 'point'

    logger.debug(`extractActualMoveStep: player=${executingPlayer.color}, direction=${executingPlayer.direction}, ` +
      `moveKind=${moveKind}, from=${originPosition}, to=${destinationPosition}`)

    return {
      player: executingPlayer.color,
      moveKind,
      isHit: Boolean(payload.isHit),
      from: originPosition,
      to: destinationPosition,
      fromContainer,
      toContainer,
    }
  }

  private findHintForStep(
    hints: MoveHint[],
    target: MoveStep,
  ): MoveHint | undefined {
    return hints.find((hint) =>
      hint.moves.some((step) => this.stepsEqual(step, target)),
    )
  }

  private findHintForSequence(
    hints: MoveHint[],
    sequence: MoveStep[],
  ): MoveHint | undefined {
    if (!sequence || sequence.length === 0) return undefined
    return hints.find((hint) => {
      if (!Array.isArray(hint.moves)) return false
      if (hint.moves.length < sequence.length) return false
      for (let i = 0; i < sequence.length; i++) {
        if (!this.stepsEqual(hint.moves[i], sequence[i])) return false
      }
      return true
    })
  }

  // Order-insensitive sequence match for commutative sub-steps
  private findHintForSequenceUnordered(
    hints: MoveHint[],
    sequence: MoveStep[],
  ): MoveHint | undefined {
    if (!sequence || sequence.length === 0) return undefined
    const key = (s: MoveStep) => `${s.moveKind}:${s.fromContainer}:${s.from}->${s.toContainer}:${s.to}`
    const need = new Map<string, number>()
    for (const s of sequence) {
      const k = key(s)
      need.set(k, (need.get(k) ?? 0) + 1)
    }
    for (const hint of hints) {
      const moves = Array.isArray(hint.moves) ? hint.moves.slice(0, sequence.length) : []
      if (moves.length < sequence.length) continue
      const have = new Map<string, number>()
      for (const s of moves) {
        const k = key(s)
        have.set(k, (have.get(k) ?? 0) + 1)
      }
      let ok = true
      for (const [k, cnt] of need) {
        if ((have.get(k) ?? 0) !== cnt) { ok = false; break }
      }
      if (ok) return hint
    }
    return undefined
  }

  // Multiset subset matching for partial plays. When a player could only use
  // N of M dice (e.g., 3 of 4 doubles because 4th was blocked), their N moves
  // should be a subset of the hint's M-move play (in any order).
  private findHintForSequenceSubset(
    hints: MoveHint[],
    sequence: MoveStep[],
  ): MoveHint | undefined {
    if (!sequence || sequence.length === 0) return undefined

    const key = (s: MoveStep) => `${s.moveKind}:${s.fromContainer}:${s.from}->${s.toContainer}:${s.to}`

    const need = new Map<string, number>()
    for (const s of sequence) {
      const k = key(s)
      need.set(k, (need.get(k) ?? 0) + 1)
    }

    for (const hint of hints) {
      if (!Array.isArray(hint.moves) || hint.moves.length <= sequence.length) continue

      const have = new Map<string, number>()
      for (const m of hint.moves) {
        const k = key(m)
        have.set(k, (have.get(k) ?? 0) + 1)
      }

      let ok = true
      for (const [k, cnt] of need) {
        if ((have.get(k) ?? 0) < cnt) { ok = false; break }
      }
      if (ok) return hint
    }

    return undefined
  }

  private findHintByLongestPrefix(
    hints: MoveHint[],
    sequence: MoveStep[],
  ): MoveHint | undefined {
    let best: { hint: MoveHint; prefix: number } | null = null
    for (const h of hints) {
      const moves = Array.isArray(h.moves) ? h.moves : []
      let pref = 0
      const max = Math.min(moves.length, sequence.length)
      for (let i = 0; i < max; i++) {
        if (this.stepsEqual(moves[i], sequence[i])) pref += 1
        else break
      }
      if (pref > 0 && (!best || pref > best.prefix)) {
        best = { hint: h, prefix: pref }
      }
    }
    return best?.hint
  }

  private stepsEqual(a: MoveStep, b: MoveStep): boolean {
    return (
      a.from === b.from &&
      a.to === b.to &&
      a.fromContainer === b.fromContainer &&
      a.toContainer === b.toContainer &&
      a.moveKind === b.moveKind
    )
  }

  // Heuristic: steps are independent if they do not hit, do not reenter/bear-off,
  // and do not overlap sources/destinations or form source->dest chains.
  private areStepsIndependent(sequence: MoveStep[]): boolean {
    if (!sequence || sequence.length <= 1) return true
    for (const s of sequence) {
      if (s.isHit) return false
      if (s.moveKind !== 'point-to-point') return false
    }
    const sources = new Set<number>()
    const dests = new Set<number>()
    for (const s of sequence) {
      if (sources.has(s.from) || dests.has(s.to)) return false
      sources.add(s.from)
      dests.add(s.to)
    }
    // Disallow chains where one step's destination is another's source
    for (const s of sequence) {
      if (sources.has(s.to) || dests.has(s.from)) return false
    }
    return true
  }

  // Build a compact GNU-perspective board signature for both colors
  private buildGnuBoardSignature(
    gameState: BackgammonGame,
    activeDirection: BackgammonMoveDirection,
  ): {
    white: { points: number[]; bar: number; off: number }
    black: { points: number[]; bar: number; off: number }
  } {
    const pointsWhite = Array(25).fill(0)
    const pointsBlack = Array(25).fill(0)
    try {
      const board: any = (gameState as any).board
      const pts: any[] = board?.points || []
      for (const p of pts) {
        const pos = p?.position?.[activeDirection]
        if (typeof pos === 'number') {
          const countWhite = (p?.checkers || []).filter((c: any) => c?.color === 'white').length
          const countBlack = (p?.checkers || []).filter((c: any) => c?.color === 'black').length
          pointsWhite[pos] += countWhite
          pointsBlack[pos] += countBlack
        }
      }
      const bar = board?.bar || {}
      const off = board?.off || {}
      const barCW = bar?.clockwise?.checkers || []
      const barCCW = bar?.counterclockwise?.checkers || []
      const offCW = off?.clockwise?.checkers || []
      const offCCW = off?.counterclockwise?.checkers || []
      const barWhite = [...barCW, ...barCCW].filter((c: any) => c?.color === 'white').length
      const barBlack = [...barCW, ...barCCW].filter((c: any) => c?.color === 'black').length
      const offWhite = [...offCW, ...offCCW].filter((c: any) => c?.color === 'white').length
      const offBlack = [...offCW, ...offCCW].filter((c: any) => c?.color === 'black').length
      return {
        white: { points: pointsWhite, bar: barWhite, off: offWhite },
        black: { points: pointsBlack, bar: barBlack, off: offBlack },
      }
    } catch {
      return {
        white: { points: pointsWhite, bar: 0, off: 0 },
        black: { points: pointsBlack, bar: 0, off: 0 },
      }
    }
  }

  // Apply a sequence of GNU-perspective steps to a board signature (pure function)
  private applyStepsToSignature(
    initial: {
      white: { points: number[]; bar: number; off: number }
      black: { points: number[]; bar: number; off: number }
    },
    steps: MoveStep[],
  ) {
    const clone = {
      white: {
        points: initial.white.points.slice(),
        bar: initial.white.bar,
        off: initial.white.off,
      },
      black: {
        points: initial.black.points.slice(),
        bar: initial.black.bar,
        off: initial.black.off,
      },
    }
    const take = (side: 'white' | 'black', container: 'bar' | 'point' | 'off', pos: number) => {
      if (container === 'bar') clone[side].bar = Math.max(0, clone[side].bar - 1)
      else if (container === 'off') clone[side].off = Math.max(0, clone[side].off - 1)
      else if (pos >= 1 && pos <= 24) clone[side].points[pos] = Math.max(0, clone[side].points[pos] - 1)
    }
    const give = (side: 'white' | 'black', container: 'bar' | 'point' | 'off', pos: number) => {
      if (container === 'bar') clone[side].bar += 1
      else if (container === 'off') clone[side].off += 1
      else if (pos >= 1 && pos <= 24) clone[side].points[pos] += 1
    }
    for (const s of steps) {
      const side = s.player as 'white' | 'black'
      const opp: 'white' | 'black' = side === 'white' ? 'black' : 'white'
      take(side, s.fromContainer, s.from)
      // If the move hits, remove one opponent checker from destination point and send to bar
      if (s.isHit && s.toContainer === 'point') {
        if (s.to >= 1 && s.to <= 24 && clone[opp].points[s.to] > 0) {
          clone[opp].points[s.to] -= 1
          clone[opp].bar += 1
        }
      }
      give(side, s.toContainer, s.to)
    }
    return clone
  }

  private signaturesEqual(a: any, b: any): boolean {
    const eqArr = (x: number[], y: number[]) => x.length === y.length && x.every((v, i) => v === y[i])
    return (
      eqArr(a.white.points, b.white.points) &&
      eqArr(a.black.points, b.black.points) &&
      a.white.bar === b.white.bar &&
      a.black.bar === b.black.bar &&
      a.white.off === b.white.off &&
      a.black.off === b.black.off
    )
  }

  // Compute hint rank (1-based) within a list
  private getHintRank(hints: MoveHint[], matched?: MoveHint): number | null {
    if (!matched) return null
    const idx = hints.indexOf(matched)
    return idx >= 0 ? idx + 1 : null
  }

  // Produce a canonical string key for a dice pair, sorted to treat [3,6] and [6,3] as identical.
  // Returns null when dice data is unavailable so callers can fall back to player-only grouping.
  private sortedDiceKey(dice?: number[]): string | null {
    if (!Array.isArray(dice) || dice.length < 2) return null
    return dice[0] <= dice[1] ? `${dice[0]},${dice[1]}` : `${dice[1]},${dice[0]}`
  }

  private formatHint(hint: MoveHint): string {
    if (!hint.moves || hint.moves.length === 0) {
      return 'unknown'
    }

    return hint.moves
      .map((step) => this.formatMoveStep(step))
      .join(' ')
  }

  private formatMoveStep(step: MoveStep): string {
    if (step.fromContainer === 'bar') {
      return `bar/${step.to}`
    }
    if (step.toContainer === 'off') {
      return `${step.from}/off`
    }
    return `${step.from}/${step.to}`
  }

  /**
   * Classify error type based on equity loss
   */
  private classifyError(equityLoss: number): 'none' | 'doubtful' | 'error' | 'blunder' | 'very_bad' {
    if (equityLoss < 0.020) return 'none'
    if (equityLoss < 0.040) return 'doubtful'
    if (equityLoss < 0.080) return 'error'
    if (equityLoss < 0.160) return 'blunder'
    return 'very_bad'
  }

  /**
   * Get skill level description from PR
   */
  static getSkillLevel(pr: number): string {
    if (pr <= 3.0) return 'World Class'
    if (pr <= 5.0) return 'Expert'
    if (pr <= 7.0) return 'Advanced'
    if (pr <= 11.0) return 'Intermediate'
    if (pr <= 15.0) return 'Casual'
    return 'Beginner'
  }
}
