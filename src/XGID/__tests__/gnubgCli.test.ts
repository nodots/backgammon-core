// Differential test of XGID *scalar* semantics against the GNU Backgammon CLI.
//
// The addon-based suite (crossValidate.test.ts) validates the board field
// end-to-end, because gnubg can decode a position id we produced. It cannot
// validate the scalar fields — field order, the cube logarithm, the overloaded
// rules field, `D` — because SetXGID is not among the addon's compiled sources.
// Those semantics previously rested on the spec plus Draft 0.02's single worked
// example.
//
// The gnubg CLI closes that gap: `set xgid <string>` runs the reference parser,
// and one `show` command per field reports how it was understood. That makes
// every scalar field machine-checkable against an independently built binary
// (Debian ships 1.07.001) rather than against our vendored copy.
//
// Skips rather than passing when gnubg is absent:
//
//   sudo apt install gnubg      # or set GNUBG_CLI=/path/to/gnubg
//   npx jest src/XGID
//
// One process per position, deliberately. gnubg preserves some state across
// `set xgid` within a single session — a batched run reports a stale turn/owner
// for at least one combination, and `new session` does not clear it. A fresh
// process costs ~90ms, so correctness here is cheap.

import { execFileSync, spawnSync } from 'child_process'
import { formatXgid, parseXgid, Xgid, xgidToPositionId } from '../index'

const GNUBG = process.env.GNUBG_CLI ?? 'gnubg'

function gnubgAvailable(): boolean {
  try {
    execFileSync(GNUBG, ['--version'], { stdio: 'pipe', timeout: 20000 })
    return true
  } catch {
    return false
  }
}

const available = gnubgAvailable()

/** Everything gnubg will tell us about the position it just parsed. */
interface OracleReading {
  /** From the LAST board printed. `set xgid` echoes the pre-set board first. */
  positionId: string
  cubeValue: number | null // null when gnubg reports no cube state at all
  cubeOwner: string | null // player name, or null when centred
  /** gnubg disables the cube during the Crawford game and reports no value. */
  cubeDisabled: boolean
  /**
   * gnubg says it "cannot handle positions where a double has been offered" and
   * steps back to the pre-double state. Its own XGID/MatchID path cannot carry a
   * pending double either.
   */
  doubleUnrepresentable: boolean
  onRoll: string // player name
  dice: [number, number] | null
  scoreByName: Record<string, number>
  matchLength: number // 0 for a money session
  crawford: boolean
  jacoby: boolean | null // null when not a money session
  beavers: boolean | null
}

/**
 * Ask gnubg to parse an XGID and report what it understood.
 *
 * Returns `null` when gnubg refuses the string — it says so explicitly (`Not a
 * valid XGID '...'`) and then has no position at all, so there is nothing to
 * read back.
 */
