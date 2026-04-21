/**
 * Verify that Game.move and Game.confirmTurn return games
 * with updated boards, and that a full turn cycle (move → move →
 * confirmTurn → roll → move) carries the board changes forward.
 */
import { Board, Game, Player } from '../../index'

describe('Board persistence across turns', () => {
  function setupGame() {
    const white = Player.initialize('white', 'clockwise', 'rolling-for-start', false)
    const black = Player.initialize('black', 'counterclockwise', 'rolling-for-start', false)
    let game = Game.initialize([white, black])
    game = Game.rollForStart(game as any) as any
    for (let i = 0; i < 5 && game.stateKind !== 'moving'; i++) {
      if (game.stateKind === 'rolled-for-start' || game.stateKind === 'rolling') {
        game = Game.roll(game as any) as any
      }
    }
    return game
  }

  it('Game.move returns a board where checkers have moved', () => {
    const game = setupGame() as any
    const ap = game.activePlayer
    const dir = ap.direction

    // Find a ready move and get the first possible move
    const readyMove = game.activePlay.moves.find((m: any) => m.stateKind === 'ready' && m.possibleMoves?.length > 0)
    const pm = readyMove.possibleMoves[0]
    const originPos = pm.origin.position[dir]
    const destPos = pm.destination.position[dir]

    // Count checkers at origin and destination BEFORE
    const beforeOrigin = game.board.points.find((p: any) => p.position[dir] === originPos)
      .checkers.filter((c: any) => c.color === ap.color).length
    const beforeDest = game.board.points.find((p: any) => p.position[dir] === destPos)
      ?.checkers.filter((c: any) => c.color === ap.color).length || 0

    // Execute the move
    const afterGame = Game.move(game, pm.origin.checkers[0].id)

    // Count checkers AFTER
    const afterOrigin = afterGame.board.points.find((p: any) => p.position[dir] === originPos)
      .checkers.filter((c: any) => c.color === ap.color).length
    const afterDest = afterGame.board.points.find((p: any) => p.position[dir] === destPos)
      ?.checkers.filter((c: any) => c.color === ap.color).length || 0

    expect(afterOrigin).toBe(beforeOrigin - 1)
    expect(afterDest).toBe(beforeDest + 1)
  })

  it('board changes survive confirmTurn and roll', () => {
    let game = setupGame() as any
    const ap = game.activePlayer
    const dir = ap.direction

    // Record the starting board signature — uses FIXED direction, not activePlayer
    const boardSig = (g: any, color: string, fixedDir: string) => {
      const positions: string[] = []
      for (const p of g.board.points) {
        const count = p.checkers.filter((c: any) => c.color === color).length
        if (count > 0) positions.push(`${p.position[fixedDir]}:${count}`)
      }
      return positions.sort().join(',')
    }

    const startSig = boardSig(game, ap.color, dir)

    // Execute all ready moves (click first possible move for each)
    while (game.stateKind === 'moving') {
      const ready = game.activePlay?.moves?.filter((m: any) => m.stateKind === 'ready' && m.possibleMoves?.length > 0)
      if (!ready || ready.length === 0) break
      const pm = ready[0].possibleMoves[0]
      const checker = pm.origin.checkers.find((c: any) => c.color === game.activePlayer.color)
      if (!checker) break
      game = Game.move(game, checker.id) as any
    }

    // Board should have changed
    const afterMovesSig = boardSig(game, ap.color, dir)
    expect(afterMovesSig).not.toBe(startSig)

    // Confirm turn
    if (game.stateKind === 'moved') {
      game = Game.confirmTurn(game as any) as any
    }

    // The board changes should survive confirmTurn
    // (now it's the opponent's turn, but the BOARD should still reflect the moves)
    const afterConfirmSig = boardSig(game, ap.color, dir)
    expect(afterConfirmSig).toBe(afterMovesSig)

    // Roll for the next player
    if (game.stateKind === 'rolling') {
      game = Game.roll(game as any) as any
    }

    // Board should STILL have the changes from the first turn
    const afterRollSig = boardSig(game, ap.color, dir)
    expect(afterRollSig).toBe(afterMovesSig)
  })
})
