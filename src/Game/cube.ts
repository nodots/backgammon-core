import {
  BackgammonCubeValue,
  BackgammonGame,
  BackgammonGameCompleted,
  BackgammonGameDoubled,
  BackgammonGameRolling,
  BackgammonPlayer,
  BackgammonPlayerActive,
  BackgammonPlayerDoubled,
  BackgammonPlayerInactive,
  BackgammonPlayerRolling,
  BackgammonPlayers,
  BackgammonPlayerWinner,
} from '@nodots/backgammon-types'
import { Dice } from '../Dice'
import { logger } from '../utils/logger'
import { incrementStateVersion } from './shared'

export function canOfferDouble(
  game: BackgammonGame,
  player: BackgammonPlayerActive
): boolean {
  // Crawford rule: No doubling allowed during the Crawford game
  // The Crawford game is the first game after a player reaches match point - 1
  if (game.rules?.useCrawfordRule && game.matchInfo?.isCrawford) {
    return false
  }

  // Allow doubling from rolling state only (before rolling dice)
  // Only if cube is centered (no owner) OR the player owns the cube
  // and cube is not maxxed or already offered
  return (
    game.stateKind === 'rolling' &&
    game.cube.stateKind !== 'maxxed' &&
    game.cube.stateKind !== 'offered' &&
    (!game.cube.owner || game.cube.owner.id === player.id) &&
    // Disallow repeat doubles in same turn unless Beaver is implemented
    game.cube.offeredThisTurnBy?.id !== player.id
  )
}

export function canAcceptDouble(
  game: BackgammonGame,
  player: BackgammonPlayerActive
): boolean {
  // Only if cube is in 'offered' state and player is not the one who offered
  return (
    game.cube.stateKind === 'offered' &&
    game.cube.offeredBy &&
    game.cube.offeredBy.id !== player.id
  )
}

export function acceptDouble(
  game: BackgammonGame,
  player: BackgammonPlayerActive
): BackgammonGame {
  if (!canAcceptDouble(game, player)) throw new Error('Cannot accept double')
  // Accept the offered value (do NOT double again here). Transfer ownership to accepting player.
  const acceptedValue = (game.cube.value ?? 2) as typeof game.cube.value
  const offeringPlayer = game.cube.offeredBy!
  // If accepting at 64, preserve prior behavior (may end the game depending on rules)
  if (acceptedValue === 64) {
    // If maxxed, game should be completed
    const winner = {
      ...player,
      stateKind: 'winner',
    } as BackgammonPlayerWinner

    // Update players array to reflect winner status
    const updatedPlayers = game.players.map((p) =>
      p.id === winner.id ? winner : p
    ) as BackgammonPlayers

    return incrementStateVersion({
      ...game,
      stateKind: 'completed',
      winner: winner.id,
      winType: 'simple',
      pointsWon: 64,
      players: updatedPlayers,
      cube: {
        ...game.cube,
        stateKind: 'maxxed',
        owner: undefined,
        value: 64,
        offeredBy: undefined,
      },
      // Same cleanup as refuseDouble / resign: the completed game
      // must not carry a mid-turn activePlay to the client.
      activePlay: undefined,
      activePlayer: winner,
      endReason: 'cube_drop',
      endTime: new Date(),
    } as BackgammonGameCompleted)
  }
  // Transition back to 'rolling' state for the original offering player to roll
  const updatedCube = {
    ...game.cube,
    stateKind: 'doubled' as const,
    owner: player,
    value: acceptedValue,
    offeredBy: undefined,
  }

  const updatedActivePlayer: BackgammonPlayerRolling = {
    ...offeringPlayer,
    stateKind: 'rolling',
    dice: Dice.initialize(offeringPlayer.color, 'rolling'),
    // Non-null: an active player mid-game has a rollForStartValue; the base
    // player type declares it optional, the rolling player type requires it.
    rollForStartValue: offeringPlayer.rollForStartValue!,
  }
  const updatedInactivePlayer: BackgammonPlayerInactive = {
    ...player,
    stateKind: 'inactive',
    dice: Dice.initialize(player.color, 'inactive'),
    // Non-null: see above; inactive player type also requires rollForStartValue.
    rollForStartValue: player.rollForStartValue!,
  }

  const updatedPlayers = game.players.map((p) => {
    if (p.id === updatedActivePlayer.id) return updatedActivePlayer
    if (p.id === updatedInactivePlayer.id) return updatedInactivePlayer
    return p
  }) as BackgammonPlayers

  return incrementStateVersion({
    ...game,
    stateKind: 'rolling',
    cube: updatedCube,
    players: updatedPlayers,
    activePlayer: updatedActivePlayer,
    inactivePlayer: updatedInactivePlayer,
    activeColor: updatedActivePlayer.color,
    activePlay: undefined,
    // as unknown as BackgammonGameRolling: the spread yields a generic players
    // array (not the rolling-game tuple) that TS can't narrow structurally.
  } as unknown as BackgammonGameRolling)
}

