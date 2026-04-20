<!-- COVERAGE-START -->
![Statements](https://img.shields.io/badge/Statements-81%25-green?style=flat-square)
![Branches](https://img.shields.io/badge/Branches-71%25-yellow?style=flat-square)
![Functions](https://img.shields.io/badge/Functions-80%25-green?style=flat-square)
![Lines](https://img.shields.io/badge/Lines-82%25-green?style=flat-square)
<!-- COVERAGE-END -->

# @nodots/backgammon-core

**Version 1.0.0** | Core game logic for Nodots Backgammon

A comprehensive TypeScript library implementing the complete game logic for backgammon. This package provides all the core mechanics needed to build backgammon applications, including board management, move validation, state machine management, robot player support, XG game parsing, and full compliance with official backgammon rules.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Key Concepts](#key-concepts)
- [API Reference](#api-reference)
- [XG Parser](#xg-parser)
- [Position ID System](#position-id-system)
- [Testing](#testing)
- [License](#license)

---

## Features

- **Complete Backgammon Rules** - Full implementation of standard backgammon rules including:
  - Board initialization and state management
  - Move validation and execution
  - Support for doubles (4 moves)
  - Bar entry and re-entry with bar-first enforcement
  - Bearing off with "higher die" rule
  - Pip count tracking
  - Doubling cube support
  - Win condition detection (simple win, gammon, backgammon)

- **State Machine Architecture** - Robust game state transitions with validation

- **Robot Player Support** - Built-in infrastructure for AI players with pluggable providers

- **XG Game Parser** - Import and parse eXtreme Gammon match files

- **GNU Position ID** - Generate and parse GNU Backgammon position IDs for board serialization

- **Position Reconstruction** - Reconstruct board states from move history

- **TypeScript First** - Full type safety with exported types from `@nodots/backgammon-types`

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        @nodots/backgammon-core                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │    Game     │───▶│    Play     │───▶│    Move     │                 │
│  │  (State     │    │  (Turn      │    │  (Single    │                 │
│  │   Machine)  │    │   Context)  │    │   Action)   │                 │
│  └──────┬──────┘    └─────────────┘    └─────────────┘                 │
│         │                                                               │
│         ▼                                                               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │    Board    │◀──▶│   Player    │    │    Dice     │                 │
│  │  (24 pts +  │    │  (State &   │    │  (Roll &    │                 │
│  │   bar/off)  │    │   Pip Cnt)  │    │   Values)   │                 │
│  └──────┬──────┘    └─────────────┘    └─────────────┘                 │
│         │                                                               │
│         ▼                                                               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │   Checker   │    │    Cube     │    │   History   │                 │
│  │  (Pieces)   │    │  (Doubling) │    │  (Actions)  │                 │
│  └─────────────┘    └─────────────┘    └─────────────┘                 │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                         Services Layer                           │   │
│  ├─────────────────┬─────────────────┬─────────────────────────────┤   │
│  │   XG Parser     │  Position ID    │  Position Reconstructor     │   │
│  │  (Import .xg)   │  (GNU compat)   │  (State from history)       │   │
│  └─────────────────┴─────────────────┴─────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      AI Provider Interface                       │   │
│  │    RobotAIProvider  ←──  RobotAIRegistry  ──→  executeRobotTurn │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Project Structure

```
src/
├── AI/                  # AI provider interfaces for robot players
│   ├── RobotAIProvider.ts    # Interface for implementing AI strategies
│   └── RobotAIRegistry.ts    # Registry for AI provider instances
├── Board/               # Board state management and move validation
│   ├── index.ts              # Board class with move logic
│   ├── ascii.ts              # ASCII board rendering
│   └── gnuPositionId.ts      # GNU Position ID generation/parsing
├── Checker/             # Checker (piece) logic and state
├── Cube/                # Doubling cube implementation
├── Dice/                # Dice rolling and state management
├── Game/                # Core game state and flow management
│   ├── index.ts              # Game class with all state transitions
│   └── executeRobotTurn.ts   # Robot turn automation
├── History/             # Game history tracking
├── Move/                # Move types and validation
│   └── MoveKinds/            # Move implementations
├── Play/                # Play (turn) state and management
├── Player/              # Player state and pip count calculations
├── Services/            # Utility services
│   ├── PerformanceRatingCalculator.ts
│   └── PositionReconstructor.ts
├── Sim/                 # Game simulation engine
├── XG/                  # XG file parser
│   └── parser.ts             # Parse eXtreme Gammon files
├── events/              # Event emitter for game events
├── utils/               # Utility functions (logger, etc.)
└── index.ts             # Main exports
```

---

## Installation

```bash
npm install @nodots/backgammon-core
```

### Requirements

- **Node.js** 18 or higher
- **TypeScript** 5.x (for development)
- For robot players using GNU Backgammon hints: a working `node-gyp` toolchain

---

## Quick Start

```typescript
import { Game, Board, ascii } from '@nodots/backgammon-core'

// Create a new game
let game = Game.createNewGame(
  { userId: 'player1', isRobot: false },
  { userId: 'player2', isRobot: true }
)

// Roll to determine starting player
game = Game.rollForStart(game)

// Active player rolls dice to begin their turn
game = Game.roll(game)

// Display the board
console.log(ascii(game.board))

// Get possible moves for the active player
const readyMoves = Array.from(game.activePlay.moves)
  .filter(m => m.stateKind === 'ready')

// Execute a move
if (readyMoves.length > 0 && readyMoves[0].possibleMoves.length > 0) {
  const checkerId = readyMoves[0].possibleMoves[0].checker.id
  game = Game.move(game, checkerId)
}
```

---

## Key Concepts

### Game State Machine

```
┌─────────────────────┐    ┌─────────────────────┐
│  rolling-for-start  │───▶│   rolled-for-start  │
└─────────────────────┘    └──────────┬──────────┘
                                      │
                                      ▼
                           ┌─────────────────────┐
                     ┌────▶│      rolling        │◀────────┐
                     │     └──────────┬──────────┘         │
                     │                │                    │
                     │                ▼                    │
                     │     ┌─────────────────────┐         │
                     │     │       moving        │         │
                     │     └──────────┬──────────┘         │
                     │                │                    │
                     │                ▼                    │
                     │     ┌─────────────────────┐         │
                     │     │       moved         │─────────┘
                     │     └──────────┬──────────┘
                     │                │
                     └────────────────┤
                                      ▼
                           ┌─────────────────────┐
                           │     completed       │
                           └─────────────────────┘
```

| State | Description |
|-------|-------------|
| `rolling-for-start` | Both players rolling to determine who goes first |
| `rolled-for-start` | Starting rolls complete, winner determined |
| `rolling` | Active player's turn to roll dice |
| `moving` | Active player executing moves |
| `moved` | All moves executed, awaiting turn confirmation |
| `completed` | Game over, winner determined |

### Board Representation

The board uses points numbered 1-24 with **dual numbering**:

- **Clockwise positions**: 1-24 from clockwise player's perspective
- **Counterclockwise positions**: 1-24 from counterclockwise player's perspective

Each point stores both values: `{ clockwise: X, counterclockwise: Y }`

### Move Types

| Move Type | Description |
|-----------|-------------|
| **Point to Point** | Regular moves between points |
| **Bear Off** | Moving checkers off from home board |
| **Reenter** | Moving from bar back onto the board |
| **No Move** | Generated when no valid move exists |

---

## API Reference

### Game API

```typescript
// Create and initialize
Game.createNewGame(player1Config, player2Config)
Game.rollForStart(game)
Game.roll(game)

// Move execution
Game.move(game, checkerId)
Game.moveAndFinalize(game, checkerId)
Game.switchDice(game)

// Turn management
Game.toMoved(game)
Game.confirmTurn(game)
Game.checkAndCompleteTurn(game)

// Robot automation
await Game.executeRobotTurn(game)

// Doubling cube
Game.canOfferDouble(game, player)
Game.double(game)
Game.acceptDouble(game, player)
Game.refuseDouble(game, player)

// Undo support
Game.canUndoActivePlay(game)
Game.undoLastInActivePlay(game)

// State queries
Game.canRoll(game)
Game.canRollForStart(game)
Game.canPlayerRoll(game, playerId)
```

### Board API

```typescript
Board.initialize()
Board.createBoardForPlayers(clockwiseColor, counterclockwiseColor)
Board.getPossibleMoves(board, player, dieValue)
Board.moveChecker(board, origin, destination, direction)
Board.getCheckers(board)
```

---

## XG Parser

Parse eXtreme Gammon match files:

```typescript
import { parseXGFile } from '@nodots/backgammon-core'

const matchData = parseXGFile(xgFileContent)

console.log(matchData.player1Name)    // "Player 1"
console.log(matchData.player2Name)    // "Player 2"
console.log(matchData.player1Elo)     // 1850
console.log(matchData.games.length)   // Number of games in match

// Each game contains:
for (const game of matchData.games) {
  for (const play of game.plays) {
    console.log(play.positionId)      // GNU Position ID
    console.log(play.roll)            // [3, 1]
    console.log(play.moves)           // Move descriptions
  }
}
```

---

## Position ID System

Generate GNU Backgammon-compatible position IDs:

```typescript
import { generatePositionId, parsePositionId } from '@nodots/backgammon-core'

// Generate from board state
const positionId = generatePositionId(board, activePlayer)
// e.g., "4HPwATDgc/ABMA"

// Parse back to board configuration
const boardConfig = parsePositionId(positionId)
```

Position IDs follow the **Golden Rule**: always encode from the active player's directional perspective for consistent analysis across both player directions.

---

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Simulation Tools

```bash
# Simulate a single game
npm run simulate:game

# Simulate multiple games
npm run simulate:multiple

# GNU vs GNU AI simulation
npm run simulate:gnu-vs-gnu
```

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [Type System Guide](../../docs/TYPE_SYSTEM_GUIDE.md) | Understanding discriminated unions and type narrowing |
| [Position ID Encoding](../../docs/POSITION_ID_ENCODING.md) | GNU Position ID format specification |
| [Game State Diagram](../../docs/GAME_STATE_DIAGRAM.md) | Visual state machine diagrams |
| [Getting Started](../../docs/GETTING_STARTED.md) | Setup guide for the full ecosystem |
| [Contributing](../../CONTRIBUTING.md) | Development guidelines and PR process |

---

## License

MIT License

Copyright (c) 2025 Ken Riley <kenr@nodots.com>

See [LICENSE](LICENSE) for full text.
