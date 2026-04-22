# @nodots/backgammon-core

Pure, deterministic backgammon game logic in TypeScript. Board, moves, play state, dice, cube, GNU position IDs, and performance-rating calculation — the same engine that runs [backgammon.nodots.com](https://backgammon.nodots.com) in production.

## Install

```sh
npm install @nodots/backgammon-core
```

## Quick start

```ts
import { Game } from '@nodots/backgammon-core'

const game = Game.createNewGame(
  { userId: 'alice', isRobot: false },
  { userId: 'bob',   isRobot: true  },
)

const started = Game.rollForStart(game)
const rolled  = Game.roll(started)

// rolled.activePlay.moves holds every legal move option for the rolled dice.
// Execute one with Game.move, passing the origin checker container.
```

For AI-driven turns, pair with [`@nodots/backgammon-ai`](https://www.npmjs.com/package/@nodots/backgammon-ai) and call `executeRobotTurnWithGNU(game)`.

## What's in the package

| Module | Purpose |
| --- | --- |
| `Game` | State machine for a full game: initialize, roll, move, double, accept, resign, confirm. |
| `Play` | Per-turn structure holding dice and every legal move sequence. |
| `Board` | Twenty-four points, bar, off, and the dual-direction position system. |
| `Dice` / `Cube` | Crypto-backed dice rolls and doubling-cube state. |
| `Move` / `Checker` | Checker movement, hit detection, bearing off. |
| `History` | Append-only game event log, including cube decisions. |
| `Services.PerformanceRatingCalculator` | GNU-compatible PR calculation and error classification. |
| `gnuPositionId` | Encode and decode GNU Backgammon 14-character position IDs. |
| `ascii` | Render a board to an ASCII string for logs and terminals. |

## Dual-direction position system

Every point on the backgammon board carries two numbers — one for the clockwise player, one for the counterclockwise player. This is deliberate: each player's home board is always positions 1–6 from their own perspective, no matter which direction they move. Move validation uses the active player's directional view of the board.

See the [backgammon rules reference](https://www.bkgm.com/rules.html) and the [Nodots architecture papers](https://github.com/nodots/backgammon/tree/main/docs/white-papers) for details.

## Ecosystem

| Package | Role |
| --- | --- |
| [`@nodots/backgammon-types`](https://www.npmjs.com/package/@nodots/backgammon-types) | Discriminated-union type contracts. |
| [`@nodots/backgammon-core`](https://www.npmjs.com/package/@nodots/backgammon-core) | Game logic (this package). |
| [`@nodots/backgammon-ai`](https://www.npmjs.com/package/@nodots/backgammon-ai) | GNU-backed robot move selection and cube decisions. |
| [`@nodots/backgammon-api-utils`](https://www.npmjs.com/package/@nodots/backgammon-api-utils) | Request, response, and WebSocket contracts. |
| [`@nodots/backgammon-cli`](https://www.npmjs.com/package/@nodots/backgammon-cli) | Terminal client (`ndbg`). |
| [`@nodots/gnubg-hints`](https://www.npmjs.com/package/@nodots/gnubg-hints) | Native GNU Backgammon hints addon. |

Hosted product: [backgammon.nodots.com](https://backgammon.nodots.com).

## License

GPL-3.0. See [`LICENSE`](./LICENSE).
