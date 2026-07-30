// Differential test against GNU Backgammon itself.
//
// The converter fails silently when it fails: a wrong board is still a legal
// board, and an engine will happily return a good move for the wrong position.
// Inspection does not catch that, so the position-id half is checked against
// gnubg's own encoder and decoder over a large corpus, and the XGID half is
// checked end-to-end by asking gnubg for a play and verifying it is legal on the
// board we believe we encoded.
//
// Skips rather than passing when the addon is absent:
//
//   GNUBG_ADDON=/path/to/build/Release/gnubg_hints.node \
//   GNUBG_WEIGHTS=/path/to/gnubg.wd \
//   npx jest src/XGID
//
// CORPUS_SIZE defaults to 10000.

import { existsSync } from 'fs'
import {
  decodeGnuPositionId,
  emptyXgidBoard,
  encodeGnuPositionId,
  formatXgid,
  parseXgid,
  XgidBoard,
  xgidToPositionId,
} from '../index'

const ADDON_PATH = process.env.GNUBG_ADDON
const WEIGHTS_PATH = process.env.GNUBG_WEIGHTS
const available = Boolean(
  ADDON_PATH && existsSync(ADDON_PATH) && WEIGHTS_PATH
)
const CORPUS_SIZE = Number(process.env.CORPUS_SIZE ?? 10000)

/** The addon is a native module with no type declarations, hence the loose shape. */
interface GnubgAddon {
  initialize: (weights: string, cb: (err: unknown) => void) => void
  shutdown: () => void
  getPositionId: (board: XgidBoard) => string
  decodePositionId: (id: string) => [ArrayLike<number>, ArrayLike<number>]
  getMoveHints: (
    request: Record<string, unknown>,
    ply: number,
    cb: (err: unknown, res: Array<{ moves?: number[][] }>) => void
  ) => void
}

const call = <T>(fn: (cb: (err: unknown, res: T) => void) => void): Promise<T> =>
  new Promise((resolve, reject) =>
    fn((err, res) => (err ? reject(err) : resolve(res)))
  )

let addon: GnubgAddon

// Deterministic PRNG: the corpus is reproducible from the seed alone.
let seed = 0x9e3779b1
function rnd(n: number): number {
  seed ^= seed << 13
  seed >>>= 0
  seed ^= seed >> 17
  seed ^= seed << 5
  seed >>>= 0
  return seed % n
}

/**
 * A legal, arbitrary board. The two sides are mirrored, so a physical point is
 * claimed by at most one of them. Checkers not placed are treated as borne off,
 * which is legal and exercises the short-bitstream path.
 */
function makeBoard(): XgidBoard {
  const board = emptyXgidBoard()
  const owner = new Array<number>(24).fill(-1)
  const remaining = [15, 15]

  for (const side of [0, 1]) {
    if (rnd(5) === 0) {
      const n = 1 + rnd(3)
      board[side][24] = n
      remaining[side] -= n
    }
  }

  let guard = 0
  while ((remaining[0] > 0 || remaining[1] > 0) && guard++ < 6000) {
    const side = remaining[0] > 0 && (remaining[1] === 0 || rnd(2) === 0) ? 0 : 1
    const idx = rnd(24)
    const physical = side === 0 ? idx : 23 - idx
    if (owner[physical] !== -1 && owner[physical] !== side) continue
    if (board[side][idx] >= 15) continue
    const n = Math.min(1 + rnd(3), remaining[side])
    board[side][idx] += n
    owner[physical] = side
    remaining[side] -= n
  }
  // Occasionally leave checkers off entirely.
  if (rnd(4) === 0) {
    const side = rnd(2)
    const idx = rnd(24)
    board[side][idx] = 0
  }
  return board
}

const describeIf = available ? describe : describe.skip

