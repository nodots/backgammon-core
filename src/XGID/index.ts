/**
 * Conversion between XGID strings and GNU Backgammon position ids.
 *
 * Zero dependencies on the rest of core, and no GPL-derived content: the format
 * details come from `docs/spec-xgid-gnu-position-id.md` in the workspace, not
 * from gnubg sources.
 *
 * The two identifiers carry different amounts of information and use different
 * frames of reference, which is most of what makes this non-trivial:
 *
 *   - A **position id** encodes the board only, and encodes it *relative to the
 *     player on roll*: the first-serialized side is the side to move. It carries
 *     no turn marker, no cube, no score.
 *   - An **XGID** encodes the board in an absolute frame (one side is lowercase,
 *     the other uppercase) plus the cube, dice, score, match length and rules,
 *     and names the player on roll in a separate field.
 *
 * So converting an XGID to a position id means selecting the on-roll side and
 * reordering the board accordingly; converting back requires supplying the turn
 * and everything else from outside.
 *
 * ## Relationship to `exportToGnuPositionId`
 *
 * Core contains a second GNU position id encoder, `Board/gnuPositionId.ts`, and
 * the two use **opposite side orderings**. {@link encodeGnuPositionId} here is
 * `on-roll-first` — the ordering gnubg itself produces, established empirically
 * against the compiled addon rather than by reading its sources. Core's
 * `exportToGnuPositionId` serializes the opponent first, i.e. `opponent-first`,
 * which is the engine protocol's default `positionIdConvention`. Neither is
 * "the" encoder: an id is only meaningful alongside the convention it was
 * written in. Do not assume they are interchangeable.
 */

/** Checker counts for one side: indices 0..23 are that side's points 1..24, index 24 is its bar. */
export type XgidSide = number[]

/**
 * A board as two sides.
 *
 * The two sides are mirrored: `board[0][i]` and `board[1][23 - i]` name the same
 * physical point, so at most one of them may be non-zero.
 */
export type XgidBoard = [XgidSide, XgidSide]

/** Which side of a decoded XGID board is on roll. */
export type XgidSideIndex = 0 | 1

/** `1` = uppercase side owns the cube, `-1` = lowercase side, `0` = centred. */
export type XgidCubeOwner = -1 | 0 | 1

/**
 * XGID dialects.
 *
 * - `canonical` — as produced by eXtreme Gammon and accepted by gnubg: ten
 *   fields after the position, cube encoded as a base-2 logarithm, trailing
 *   max-cube field present.
 * - `bgblitz` — the dialect in Frank Berger's Open Backgammon Plugin Protocol
 *   (Draft 0.02): nine fields, cube encoded as its literal value, no max-cube,
 *   and `00` in the dice field to request a cube decision.
 *
 * There is no in-band marker distinguishing them, so the dialect is always an
 * explicit argument. Guessing corrupts the cube on every position: a field value
 * `v` means cube `v` in one dialect and `2 ** v` in the other, and `v === 2 ** v`
 * has no solution. Worse, the corruption is invisible in checker-play tests,
 * because cube value barely affects best checker play.
 */
export type XgidDialect = 'canonical' | 'bgblitz'

/** What the dice field was carrying. */
export type XgidDiceState =
  /** Two dice to play. */
  | { kind: 'roll'; dice: [number, number] }
  /** A double has been offered; the player facing it is to decide. Canonical `D`. */
  | { kind: 'doubled' }
  /** No roll: the player on roll is to make a cube decision. BGBlitz `00`. */
  | { kind: 'cube-decision' }

/** A parsed XGID. */
export interface Xgid {
  /** `board[0]` is the lowercase side, `board[1]` the uppercase side. */
  board: XgidBoard
  /** The literal cube value: 1, 2, 4, 8, … (never the logarithm). */
  cubeValue: number
  cubeOwner: XgidCubeOwner
  /** The turn field, verbatim. `1` selects the lowercase side; see {@link xgidOnRollSide}. */
  turn: number
  dice: XgidDiceState
  /** `[lowercase, uppercase]` points scored. */
  score: [number, number]
  /** Match target. `0` means money play. */
  matchLength: number
  /** Crawford game. Only meaningful when `matchLength > 0`. */
  crawford: boolean
  /** Jacoby rule. Only meaningful in money play. */
  jacoby: boolean
  /** Beavers allowed. Only meaningful in money play. */
  beavers: boolean
  /** Canonical dialect only. gnubg ignores it; `0` additionally disables cube use. */
  maxCube?: number
}