export function canRefuseDouble(
  game: BackgammonGame,
  player: BackgammonPlayerActive
): boolean {
  // Only if cube is in 'offered' state and player is not the one who offered
  return canAcceptDouble(game, player)
}

export function refuseDouble(
  game: BackgammonGame,
  player: BackgammonPlayerActive
): BackgammonGame {
  if (!canRefuseDouble(game, player)) throw new Error('Cannot refuse double')
  // The refusing player loses at the current cube value (before the proposed double)
  // The offering player is the winner
  const offeringPlayer = game.cube.offeredBy!
  const winner = {
    ...offeringPlayer,
    stateKind: 'winner',
  } as BackgammonPlayerWinner

  // Update players array to reflect winner status
  const updatedPlayers = game.players.map((p) =>
    p.id === winner.id ? winner : p
  ) as BackgammonPlayers

  // When refusing a double, winner gets the cube value BEFORE the proposed double
  // If cube was centered (value undefined), use 1. Otherwise use current value / 2 (pre-double value)
  const currentCubeValue = game.cube?.value
  const pointsWon = currentCubeValue !== undefined ? currentCubeValue / 2 : 1

  // Reset cube to its pre-offer state. Without this, cube.stateKind
  // remains 'offered' after the game ends, which confuses the client
  // into thinking there's still an outstanding double offer.
  // - If the cube was centered before the offer (value=2, typical first
  //   double), revert to 'initialized' (value=undefined, no owner).
  // - Otherwise revert to 'doubled' at half the offered value, owned by
  //   the same player as before the offer.
  const wasFirstDouble = currentCubeValue === 2
  const resetCube = wasFirstDouble
    ? {
        ...game.cube,
        stateKind: 'initialized' as const,
        value: undefined,
        owner: undefined,
        offeredBy: undefined,
        offeredThisTurnBy: undefined,
      }
    : {
        ...game.cube,
        stateKind: 'doubled' as const,
        value: (currentCubeValue !== undefined
          ? currentCubeValue / 2
          : undefined) as typeof game.cube.value,
        owner: game.cube.owner,
        offeredBy: undefined,
        offeredThisTurnBy: undefined,
      }

  logger.info(
    `🏆 [Game] Double refused - Winner: ${winner.id}, Points won: ${pointsWon}`
  )

  return incrementStateVersion({
    ...game,
    stateKind: 'completed',
    winner: winner.id,
    winType: 'simple', // Cube drops are always simple wins
    pointsWon,
    players: updatedPlayers,
    cube: resetCube,
    // Clear mid-turn state left over from whoever was playing when the
    // cube was offered. Without this, the spread of ...game carries a
    // stale activePlay (stateKind 'moving' with possibleMoves) through
    // to the completed game, and the client renders a mid-game board
    // on top of a game the server has marked finished.
    activePlay: undefined,
    activePlayer: winner,
    endReason: 'cube_drop',
    endTime: new Date(),
  } as BackgammonGameCompleted)
}

