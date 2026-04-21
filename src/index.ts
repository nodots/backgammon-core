export { v4 as generateId } from 'uuid'

export type BackgammonColor = 'black' | 'white'

// Constants
export type BackgammonMoveDirection = 'clockwise' | 'counterclockwise'

export type BackgammonEntity =
  | 'board'
  | 'checker'
  | 'cube'
  | 'player'
  | 'play'
  | 'move'
  | 'game'
  | 'offer'

export const randomBoolean = (): boolean => Math.random() > 0.5

export const randomBackgammonColor = (): BackgammonColor =>
  randomBoolean() ? 'black' : 'white'

export const randomBackgammonDirection = (): BackgammonMoveDirection =>
  randomBoolean() ? 'clockwise' : 'counterclockwise'

export interface BackgammonError extends Error {
  entity: BackgammonEntity
  message: string
}

export const isValidUuid = (uuid: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    uuid
  )

export * from './Board'
export { ascii } from './Board/ascii'
export * from './Checker'
export * from './Cube'
export * from './Dice'
export * from './Game'
export * from './History'
export * from './Move'
export * from './Play'
export * from './Player'
export * from './Services'

// Export AI interfaces for dependency injection
export { RobotAIProvider } from './AI/RobotAIProvider'
export { RobotAIRegistry } from './AI/RobotAIRegistry'

// Export logger utilities for consumers to configure
export {
  debug,
  error,
  info,
  logger,
  setConsoleEnabled,
  setIncludeCallerInfo,
  setLogLevel,
  warn,
  type LogLevel,
} from './utils/logger'

// Re-export all types from @nodots/backgammon-types for convenience
export type * from '@nodots/backgammon-types'
export { GameEventEmitter } from './events/GameEventEmitter'
export * from './XG' // Re-enabled for Issue #213 fix - XG import with proper board state tracking
export * from './MET'