/** Thrown for any malformed or illegal input. */
export class XgidError extends Error {
  override name = 'XgidError'
}

const fail = (msg: string): never => {
  throw new XgidError(msg)
}

const POSITION_LENGTH = 26
const MAX_CHECKERS = 15
const POSITION_ID_LENGTH = 14
const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const emptySide = (): XgidSide => new Array<number>(25).fill(0)

/** A fresh empty board. */
export const emptyXgidBoard = (): XgidBoard => [emptySide(), emptySide()]

/**
 * Which side of `xgid.board` is on roll.
 *
 * The turn field selects the lowercase side when it is exactly `1`, and the
 * uppercase side otherwise. This asymmetry is not a guess: it is the behaviour a
 * position id derived from an XGID must match, verified against gnubg's decoder
 * for both turn values.
 */
export const xgidOnRollSide = (xgid: Pick<Xgid, 'turn'>): XgidSideIndex =>
  xgid.turn === 1 ? 0 : 1

/** `[board[1], board[0]]`. Cheap, and does not mutate the input. */
export const swapXgidSides = (board: XgidBoard): XgidBoard => [
  board[1].slice(),
  board[0].slice(),
]

const totalCheckers = (side: XgidSide): number =>
  side.reduce((sum, n) => sum + n, 0)

function validateBoard(board: XgidBoard): void {
  for (let index = 0; index < 2; index++) {
    const side = board[index]
    if (side.length !== 25) {
      fail(`side ${index} must have 25 entries, got ${side.length}`)
    }
    for (const [point, count] of side.entries()) {
      if (!Number.isInteger(count) || count < 0) {
        fail(`side ${index} point ${point} has a non-integral count: ${count}`)
      }
    }
    const total = totalCheckers(side)
    if (total > MAX_CHECKERS) {
      fail(`side ${index} has ${total} checkers, more than ${MAX_CHECKERS}`)
    }
  }
  // The two sides are mirrored, so a physical point may only be held by one.
  for (let i = 0; i < 24; i++) {
    const lo = board[0][i]
    const hi = board[1][23 - i]
    if (lo > 0 && hi > 0) {
      fail(
        `both sides occupy one physical point: board[0][${i}]=${lo} and board[1][${
          23 - i
        }]=${hi}`
      )
    }
  }
}

// ---------------------------------------------------------------------------
// GNU position id
// ---------------------------------------------------------------------------

/**
 * Encode a board as a 14-character GNU position id, `on-roll-first`.
 *
 * `board[0]` is serialized first, and a position id is read relative to the
 * player on roll, so **pass the on-roll side first**. Use
 * {@link xgidToPositionId} rather than calling this directly with an XGID board,
 * which is in an absolute frame.
 *
 * Each point contributes its checker count as that many 1-bits followed by a
 * single 0-bit; bits are written least-significant-first into 10 bytes, then
 * base64-encoded with the standard alphabet (`+` and `/` do occur, so the result
 * is not URL-safe).
 */
export function encodeGnuPositionId(board: XgidBoard): string {
  validateBoard(board)

  const bytes = new Uint8Array(10)
  let bit = 0

  const put = (): void => {
    const byte = bit >> 3
    if (byte >= bytes.length) fail('board does not fit in 80 bits')
    bytes[byte] = bytes[byte] | (1 << (bit & 7))
  }

  for (const side of board) {
    for (const count of side) {
      for (let n = 0; n < count; n++) {
        put()
        bit++
      }
      // The 0-bit terminating this point is implicit: the array starts zeroed.
      bit++
    }
  }

  let out = ''
  for (let i = 0; i < 9; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += BASE64[b0 >> 2]
    out += BASE64[((b0 & 0x03) << 4) | (b1 >> 4)]
    out += BASE64[((b1 & 0x0f) << 2) | (b2 >> 6)]
    out += BASE64[b2 & 0x3f]
  }
  const last = bytes[9]
  out += BASE64[last >> 2]
  out += BASE64[(last & 0x03) << 4]
  return out
}