describeIf('differential against gnubg', () => {
  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    addon = require(ADDON_PATH as string) // narrowed by `available`
    await call<unknown>((cb) => addon.initialize(WEIGHTS_PATH as string, cb))
  }, 60000)

  afterAll(() => {
    if (addon) addon.shutdown()
  })

  it(`encodeGnuPositionId matches gnubg over ${CORPUS_SIZE} boards`, () => {
    const mismatches: unknown[] = []
    for (let i = 0; i < CORPUS_SIZE; i++) {
      const board = makeBoard()
      const mine = encodeGnuPositionId(board)
      const theirs = addon.getPositionId(board)
      if (mine !== theirs) mismatches.push({ i, mine, theirs, board })
      if (mismatches.length >= 3) break
    }
    expect(mismatches).toEqual([])
  }, 120000)

  it(`decodeGnuPositionId matches gnubg over ${CORPUS_SIZE} boards`, () => {
    const mismatches: unknown[] = []
    for (let i = 0; i < CORPUS_SIZE; i++) {
      const board = makeBoard()
      const id = addon.getPositionId(board)
      const mine = decodeGnuPositionId(id)
      const theirs = addon.decodePositionId(id)
      const same =
        JSON.stringify(mine[0]) === JSON.stringify([...theirs[0]]) &&
        JSON.stringify(mine[1]) === JSON.stringify([...theirs[1]])
      if (!same) {
        mismatches.push({
          i,
          id,
          mine,
          theirs: [[...theirs[0]], [...theirs[1]]],
        })
      }
      if (mismatches.length >= 3) break
    }
    expect(mismatches).toEqual([])
  }, 120000)

  it('encode and decode are mutual inverses across the corpus', () => {
    for (let i = 0; i < CORPUS_SIZE; i++) {
      const board = makeBoard()
      const back = decodeGnuPositionId(encodeGnuPositionId(board))
      expect(back).toEqual(board)
    }
  }, 120000)

  it('an XGID converts to a position id gnubg reads as the same board', () => {
    // Build an XGID from a board, convert it to a position id with our bridge,
    // and let gnubg decode that id. With turn=1 the lowercase side leads, so
    // gnubg's decoded side 0 must equal the XGID's lowercase side.
    for (let i = 0; i < 500; i++) {
      const board = makeBoard()
      const text = formatXgid(
        {
          board,
          cubeValue: 1,
          cubeOwner: 0,
          turn: 1,
          dice: { kind: 'roll', dice: [3, 1] },
          score: [0, 0],
          matchLength: 0,
          crawford: false,
          jacoby: false,
          beavers: false,
          maxCube: 0,
        },
        'canonical'
      )
      const reparsed = parseXgid(text, 'canonical')
      const positionId = xgidToPositionId(reparsed)
      const viaGnubg = addon.decodePositionId(positionId)
      expect([...viaGnubg[0]]).toEqual(board[0])
      expect([...viaGnubg[1]]).toEqual(board[1])
    }
  }, 120000)

  it('turn = -1 makes gnubg read the uppercase side as on roll', () => {
    for (let i = 0; i < 500; i++) {
      const board = makeBoard()
      const positionId = xgidToPositionId({ board, turn: -1 })
      const viaGnubg = addon.decodePositionId(positionId)
      expect([...viaGnubg[0]]).toEqual(board[1])
      expect([...viaGnubg[1]]).toEqual(board[0])
    }
  }, 120000)

  it('gnubg returns plays that are legal on the board we encoded', async () => {
    let checked = 0
    for (let i = 0; i < 120; i++) {
      const board = makeBoard()
      // The on-roll side needs a checker somewhere to have a play at all.
      if (board[0].reduce((a, b) => a + b, 0) === 0) continue
      const positionId = xgidToPositionId({ board, turn: 1 })
      const hints = await call<Array<{ moves?: number[][] }>>((cb) =>
        addon.getMoveHints(
          {
            positionId,
            dice: [3, 1],
            cubeValue: 1,
            cubeOwner: null,
            matchScore: [0, 0],
            matchLength: 0,
            crawford: false,
            jacoby: true,
            beavers: false,
          },
          1,
          cb
        )
      )
      const moves = hints?.[0]?.moves
      if (!moves?.length) continue
      const [from] = moves[0]
      // 24 is the bar in the addon's indexing. Either way the origin must be a
      // point the on-roll side actually occupies on OUR board.
      expect(board[0][from] ?? 0).toBeGreaterThan(0)
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(40)
  }, 300000)
})
