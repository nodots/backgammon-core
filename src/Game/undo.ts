import {
  BackgammonGame,
  BackgammonGameMoving,
} from '@nodots/backgammon-types'

/**
 * Undo the last executed move within the current activePlay using the
 * turn-local undo stack. Returns the exact pre-move moving game state.
 */
export function undoLastInActivePlay(
  game: BackgammonGame
): BackgammonGameMoving {
  if (!game) throw new Error('No game state provided')
  if (game.stateKind !== 'moving' && game.stateKind !== 'moved') {
    throw new Error(
      `Cannot undo in ${game.stateKind} state. Must be in 'moving' or 'moved'`
    )
  }
  const ap = game.activePlay
  if (!ap) throw new Error('No active play found for undo')
  const frames = ap.undo?.frames
  if (!frames || frames.length === 0)
    throw new Error('No moves to undo for current player')
  const previous = frames.pop()
  if (!previous || previous.stateKind !== 'moving')
    throw new Error('Undo snapshot is invalid or not a moving state')
  return previous
}

/**
 * Game-level check for whether an undo is currently possible within activePlay.
 */
export function canUndoActivePlay(game: BackgammonGame): boolean {
  if (!game) return false
  if (game.stateKind !== 'moving' && game.stateKind !== 'moved') return false
  const ap = game.activePlay
  if (!ap || !ap.undo) return false
  const frames = ap.undo.frames
  return Array.isArray(frames) && frames.length > 0
}