export function resign(
  game: BackgammonGame,
  resigningPlayer: BackgammonPlayer,
  points: 1 | 2 | 3 = 1
): BackgammonGameCompleted {
  if (game.stateKind === 'completed') {
    throw new Error('Cannot resign a completed game')
  }

  if (game.settings?.allowResign === false) {
    throw new Error('Resignation is not allowed for this game')
  }

  const resigningId = resigningPlayer.id
  const opponent = game.players.find((p) => p.id !== resigningId)
  if (!opponent) {
    throw new Error('Opponent not found for resignation')
  }

  const winner = {
    ...opponent,
    stateKind: 'winner',
  } as BackgammonPlayerWinner // as BackgammonPlayerWinner: narrowing opponent to winner type

  const updatedPlayers = game.players.map((p) =>
    p.id === winner.id ? winner : p
  ) as BackgammonPlayers // as BackgammonPlayers: map returns generic array, narrowing to tuple type

  const cubeValue = game.cube?.value ?? 1
  let winType: 'simple' | 'gammon' | 'backgammon' = 'simple'
  let baseMultiplier = 1
  if (points === 2) {
    winType = 'gammon'
    baseMultiplier = 2
  } else if (points === 3) {
    winType = 'backgammon'
    baseMultiplier = 3
  }

  if (
    game.rules?.useJacobyRule &&
    game.cube?.value === undefined &&
    winType !== 'simple'
  ) {
    winType = 'simple'
    baseMultiplier = 1
  }

  const pointsWon = baseMultiplier * cubeValue

  logger.info(
    `Resignation - Winner: ${winner.id}, Points won: ${pointsWon} (${baseMultiplier}x base * ${cubeValue} cube)`
  )

  return incrementStateVersion({
    ...game,
    stateKind: 'completed',
    winner: winner.id,
    winType,
    pointsWon,
    endReason: 'resignation',
    players: updatedPlayers,
    endTime: new Date(),
    // Clear mid-turn state left over from whoever was playing when the
    // resignation came in. See refuseDouble above for the full rationale.
    activePlay: undefined,
    activePlayer: winner,
  } as BackgammonGameCompleted) // as BackgammonGameCompleted: narrowing spread object to completed game type
}

/**
 * Execute doubling action from rolling state (before rolling dice)
 * Transitions from 'rolling' to 'doubled' state and offers double to opponent
 */
export function double(game: BackgammonGameRolling): BackgammonGameDoubled {
  if (game.stateKind !== 'rolling') {
    throw new Error(
      `Cannot double from ${game.stateKind} state. Must be in 'rolling' state.`
    )
  }

  if (!canOfferDouble(game, game.activePlayer)) {
    throw new Error('Doubling is not allowed in current game state')
  }

  const { activePlayer, cube } = game

  // Calculate new cube value - initial doubling sets cube to 2
  const newValue = (
    cube.value ? Math.min(cube.value * 2, 64) : 2
  ) as BackgammonCubeValue

  // Create updated cube in 'offered' state (waiting for opponent response)
  const updatedCube = {
    ...cube,
    stateKind: 'offered' as const,
    value: newValue,
    offeredBy: activePlayer,
    offeredThisTurnBy: activePlayer,
  }

  // Convert active player to doubled state
  const doubledPlayer = {
    ...activePlayer,
    stateKind: 'doubled' as const,
    dice: {
      ...activePlayer.dice,
      stateKind: 'rolled' as const,
    },
  } as BackgammonPlayerDoubled

  // Update players array
  const updatedPlayers = game.players.map((p) =>
    p.id === activePlayer.id ? doubledPlayer : p
  ) as BackgammonPlayers

  // Update game statistics if they exist
  const updatedStatistics = game.statistics
    ? {
        ...game.statistics,
        totalDoubles: game.statistics.totalDoubles + 1,
        cubeHistory: [
          ...game.statistics.cubeHistory,
          {
            turn: game.statistics.totalRolls,
            value: newValue || 2,
            offeredBy: activePlayer.color,
            accepted: false, // Not yet accepted - just offered
          },
        ],
      }
    : undefined

  // Return game in 'doubled' state (waiting for opponent to accept/refuse)
  return incrementStateVersion({
    ...game,
    stateKind: 'doubled',
    cube: updatedCube,
    players: updatedPlayers,
    activePlayer: doubledPlayer,
    statistics: updatedStatistics,
  } as BackgammonGameDoubled)
}