/**
 * Decode a 14-character GNU position id written `on-roll-first`.
 *
 * The returned `board[0]` is the side the id was encoded relative to — the
 * player on roll.
 */
export function decodeGnuPositionId(positionId: string): XgidBoard {
  if (positionId.length !== POSITION_ID_LENGTH) {
    fail(
      `position id must be ${POSITION_ID_LENGTH} characters, got ${positionId.length}`
    )
  }

  const sextets = new Array<number>(POSITION_ID_LENGTH)
  for (const [i, ch] of [...positionId].entries()) {
    const v = BASE64.indexOf(ch)
    if (v < 0) fail(`position id contains a non-base64 character: ${ch}`)
    sextets[i] = v
  }

  const bytes = new Uint8Array(10)
  for (let i = 0, j = 0; i < 9; i += 3, j += 4) {
    const s0 = sextets[j]
    const s1 = sextets[j + 1]
    const s2 = sextets[j + 2]
    const s3 = sextets[j + 3]
    bytes[i] = ((s0 << 2) | (s1 >> 4)) & 0xff
    bytes[i + 1] = ((s1 << 4) | (s2 >> 2)) & 0xff
    bytes[i + 2] = ((s2 << 6) | s3) & 0xff
  }
  bytes[9] = ((sextets[12] << 2) | (sextets[13] >> 4)) & 0xff

  const board = emptyXgidBoard()
  let bit = 0
  const read = (): number => {
    const byte = bit >> 3
    const value = (bytes[byte] >> (bit & 7)) & 1
    bit++
    return value
  }

  for (const side of board) {
    for (let point = 0; point < 25; point++) {
      let count = 0
      while (bit < 80 && read() === 1) count++
      if (count > MAX_CHECKERS) {
        fail(`position id decodes to ${count} checkers on one point`)
      }
      side[point] = count
    }
  }

  validateBoard(board)
  return board
}

// ---------------------------------------------------------------------------
// XGID
// ---------------------------------------------------------------------------

/**
 * Decode the 26-character position field.
 *
 * Character 0 is the lowercase side's bar and character 25 the uppercase side's;
 * for characters 1..24 an uppercase letter is the uppercase side's point `i` and
 * a lowercase letter is the lowercase side's point `25 - i`.
 */
function parsePositionField(pos: string): XgidBoard {
  if (pos.length !== POSITION_LENGTH) {
    fail(
      `position field must be ${POSITION_LENGTH} characters, got ${pos.length}`
    )
  }
  const board = emptyXgidBoard()

  for (const [i, ch] of [...pos].entries()) {
    if (ch === '-') continue

    const isUpper = ch >= 'A' && ch <= 'Z'
    const isLower = ch >= 'a' && ch <= 'z'
    if (!isUpper && !isLower) {
      fail(`position field character ${i} is not a letter or '-': ${ch}`)
    }
    const count =
      ch.charCodeAt(0) - (isUpper ? 'A'.charCodeAt(0) : 'a'.charCodeAt(0)) + 1
    if (count > MAX_CHECKERS) {
      fail(`position field character ${i} encodes ${count} checkers`)
    }

    // Index 0 belongs only to the lowercase side and index 25 only to the
    // uppercase side; a letter of the wrong case there names no point.
    if (i === 0) {
      if (isUpper) fail("position field character 0 is the lowercase side's bar")
      board[0][24] = count
    } else if (i === 25) {
      if (isLower)
        fail("position field character 25 is the uppercase side's bar")
      board[1][24] = count
    } else if (isUpper) {
      board[1][i - 1] = count
    } else {
      board[0][24 - i] = count
    }
  }

  validateBoard(board)
  return board
}

