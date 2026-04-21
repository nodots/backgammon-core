import type {
  BackgammonCheckerContainerImport,
  BackgammonPointValue,
} from '@nodots/backgammon-types'
import type { DecodedGnuBoard } from './decodePositionId'
import { opponentOf, type OnRollContext } from './frame'

const CHECKERS_PER_PLAYER = 15

const toPointValue = (value: number): BackgammonPointValue =>
  value as BackgammonPointValue

/**
 * Map the two tan arrays from a decoded position ID onto concrete
 * BackgammonCheckerContainerImport entries.
 *
 * Callers must supply an on-roll context (color + direction). The
 * decoder's `opponent` array is TanBoard[0] and `onRoll` is
 * TanBoard[1]; each array is indexed 0..23 for points 1..24 in that
 * player's own direction, with index 24 = bar.
 *
 * Output is the shape `Board.initialize(imports)` consumes.
 */
export function importFromDecoded(
  decoded: DecodedGnuBoard,
  onRoll: OnRollContext
): BackgammonCheckerContainerImport[] {
  const opponent = opponentOf(onRoll)
  const imports: BackgammonCheckerContainerImport[] = []

  const addPoints = (tan: number[], player: OnRollContext) => {
    for (let i = 0; i < 24; i++) {
      if (tan[i] <= 0) continue
      const playerPos = i + 1
      const clockwise =
        player.direction === 'clockwise' ? playerPos : 25 - playerPos
      const counterclockwise = 25 - clockwise
      imports.push({
        position: {
          clockwise: toPointValue(clockwise),
          counterclockwise: toPointValue(counterclockwise),
        },
        checkers: { color: player.color, qty: tan[i] },
      })
    }
    if (tan[24] > 0) {
      imports.push({
        position: 'bar',
        direction: player.direction,
        checkers: { color: player.color, qty: tan[24] },
      })
    }
  }

  addPoints(decoded.opponent, opponent) // TanBoard[0]
  addPoints(decoded.onRoll, onRoll) // TanBoard[1]

  // Off count = 15 minus (points + bar) for that player.
  const onBoardCount = (tan: number[]) =>
    tan.slice(0, 24).reduce((sum, n) => sum + n, 0) + tan[24]

  const opponentOff = Math.max(
    0,
    CHECKERS_PER_PLAYER - onBoardCount(decoded.opponent)
  )
  const onRollOff = Math.max(
    0,
    CHECKERS_PER_PLAYER - onBoardCount(decoded.onRoll)
  )

  if (opponentOff > 0) {
    imports.push({
      position: 'off',
      direction: opponent.direction,
      checkers: { color: opponent.color, qty: opponentOff },
    })
  }
  if (onRollOff > 0) {
    imports.push({
      position: 'off',
      direction: onRoll.direction,
      checkers: { color: onRoll.color, qty: onRollOff },
    })
  }

  return imports
}
