import {
  decodeGnuPositionId,
  emptyXgidBoard,
  encodeGnuPositionId,
  formatXgid,
  parseXgid,
  positionIdToXgid,
  splitXgid,
  swapXgidSides,
  Xgid,
  XgidBoard,
  XgidDialect,
  XgidError,
  xgidOnRollSide,
  xgidToPositionId,
} from '../index'

/** The standard opening position, in gnubg's own per-side numbering. */
function openingBoard(): XgidBoard {
  const board = emptyXgidBoard()
  for (const side of board) {
    side[5] = 5
    side[7] = 3
    side[12] = 5
    side[23] = 2
  }
  return board
}

const OPENING_POSITION_ID = '4HPwATDgc/ABMA'

describe('position id', () => {
  it('encodes the standard opening to the canonical id', () => {
    expect(encodeGnuPositionId(openingBoard())).toBe(OPENING_POSITION_ID)
  })

  it('round-trips the standard opening', () => {
    expect(decodeGnuPositionId(OPENING_POSITION_ID)).toEqual(openingBoard())
  })

  it('is always 14 characters', () => {
    expect(encodeGnuPositionId(emptyXgidBoard())).toHaveLength(14)
    expect(encodeGnuPositionId(openingBoard())).toHaveLength(14)
  })

  it('side 0 is serialized first', () => {
    // A single checker for side 0 versus the same for side 1 must differ, and
    // swapping the sides of a board must change its id.
    const a = emptyXgidBoard()
    a[0][0] = 1
    const b = emptyXgidBoard()
    b[1][0] = 1
    expect(encodeGnuPositionId(a)).not.toBe(encodeGnuPositionId(b))
    expect(encodeGnuPositionId(openingBoard())).not.toBe(
      encodeGnuPositionId(swapXgidSides(a))
    )
  })

  it('bits are written least-significant-first', () => {
    // One checker on side 0 point 1 sets bit 0, which is 0x01 -> "AQ...".
    const board = emptyXgidBoard()
    board[0][0] = 1
    expect(encodeGnuPositionId(board)).toBe('AQAAAAAAAAAAAA')
  })

  it('rejects an id of the wrong length', () => {
    expect(() => decodeGnuPositionId('4HPwATDgc/ABM')).toThrow(XgidError)
    expect(() => decodeGnuPositionId('4HPwATDgc/ABMAA')).toThrow(XgidError)
  })

  it('rejects a non-base64 character', () => {
    expect(() => decodeGnuPositionId('4HPwATDgc/ABM!')).toThrow(XgidError)
  })

  it('rejects a board with more than 15 checkers on a side', () => {
    const board = emptyXgidBoard()
    board[0][0] = 16
    expect(() => encodeGnuPositionId(board)).toThrow(XgidError)
  })

  it('rejects both sides occupying one physical point', () => {
    const board = emptyXgidBoard()
    board[0][0] = 1
    board[1][23] = 1 // the same physical point
    expect(() => encodeGnuPositionId(board)).toThrow(XgidError)
  })
})

