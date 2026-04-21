import type {
  BackgammonBoard,
  BackgammonColor,
  BackgammonMoveDirection,
  BackgammonPlayerInactive,
} from '@nodots/backgammon-types'

const toPips = (value: number): BackgammonPlayerInactive['pipCount'] =>
  value as BackgammonPlayerInactive['pipCount']

/**
 * Compute a player's pip count in their own direction of travel.
 *
 * Iterates every point and counts checkers matching `color`, then
 * multiplies by that point's position number in `direction`. Checkers
 * on the player's bar contribute 25 pips each.
 */
export function calculatePipCount(
  board: BackgammonBoard,
  color: BackgammonColor,
  direction: BackgammonMoveDirection
): BackgammonPlayerInactive['pipCount'] {
  let total = 0

  board.points.forEach((point) => {
    const count = point.checkers.filter((c) => c.color === color).length
    if (count > 0) {
      total += count * point.position[direction]
    }
  })

  const barCount = board.bar[direction].checkers.filter(
    (c) => c.color === color
  ).length
  total += barCount * 25

  return toPips(total)
}