/** Inverse of {@link parsePositionField}. */
function formatPositionField(board: XgidBoard): string {
  validateBoard(board)
  const chars = new Array<string>(POSITION_LENGTH).fill('-')

  const bar0 = board[0][24]
  if (bar0 > 0) chars[0] = String.fromCharCode('a'.charCodeAt(0) + bar0 - 1)
  const bar1 = board[1][24]
  if (bar1 > 0) chars[25] = String.fromCharCode('A'.charCodeAt(0) + bar1 - 1)

  for (let i = 1; i <= 24; i++) {
    const upper = board[1][i - 1]
    const lower = board[0][24 - i]
    if (upper > 0) {
      chars[i] = String.fromCharCode('A'.charCodeAt(0) + upper - 1)
    } else if (lower > 0) {
      chars[i] = String.fromCharCode('a'.charCodeAt(0) + lower - 1)
    }
  }
  return chars.join('')
}

function parseDice(field: string, dialect: XgidDialect): XgidDiceState {
  if (field === 'D') {
    if (dialect === 'bgblitz') {
      fail("the bgblitz dialect has no 'D' dice value; see Draft 0.02 §5.2")
    }
    return { kind: 'doubled' }
  }
  if (field === '00') return { kind: 'cube-decision' }
  if (!/^[1-6][1-6]$/.test(field)) {
    fail(`dice field must be two digits 1-6, 'D', or '00': ${field}`)
  }
  const dice: [number, number] = [Number(field[0]), Number(field[1])]
  return { kind: 'roll', dice }
}

function formatDice(dice: XgidDiceState, dialect: XgidDialect): string {
  switch (dice.kind) {
    case 'roll':
      return `${dice.dice[0]}${dice.dice[1]}`
    case 'doubled':
      if (dialect === 'bgblitz') {
        fail(
          "the bgblitz dialect cannot express a pending double; see Draft 0.02 §5.2"
        )
      }
      return 'D'
    case 'cube-decision':
      return '00'
  }
}

const FIELD_COUNT: Record<XgidDialect, number> = { canonical: 10, bgblitz: 9 }

/**
 * Parse an XGID.
 *
 * The `XGID=` prefix is accepted but not required. `dialect` is mandatory — see
 * {@link XgidDialect} for why it cannot be inferred.
 */
export function parseXgid(input: string, dialect: XgidDialect): Xgid {
  const trimmed = input.trim()
  const body = trimmed.startsWith('XGID=')
    ? trimmed.slice('XGID='.length)
    : trimmed

  const fields = body.split(':')
  const expected = FIELD_COUNT[dialect]
  if (fields.length !== expected) {
    fail(
      `${dialect} XGID needs ${expected} colon-separated fields, got ${fields.length}`
    )
  }

  const board = parsePositionField(fields[0])

  const rawCube = Number(fields[1])
  if (!Number.isInteger(rawCube) || rawCube < 0) {
    fail(`cube field must be a non-negative integer: ${fields[1]}`)
  }
  const cubeValue = dialect === 'canonical' ? 2 ** rawCube : rawCube
  if (cubeValue < 1 || (cubeValue & (cubeValue - 1)) !== 0) {
    fail(`cube value must be a power of two, got ${cubeValue}`)
  }

  const rawOwner = Number(fields[2])
  if (rawOwner !== -1 && rawOwner !== 0 && rawOwner !== 1) {
    fail(`cube owner must be -1, 0 or 1: ${fields[2]}`)
  }
  // Narrowed by the check above rather than cast.
  const cubeOwner: XgidCubeOwner = rawOwner === 1 ? 1 : rawOwner === -1 ? -1 : 0

  const turn = Number(fields[3])
  if (!Number.isInteger(turn)) fail(`turn field must be an integer: ${fields[3]}`)

  const dice = parseDice(fields[4], dialect)

  const score0 = Number(fields[5])
  const score1 = Number(fields[6])
  if (
    !Number.isInteger(score0) ||
    !Number.isInteger(score1) ||
    score0 < 0 ||
    score1 < 0
  ) {
    fail(`scores must be non-negative integers: ${fields[5]}, ${fields[6]}`)
  }

  const rules = Number(fields[7])
  const matchLength = Number(fields[8])
  if (!Number.isInteger(matchLength) || matchLength < 0) {
    fail(`match length must be a non-negative integer: ${fields[8]}`)
  }
  if (matchLength > 0 && (score0 >= matchLength || score1 >= matchLength)) {
    fail(`score ${score0}-${score1} is not below the match length ${matchLength}`)
  }

  // One field, two meanings, selected by the match length. Reading it without
  // consulting matchLength silently produces the wrong flags.
  let crawford = false
  let jacoby = false
  let beavers = false
  if (matchLength > 0) {
    if (rules !== 0 && rules !== 1) {
      fail(`in match play the rules field must be 0 or 1, got ${rules}`)
    }
    crawford = rules === 1
  } else {
    if (![0, 1, 2, 3].includes(rules)) {
      fail(`in money play the rules field must be 0..3, got ${rules}`)
    }
    jacoby = rules === 1 || rules === 3
    beavers = rules === 2 || rules === 3
  }

  const xgid: Xgid = {
    board,
    cubeValue,
    cubeOwner,
    turn,
    dice,
    score: [score0, score1],
    matchLength,
    crawford,
    jacoby,
    beavers,
  }

  if (dialect === 'canonical') {
    const maxCube = Number(fields[9])
    if (!Number.isInteger(maxCube) || maxCube < 0) {
      fail(`max cube must be a non-negative integer: ${fields[9]}`)
    }
    xgid.maxCube = maxCube
  }

  return xgid
}