describe('XGID parsing', () => {
  // The worked example from Open Backgammon Plugin Protocol Draft 0.02.
  const CANONICAL = 'XGID=-a-B--E-B-a-dDB--b-bcb----:1:1:-1:63:0:0:0:3:8'
  const BERGER = '-a-B--E-B-a-dDB--b-bcb----:2:1:-1:63:0:0:0:3'

  it('parses the canonical worked example', () => {
    const xgid = parseXgid(CANONICAL, 'canonical')
    expect(xgid.cubeValue).toBe(2) // cube field 1 is a logarithm
    expect(xgid.cubeOwner).toBe(1)
    expect(xgid.turn).toBe(-1)
    expect(xgid.dice).toEqual({ kind: 'roll', dice: [6, 3] })
    expect(xgid.score).toEqual([0, 0])
    expect(xgid.matchLength).toBe(3)
    expect(xgid.crawford).toBe(false)
    expect(xgid.maxCube).toBe(8)
  })

  it('both sides have 15 checkers in the worked example', () => {
    const { board } = parseXgid(CANONICAL, 'canonical')
    expect(board[0].reduce((a, b) => a + b, 0)).toBe(15)
    expect(board[1].reduce((a, b) => a + b, 0)).toBe(15)
  })

  it("reproduces Draft 0.02's stated canonical-to-berger conversion", () => {
    const xgid = parseXgid(CANONICAL, 'canonical')
    expect(formatXgid(xgid, 'berger')).toBe(BERGER)
  })

  it('the berger dialect reads the cube field literally', () => {
    expect(parseXgid(BERGER, 'berger').cubeValue).toBe(2)
  })

  it('the same field means different cubes in the two dialects', () => {
    const canonical = parseXgid(
      `${'-'.repeat(26)}:2:0:1:31:0:0:0:0:0`,
      'canonical'
    )
    const berger = parseXgid(`${'-'.repeat(26)}:2:0:1:31:0:0:0:0`, 'berger')
    expect(canonical.cubeValue).toBe(4)
    expect(berger.cubeValue).toBe(2)
  })

  it('round-trips both dialects', () => {
    const cases: Array<[string, XgidDialect]> = [
      [CANONICAL.slice('XGID='.length), 'canonical'],
      [BERGER, 'berger'],
    ]
    for (const [text, dialect] of cases) {
      expect(formatXgid(parseXgid(text, dialect), dialect)).toBe(text)
    }
  })

  it('accepts the XGID= prefix and can re-emit it', () => {
    const xgid = parseXgid(CANONICAL, 'canonical')
    expect(formatXgid(xgid, 'canonical', { prefix: true })).toBe(CANONICAL)
  })
})

describe('the overloaded rules field', () => {
  const pos = '-'.repeat(26)

  it('means Crawford in match play', () => {
    expect(parseXgid(`${pos}:0:0:1:31:0:0:1:7:0`, 'canonical').crawford).toBe(
      true
    )
    expect(parseXgid(`${pos}:0:0:1:31:0:0:0:7:0`, 'canonical').crawford).toBe(
      false
    )
  })

  it('means Jacoby and beavers in money play', () => {
    const at = (rules: number): Xgid =>
      parseXgid(`${pos}:0:0:1:31:0:0:${rules}:0:0`, 'canonical')
    expect([at(0).jacoby, at(0).beavers]).toEqual([false, false])
    expect([at(1).jacoby, at(1).beavers]).toEqual([true, false])
    expect([at(2).jacoby, at(2).beavers]).toEqual([false, true])
    expect([at(3).jacoby, at(3).beavers]).toEqual([true, true])
  })

  it('the same field value yields different flags at different match lengths', () => {
    // rules=1 is Crawford in a match and Jacoby in money play.
    const match = parseXgid(`${pos}:0:0:1:31:0:0:1:7:0`, 'canonical')
    const money = parseXgid(`${pos}:0:0:1:31:0:0:1:0:0`, 'canonical')
    expect(match.crawford).toBe(true)
    expect(match.jacoby).toBe(false)
    expect(money.crawford).toBe(false)
    expect(money.jacoby).toBe(true)
  })

  it('rejects rules=2 in match play', () => {
    expect(() =>
      parseXgid(`${pos}:0:0:1:31:0:0:2:7:0`, 'canonical')
    ).toThrow(XgidError)
  })

  it('rejects rules=4 in money play', () => {
    expect(() =>
      parseXgid(`${pos}:0:0:1:31:0:0:4:0:0`, 'canonical')
    ).toThrow(XgidError)
  })
})

describe('dice field', () => {
  const pos = '-'.repeat(26)
  const canonical = (dice: string): Xgid =>
    parseXgid(`${pos}:0:0:1:${dice}:0:0:0:0:0`, 'canonical')

  it('reads a roll', () => {
    expect(canonical('63').dice).toEqual({ kind: 'roll', dice: [6, 3] })
  })

  it("reads canonical 'D' as a pending double", () => {
    expect(canonical('D').dice).toEqual({ kind: 'doubled' })
  })

  it("reads '00' as a cube decision", () => {
    expect(canonical('00').dice).toEqual({ kind: 'cube-decision' })
  })

  it("the berger dialect has no 'D' — Draft 0.02 cannot express a pending double", () => {
    expect(() => parseXgid(`${pos}:1:0:1:D:0:0:0:0`, 'berger')).toThrow(
      XgidError
    )
    expect(() =>
      formatXgid({ ...canonical('D'), cubeValue: 1 }, 'berger')
    ).toThrow(XgidError)
  })

  it('rejects a zero or seven in a roll', () => {
    expect(() => canonical('70')).toThrow(XgidError)
    expect(() => canonical('07')).toThrow(XgidError)
  })
})

