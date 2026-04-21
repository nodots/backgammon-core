/**
 * Pure-TS decoder for GNU Backgammon position IDs.
 *
 * The companion encoder lives at ./gnuPositionId.ts. Both follow the
 * same convention (see gnuPositionId.ts:42):
 *   TanBoard[0] (bitstream first)  = opponent (NOT on roll)
 *   TanBoard[1] (bitstream second) = player on roll
 *
 * Each 25-entry tan array is indexed [0..23] for points 1..24 in that
 * player's own direction; index 24 is their bar. Callers must supply
 * an on-roll context (color + direction) to map these arrays to
 * concrete players — see importFromDecoded().
 */

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export interface DecodedGnuBoard {
  /** TanBoard[0] — opponent's checkers. 25 entries: 0-23 points 1-24, 24 bar. */
  opponent: number[]
  /** TanBoard[1] — player-on-roll's checkers. 25 entries: 0-23 points 1-24, 24 bar. */
  onRoll: number[]
}

function base64Value(ch: string): number {
  const idx = BASE64_CHARS.indexOf(ch)
  return idx >= 0 ? idx : 0
}

function keyFromPositionId(positionId: string): Uint8Array {
  if (positionId.length !== 14) {
    throw new Error(
      `Invalid position ID length: ${positionId.length}, expected 14`
    )
  }

  const key = new Uint8Array(10)
  let keyIdx = 0

  // Three groups of 4 base64 chars = 3 bytes each.
  for (let i = 0; i < 3; i++) {
    const c0 = base64Value(positionId[i * 4])
    const c1 = base64Value(positionId[i * 4 + 1])
    const c2 = base64Value(positionId[i * 4 + 2])
    const c3 = base64Value(positionId[i * 4 + 3])

    key[keyIdx++] = (c0 << 2) | (c1 >> 4)
    key[keyIdx++] = ((c1 & 0x0f) << 4) | (c2 >> 2)
    key[keyIdx++] = ((c2 & 0x03) << 6) | c3
  }

  // Final 2 base64 chars = 1 byte.
  const c0 = base64Value(positionId[12])
  const c1 = base64Value(positionId[13])
  key[keyIdx] = (c0 << 2) | (c1 >> 4)

  return key
}

function boardFromKey(key: Uint8Array): DecodedGnuBoard {
  const board: DecodedGnuBoard = {
    opponent: new Array(25).fill(0),
    onRoll: new Array(25).fill(0),
  }

  let bitPos = 0

  // Two players: TanBoard[0] first (opponent), then TanBoard[1] (on roll).
  // 25 positions each: points 1-24 then bar. Each count is encoded as
  // N ones followed by a terminating zero (unary).
  for (let player = 0; player < 2; player++) {
    const arr = player === 0 ? board.opponent : board.onRoll

    for (let point = 0; point < 25; point++) {
      let checkerCount = 0

      while (true) {
        const byteIdx = Math.floor(bitPos / 8)
        const bitIdx = bitPos % 8

        if (byteIdx >= 10) break

        const bit = (key[byteIdx] >> bitIdx) & 1
        bitPos++

        if (bit === 0) break
        checkerCount++
      }

      arr[point] = checkerCount
    }
  }

  return board
}

/**
 * Decode a 14-character GNU Backgammon position ID.
 *
 * Returns two tan arrays: `opponent` (TanBoard[0]) and `onRoll`
 * (TanBoard[1]). Callers that need to render must pair these with an
 * on-roll color/direction via importFromDecoded.
 *
 * @throws Error if the position ID is not exactly 14 characters.
 */
export function decodePositionId(positionId: string): DecodedGnuBoard {
  if (!positionId || positionId.length !== 14) {
    throw new Error(
      `Invalid position ID: expected 14 characters, got ${positionId?.length ?? 0}`
    )
  }

  const key = keyFromPositionId(positionId)
  return boardFromKey(key)
}