function askRaw(xgidBody: string): OracleReading | null {
  const script = [
    `set xgid ${xgidBody}`,
    'show cube',
    'show dice',
    'show turn',
    'show score',
    'show crawford',
    'show jacoby',
    'show beavers',
    // Last, so the final board printed is the position gnubg actually adopted.
    'show board',
    'quit',
    'y',
    '',
  ].join('\n')

  // Diagnostics such as "Not a valid XGID" go to stderr, so both streams are
  // needed — reading stdout alone silently loses every rejection.
  const run = spawnSync(GNUBG, ['-tq'], {
    input: script,
    encoding: 'utf8',
    timeout: 60000,
  })
  const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`

  if (/Not a valid XGID/.test(out)) return null

  // `set xgid` echoes the board as it was BEFORE the change, so the first
  // Position ID in the output is the previous position. Take the last.
  const ids = [...out.matchAll(/Position ID:\s*(\S+)/g)].map((m) => m[1])
  const positionId = ids[ids.length - 1]
  if (!positionId) throw new Error(`no position id in gnubg output for ${xgidBody}`)

  // Absent during the Crawford game, when gnubg reports the cube as disabled
  // instead of giving a value.
  const cube = /The cube is at (\d+), and is (?:owned by (.+?)\.|centred\.)/.exec(out)
  const cubeDisabled = /cube is disabled during the Crawford game/.test(out)
  if (!cube && !cubeDisabled) throw new Error(`no cube line for ${xgidBody}`)

  const rolled = /(.+?) has rolled (\d) and (\d)\./.exec(out)
  const turn = /(.+?) in on (?:roll|move)\./.exec(out)
  if (!turn) throw new Error(`no turn line for ${xgidBody}`)

  // A match line may carry ", post-Crawford play" inside the parentheses.
  const score =
    /The score \(after \d+ games?\) is: (.+?) (\d+), (.+?) (\d+) \((match to (\d+) points[^)]*|money session[^)]*)\)/.exec(
      out
    )
  if (!score) throw new Error(`no score line for ${xgidBody}`)

  // "This money session is played with/without" is the session's own flag.
  // "New money sessions are played with" is the persistent default and must be
  // ignored — it reports a setting, not this position.
  const jacobyLine = /This money session is played (with|without) the Jacoby rule/.exec(out)
  const beaversLine = /(No beavers allowed|\d+ beavers\/raccoons allowed)/.exec(out)

  return {
    positionId,
    cubeValue: cube ? Number(cube[1]) : null,
    cubeOwner: cube?.[2] ?? null,
    cubeDisabled,
    doubleUnrepresentable: /cannot handle positions where a double has been offered/.test(
      out
    ),
    onRoll: turn[1].trim(),
    dice: rolled ? [Number(rolled[2]), Number(rolled[3])] : null,
    scoreByName: {
      [score[1].trim()]: Number(score[2]),
      [score[3].trim()]: Number(score[4]),
    },
    matchLength: score[6] ? Number(score[6]) : 0,
    crawford: /This game is the Crawford game/.test(out),
    jacoby: jacobyLine ? jacobyLine[1] === 'with' : null,
    beavers: beaversLine ? !beaversLine[1].startsWith('No') : null,
  }
}

/** For the positions gnubg is expected to accept. Fails loudly if it does not. */
function ask(xgidBody: string): OracleReading {
  const reading = askRaw(xgidBody)
  if (!reading) throw new Error(`gnubg rejected an XGID we expected it to accept: ${xgidBody}`)
  return reading
}

const POS = '-a-B--E-B-a-dDB--b-bcb----'

/**
 * gnubg names its players from local configuration, so the mapping from XGID
 * side to player name is calibrated rather than hardcoded. `turn = 1` selects
 * the lowercase side, `turn = -1` the uppercase side.
 */
let lowerName = ''
let upperName = ''

const describeIf = available ? describe : describe.skip

describeIf('XGID scalars against the gnubg CLI', () => {
  beforeAll(() => {
    lowerName = ask(`${POS}:0:0:1:00:0:0:0:0:0`).onRoll
    upperName = ask(`${POS}:0:0:-1:00:0:0:0:0:0`).onRoll
    expect(lowerName).not.toBe(upperName)
  }, 60000)

  it('agrees on the board: our position id is what gnubg derives', () => {
    for (const turn of [1, -1]) {
      const body = `${POS}:0:0:${turn}:00:0:0:0:0:0`
      expect(ask(body).positionId).toBe(xgidToPositionId(parseXgid(body, 'canonical')))
    }
  }, 60000)

  it('reads the cube field as a base-2 logarithm, for every value 1..64', () => {
    // The single most consequential scalar: a raw/log2 misread doubles every
    // cube decision while leaving checker play untouched.
    for (let field = 0; field <= 6; field++) {
      const body = `${POS}:${field}:0:1:00:0:0:0:0:0`
      const ours = parseXgid(body, 'canonical')
      expect(ours.cubeValue).toBe(2 ** field)
      expect(ask(body).cubeValue).toBe(ours.cubeValue)
    }
  }, 120000)

  it('agrees on cube ownership for both turn values', () => {
    for (const turn of [1, -1]) {
      for (const owner of [1, -1, 0]) {
        const body = `${POS}:2:${owner}:${turn}:00:0:0:0:0:0`
        const ours = parseXgid(body, 'canonical')
        const theirs = ask(body)
        const expected =
          owner === 0 ? null : owner === 1 ? lowerName : upperName
        expect(theirs.cubeOwner).toBe(expected)
        expect(ours.cubeOwner).toBe(owner)
      }
    }
  }, 180000)

  it('agrees which side is on roll', () => {
    for (const turn of [1, -1]) {
      const body = `${POS}:0:0:${turn}:00:0:0:0:0:0`
      expect(ask(body).onRoll).toBe(turn === 1 ? lowerName : upperName)
    }
  }, 60000)

  it('agrees on every one of the 36 rolls', () => {
    for (let d0 = 1; d0 <= 6; d0++) {
      for (let d1 = 1; d1 <= 6; d1++) {
        const body = `${POS}:0:0:1:${d0}${d1}:0:0:0:0:0`
        const ours = parseXgid(body, 'canonical')
        const theirs = ask(body)
        expect(ours.dice).toEqual({ kind: 'roll', dice: [d0, d1] })
        // gnubg reports the roll unordered-normalised, so compare as a set.
        expect([...(theirs.dice as [number, number])].sort()).toEqual(
          [d0, d1].sort()
        )
      }
    }
  }, 300000)

  it("reads '00' as no roll yet — a cube decision", () => {
    const body = `${POS}:0:0:1:00:0:0:0:0:0`
    expect(parseXgid(body, 'canonical').dice).toEqual({ kind: 'cube-decision' })
    expect(ask(body).dice).toBeNull()
  }, 60000)

  it("reads 'D' as a pending double, which gnubg itself cannot hold", () => {
    // We represent the state faithfully. gnubg accepts the string but says it
    // "cannot handle positions where a double has been offered" and steps back
    // to the offering of the cube, landing on the pre-double state.
    //
    // So the take/drop decision is unreachable through an XGID on the CANONICAL
    // path too, not only in Draft 0.02. Our spec's §5.2 suggestion that
    // retaining gnubg's `D` would close that gap does not survive this.
    const body = `${POS}:0:0:1:D:0:0:0:0:0`
    expect(parseXgid(body, 'canonical').dice).toEqual({ kind: 'doubled' })

    const theirs = ask(body)
    expect(theirs.doubleUnrepresentable).toBe(true)
    // Stepped back: no roll, cube still centred at 1, roll owner unchanged.
    expect(theirs.dice).toBeNull()
    expect(theirs.cubeValue).toBe(1)
    expect(theirs.cubeOwner).toBeNull()
    expect(theirs.onRoll).toBe(lowerName)
  }, 60000)

  it('agrees on the score and match length', () => {
    const cases: Array<[number, number, number]> = [
      [0, 0, 0],
      [0, 0, 3],
      [2, 5, 7],
      [4, 4, 9],
      [0, 10, 11],
    ]
    for (const [s0, s1, len] of cases) {
      const body = `${POS}:0:0:1:00:${s0}:${s1}:0:${len}:0`
      const ours = parseXgid(body, 'canonical')
      const theirs = ask(body)
      expect(ours.score).toEqual([s0, s1])
      expect(ours.matchLength).toBe(len)
      expect(theirs.matchLength).toBe(len)
      expect(theirs.scoreByName[lowerName]).toBe(s0)
      expect(theirs.scoreByName[upperName]).toBe(s1)
    }
  }, 180000)

  it('agrees on the overloaded rules field in money play', () => {
    // The trap: one field, two meanings, selected by match length.
    const expected = [
      { jacoby: false, beavers: false },
      { jacoby: true, beavers: false },
      { jacoby: false, beavers: true },
      { jacoby: true, beavers: true },
    ]
    for (let rules = 0; rules <= 3; rules++) {
      const body = `${POS}:0:0:1:00:0:0:${rules}:0:0`
      const ours = parseXgid(body, 'canonical')
      const theirs = ask(body)
      expect(ours.jacoby).toBe(expected[rules].jacoby)
      expect(ours.beavers).toBe(expected[rules].beavers)
      expect(theirs.jacoby).toBe(expected[rules].jacoby)
      expect(theirs.beavers).toBe(expected[rules].beavers)
      expect(ours.crawford).toBe(false)
    }
  }, 180000)

  it('agrees on the same field meaning Crawford in match play', () => {
    // Only checkable at a score where Crawford is possible: gnubg reports the
    // game state, not the raw flag, so at 2-5 of 7 no flag value can make it
    // the Crawford game.
    for (const [s0, s1] of [
      [6, 2],
      [2, 6],
    ]) {
      for (const rules of [0, 1]) {
        const body = `${POS}:0:0:1:00:${s0}:${s1}:${rules}:7:0`
        const ours = parseXgid(body, 'canonical')
        const theirs = ask(body)
        expect(ours.crawford).toBe(rules === 1)
        expect(theirs.crawford).toBe(rules === 1)
        // In the Crawford game gnubg reports the cube as disabled rather than
        // giving it a value, which is a second, independent confirmation that
        // the flag was understood.
        expect(theirs.cubeDisabled).toBe(rules === 1)
        // Jacoby is a money-play concept and must not leak out of a match.
        expect(ours.jacoby).toBe(false)
      }
    }
  }, 180000)

  it('rejects what gnubg rejects: score at or above the match length', () => {
    const body = `${POS}:0:0:1:00:7:0:0:7:0`
    expect(() => parseXgid(body, 'canonical')).toThrow()
    // gnubg declines it too, explicitly. Guard that the same string with a
    // legal score IS accepted, so this is evidence about the score rather than
    // about the rest of the string.
    expect(askRaw(body)).toBeNull()
    expect(askRaw(`${POS}:0:0:1:00:6:0:0:7:0`)).not.toBeNull()
  }, 120000)

  it('round-trips a bgblitz-dialect string through gnubg via canonical', () => {
    // gnubg does not accept Frank's dialect, so the bridge is
    // bgblitz -> our parse -> canonical -> gnubg. That is the path the socket
    // server will take, so it is the one worth proving. Money play, to keep
    // this about the dialect rather than about cube values a short match cannot
    // reach.
    const bgblitz = `${POS}:4:1:-1:63:0:0:0:0`
    const asXgid: Xgid = parseXgid(bgblitz, 'bgblitz')
    expect(asXgid.cubeValue).toBe(4) // literal in bgblitz, not a logarithm
    const canonical = formatXgid(asXgid, 'canonical')
    expect(canonical).toBe(`${POS}:2:1:-1:63:0:0:0:0:0`) // 4 -> log2 2
    const theirs = ask(canonical)
    expect(theirs.cubeValue).toBe(4)
    expect(theirs.positionId).toBe(xgidToPositionId(asXgid))
  }, 60000)
})
