import type {
  BackgammonColor,
  BackgammonMoveDirection,
} from '@nodots/backgammon-types'

/**
 * Coordinate-frame helpers and board-region classifier.
 *
 * Convention:
 *   - "GNU frame" is the 1-24 numbering from the on-roll player's
 *     own direction of travel. This is what the GNU native addon
 *     returns in MoveHint.moves[i].from / .to.
 *   - "Clockwise frame" is the 1-24 numbering used for rendering.
 *     The UI treats clockwise = 1..24 as a fixed coordinate system;
 *     the counterclockwise player sees the same points as 24..1 in
 *     their own frame, and the board is visually flipped for them.
 *
 * When the on-roll player moves clockwise, GNU's frame already
 * matches the clockwise rendering frame. When the on-roll player
 * moves counterclockwise, each point number must be flipped
 * (p → 25 - p).
 *
 * Special values pass through unchanged:
 *   0  = off (bear-off)
 *   25 = bar
 */

export type BoardRegion =
  | 'bearingOff'
  | 'homeInner'
  | 'outerBoard'
  | 'opponentOuter'
  | 'opponentInner'
  | 'opponentBearing'
  | 'bar'
  | 'off'

export interface OnRollContext {
  color: BackgammonColor
  direction: BackgammonMoveDirection
}

const BAR = 25
const OFF = 0

/**
 * Flip a GNU-frame point (1-24, from on-roll's direction) into the
 * clockwise 1-24 frame used for rendering. Pass 0/25 through.
 */
export function fromGnuFrame(
  point: number,
  onRollDirection: BackgammonMoveDirection
): number {
  if (point === BAR || point === OFF) return point
  if (point < 1 || point > 24) return point
  return onRollDirection === 'clockwise' ? point : 25 - point
}

/**
 * Flip a clockwise-frame point (1-24) into the GNU on-roll frame.
 * Inverse of fromGnuFrame. Pass 0/25 through.
 */
export function toGnuFrame(
  clockwisePoint: number,
  onRollDirection: BackgammonMoveDirection
): number {
  // The flip is symmetric, but exposing both names makes call sites
  // self-documenting about which direction the conversion runs.
  return fromGnuFrame(clockwisePoint, onRollDirection)
}

/**
 * Classify a point in the GNU on-roll frame as a board region from
 * the on-roll player's perspective. Preserves the bucket names the
 * API already uses for PR/stats aggregation.
 *
 *   1-3   = bearingOff
 *   4-6   = homeInner
 *   7-12  = outerBoard
 *   13-18 = opponentOuter
 *   19-21 = opponentInner
 *   22-24 = opponentBearing
 *   0     = off
 *   25    = bar
 *
 * Replaces the point-only classifier that lived in
 * api/src/utils/pr-extraction.ts. The `onRoll` arg is part of the
 * signature for forward compatibility and self-documentation: region
 * names are expressed in the on-roll player's frame, and callers must
 * pre-translate into the on-roll frame before calling.
 */
export function classifyRegion(
  point: number | string,
  _onRoll: Pick<OnRollContext, 'direction'>
): BoardRegion {
  if (point === 'bar' || point === BAR) return 'bar'
  if (point === 'off' || point === OFF) return 'off'

  const pos = typeof point === 'number' ? point : parseInt(point, 10)
  if (Number.isNaN(pos)) return 'outerBoard'

  if (pos >= 1 && pos <= 3) return 'bearingOff'
  if (pos >= 4 && pos <= 6) return 'homeInner'
  if (pos >= 7 && pos <= 12) return 'outerBoard'
  if (pos >= 13 && pos <= 18) return 'opponentOuter'
  if (pos >= 19 && pos <= 21) return 'opponentInner'
  if (pos >= 22 && pos <= 24) return 'opponentBearing'

  return 'outerBoard'
}

/**
 * Given an on-roll color, return the opposing color.
 */
export function opponentOf(ctx: OnRollContext): OnRollContext {
  return {
    color: ctx.color === 'white' ? 'black' : 'white',
    direction: ctx.direction === 'clockwise' ? 'counterclockwise' : 'clockwise',
  }
}