describe('field-count and range validation', () => {
  const pos = '-'.repeat(26)

  it('rejects the wrong field count for the dialect', () => {
    expect(() => parseXgid(`${pos}:0:0:1:31:0:0:0:0`, 'canonical')).toThrow(
      XgidError
    )
    expect(() => parseXgid(`${pos}:0:0:1:31:0:0:0:0:0`, 'berger')).toThrow(
      XgidError
    )
  })

  it('rejects a position field that is not 26 characters', () => {
    expect(() =>
      parseXgid(`${'-'.repeat(25)}:0:0:1:31:0:0:0:0:0`, 'canonical')
    ).toThrow(XgidError)
    expect(() =>
      parseXgid(`${'-'.repeat(27)}:0:0:1:31:0:0:0:0:0`, 'canonical')
    ).toThrow(XgidError)
  })

  it('rejects a score at or above the match length', () => {
    expect(() => parseXgid(`${pos}:0:0:1:31:7:0:0:7:0`, 'canonical')).toThrow(
      XgidError
    )
    expect(() => parseXgid(`${pos}:0:0:1:31:0:9:0:7:0`, 'canonical')).toThrow(
      XgidError
    )
  })

  it('allows any score in money play', () => {
    expect(
      parseXgid(`${pos}:0:0:1:31:9:9:0:0:0`, 'canonical').matchLength
    ).toBe(0)
  })

  it('rejects a cube value that is not a power of two', () => {
    expect(() => parseXgid(`${pos}:3:0:1:31:0:0:0:0`, 'berger')).toThrow(
      XgidError
    )
  })

  it('rejects an out-of-range cube owner', () => {
    expect(() => parseXgid(`${pos}:0:2:1:31:0:0:0:0:0`, 'canonical')).toThrow(
      XgidError
    )
  })

  it('rejects a letter of the wrong case on either bar character', () => {
    const bad0 = `A${'-'.repeat(25)}:0:0:1:31:0:0:0:0:0`
    const bad25 = `${'-'.repeat(25)}a:0:0:1:31:0:0:0:0:0`
    expect(() => parseXgid(bad0, 'canonical')).toThrow(XgidError)
    expect(() => parseXgid(bad25, 'canonical')).toThrow(XgidError)
  })
})

describe('the bridge', () => {
  const pos = '-'.repeat(26)

  it('turn 1 selects the lowercase side, anything else the uppercase side', () => {
    expect(xgidOnRollSide({ turn: 1 })).toBe(0)
    expect(xgidOnRollSide({ turn: -1 })).toBe(1)
  })

  it('turn decides which side leads the position id', () => {
    const board = emptyXgidBoard()
    board[0][0] = 1
    const asLower = xgidToPositionId({ board, turn: 1 })
    const asUpper = xgidToPositionId({ board, turn: -1 })
    expect(asLower).not.toBe(asUpper)
    expect(asLower).toBe(encodeGnuPositionId(board))
    expect(asUpper).toBe(encodeGnuPositionId(swapXgidSides(board)))
  })

  it('position id and XGID round-trip through each other', () => {
    const text = '-a-B--E-B-a-dDB--b-bcb----:1:1:-1:63:0:0:0:3:8'
    const xgid = parseXgid(text, 'canonical')
    const { context } = splitXgid(xgid)
    const positionId = xgidToPositionId(xgid)
    expect(positionIdToXgid(positionId, context, 'canonical')).toBe(text)
  })

  it('the round-trip holds for both turn values', () => {
    for (const turn of [1, -1]) {
      const text = `${pos.slice(0, 25)}A:0:0:${turn}:31:0:0:0:0:0`
      const xgid = parseXgid(text, 'canonical')
      const { context } = splitXgid(xgid)
      const positionId = xgidToPositionId(xgid)
      expect(positionIdToXgid(positionId, context, 'canonical')).toBe(text)
    }
  })
})
