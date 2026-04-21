import type { BackgammonBoard } from '@nodots/backgammon-types'
import { decodePositionId } from './decodePositionId'
import type { OnRollContext } from './frame'
import { importFromDecoded } from './importFromDecoded'

/**
 * Convert a 14-character GNU position ID into a fully materialized
 * BackgammonBoard, given the on-roll player's color and direction.
 *
 * Composes the three primitives in this directory:
 *   decodePositionId → importFromDecoded → Board.initialize
 *
 * Placed in its own file so the circular import with Board.initialize
 * is resolved through a lazy require in the function body; callers
 * just import this one function.
 */
export function fromPositionId(
  positionId: string,
  onRoll: OnRollContext
): BackgammonBoard {
  const decoded = decodePositionId(positionId)
  const imports = importFromDecoded(decoded, onRoll)
  // Lazy require avoids the cycle between index.ts (exports Board and
  // these helpers) and this helper (which needs Board.initialize).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Board } = require('./index') as typeof import('./index')
  return Board.initialize(imports)
}
