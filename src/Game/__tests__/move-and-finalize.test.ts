import { describe, it, expect } from '@jest/globals'
import { Board } from '../../Board'
import { Game } from '..'
import { Player } from '../../Player'
import { Play } from '../../Play'
import { Cube } from '../../Cube'
import type {
  BackgammonCheckerContainerImport,
  BackgammonGameMoving,
  BackgammonPlayerInactive,
  BackgammonPlayerRolling,
} from '@nodots/backgammon-types'

// Helper to define a point by counterclockwise position
const pointCC = (posCC: number, qty: number, color: 'black' | 'white'): BackgammonCheckerContainerImport => ({
  position: { clockwise: (25 - posCC) as any, counterclockwise: posCC as any },
  checkers: { qty, color },
})

describe('Game.moveAndFinalize()', () => {
  it("transitions to 'moved' when only one die is usable (6 blocked, 1 used)", () => {
    // Board setup for counterclockwise (black) player:
    // - Black checker at CC 24
    // - CC 23 empty (die 1 is legal: CC 24 → CC 23)
    // - CC 18 has two white checkers (blocks die 6 from CC 24)
    // - CC 17 has two white checkers (blocks die 6 from CC 23,
    //   i.e. even after die 1 is played, die 6 has no legal
    //   destination from the new position — only then is die 6
    //   truly "blocked" and the turn should auto-complete).
    const boardImport: BackgammonCheckerContainerImport[] = [
      pointCC(24, 1, 'black'), // origin
      pointCC(18, 2, 'white'), // block die 6 from CC 24
      pointCC(17, 2, 'white'), // block die 6 from CC 23 (after die 1)
      // leave 23 empty so die 1 is usable
    ]

    const board = Board.buildBoard(boardImport)

    // Create black rolling player with [6,1], then to moving
    const blackRolling = Player.initialize('black', 'counterclockwise', 'rolling', false) as BackgammonPlayerRolling
    const blackRolled = Player.roll(blackRolling)
    blackRolled.dice.currentRoll = [6, 1]
    const blackMoving = Player.toMoving(blackRolled)

    // White inactive
    const whiteInactive = Player.initialize('white', 'clockwise', 'inactive', false) as BackgammonPlayerInactive

    // Initialize play
    const play = Play.initialize(board, blackMoving)

    // Compose a moving game
    const movingGame = Game.initialize(
      [blackMoving, whiteInactive] as any,
      'test-game',
      'moving',
      board,
      Cube.initialize(),
      play,
      'black',
      blackMoving,
      whiteInactive
    ) as BackgammonGameMoving

    // Find the black checker at CC 24
    const originPoint = Board.getPoints(board).find(
      (p) => p.position.counterclockwise === 24
    )!
    const checker = originPoint.checkers.find((c) => c.color === 'black')!

    // Make the move (should use die 1), then let CORE finalize
    const after = Game.moveAndFinalize(movingGame, checker.id)

    // Since die 6 is blocked and becomes a no-move, the turn should complete
    expect(after.stateKind).toBe('moved')
  })
})

