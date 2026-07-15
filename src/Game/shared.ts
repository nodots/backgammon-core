import { BackgammonGame } from '@nodots/backgammon-types'

// Hardcoded constant to avoid import issues during build
export const MAX_PIP_COUNT = 167

// Helper to create base game properties
export function createBaseGameProperties() {
  return {
    createdAt: new Date(),
    version: `v4.0`, // FIXME
    stateVersion: 1, // Initialize state version for equality checks
    rules: {},
    settings: {
      allowUndo: false,
      allowResign: true,
      autoPlay: false,
      showHints: false,
      showProbabilities: false,
    },
  }
}

/**
 * Increments the stateVersion field for change detection.
 * This allows clients to quickly compare if game state has changed
 * without performing deep equality checks.
 */
export function incrementStateVersion<T extends BackgammonGame>(game: T): T {
  return {
    ...game,
    stateVersion: (game.stateVersion ?? 0) + 1,
  }
}