/** Serialize an {@link Xgid}. Inverse of {@link parseXgid} for the same dialect. */
export function formatXgid(
  xgid: Xgid,
  dialect: XgidDialect,
  options: { prefix?: boolean } = {}
): string {
  const { cubeValue, matchLength } = xgid
  if (cubeValue < 1 || (cubeValue & (cubeValue - 1)) !== 0) {
    fail(`cube value must be a power of two, got ${cubeValue}`)
  }

  const cubeField = dialect === 'canonical' ? Math.log2(cubeValue) : cubeValue

  const rules =
    matchLength > 0
      ? xgid.crawford
        ? 1
        : 0
      : (xgid.jacoby ? 1 : 0) + (xgid.beavers ? 2 : 0)

  const fields = [
    formatPositionField(xgid.board),
    String(cubeField),
    String(xgid.cubeOwner),
    String(xgid.turn),
    formatDice(xgid.dice, dialect),
    String(xgid.score[0]),
    String(xgid.score[1]),
    String(rules),
    String(matchLength),
  ]

  if (dialect === 'canonical') fields.push(String(xgid.maxCube ?? 0))

  const body = fields.join(':')
  return options.prefix ? `XGID=${body}` : body
}

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

/**
 * Position id for an XGID, with the on-roll side placed first.
 *
 * This is the conversion that matters: an XGID board is absolute, a position id
 * is relative to the player on roll, and the turn field is what reconciles them.
 */
export function xgidToPositionId(xgid: Pick<Xgid, 'board' | 'turn'>): string {
  const board =
    xgidOnRollSide(xgid) === 0 ? xgid.board : swapXgidSides(xgid.board)
  return encodeGnuPositionId(board)
}

/**
 * Everything an XGID says that a position id cannot.
 *
 * Returned separately because a caller reconstructing an XGID from a position id
 * has to supply all of it from somewhere else.
 */
export interface XgidContext {
  cubeValue: number
  cubeOwner: XgidCubeOwner
  turn: number
  dice: XgidDiceState
  score: [number, number]
  matchLength: number
  crawford: boolean
  jacoby: boolean
  beavers: boolean
  maxCube?: number
}

/** Split a parsed XGID into its board and everything else. */
export function splitXgid(xgid: Xgid): {
  board: XgidBoard
  context: XgidContext
} {
  const { board, ...context } = xgid
  return { board, context }
}

/**
 * Rebuild an XGID from a position id plus the context a position id cannot
 * carry.
 *
 * The position id's first side is the player on roll, so the board is reordered
 * back into the absolute frame that `context.turn` implies.
 */
export function positionIdToXgid(
  positionId: string,
  context: XgidContext,
  dialect: XgidDialect,
  options: { prefix?: boolean } = {}
): string {
  const onRollFirst = decodeGnuPositionId(positionId)
  const board =
    xgidOnRollSide(context) === 0 ? onRollFirst : swapXgidSides(onRollFirst)
  return formatXgid({ ...context, board }, dialect, options)
}
