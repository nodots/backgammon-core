import { randomInt } from 'crypto'
import {
  BackgammonColor,
  BackgammonDice,
  BackgammonDiceInactive,
  BackgammonDiceRolled,
  BackgammonDiceRolledForStart,
  BackgammonDiceRolling,
  BackgammonDiceRollingForStart,
  BackgammonDiceStateKind,
  BackgammonDieValue,
  BackgammonRoll,
  BackgammonRollForStart,
} from '@nodots/backgammon-types'
import { generateId } from '..'

export class Dice {
  // Overloads for precise return types based on state
  public static initialize(
    color: BackgammonColor
  ): BackgammonDiceInactive
  public static initialize(
    color: BackgammonColor,
    stateKind: 'inactive',
    id?: string,
    currentRoll?: undefined
  ): BackgammonDiceInactive
  public static initialize(
    color: BackgammonColor,
    stateKind: 'rolling',
    id?: string,
    currentRoll?: BackgammonRoll
  ): BackgammonDiceRolling
  public static initialize(
    color: BackgammonColor,
    stateKind: 'rolling-for-start',
    id?: string,
    currentRoll?: BackgammonRollForStart
  ): BackgammonDiceRollingForStart
  public static initialize(
    color: BackgammonColor,
    stateKind: 'rolled-for-start',
    id?: string,
    currentRoll?: BackgammonRollForStart
  ): BackgammonDiceRolledForStart
  public static initialize(
    color: BackgammonColor,
    stateKind: 'rolled',
    id?: string,
    currentRoll?: BackgammonRoll
  ): BackgammonDiceRolled
  public static initialize(
    color: BackgammonColor,
    stateKind?: BackgammonDiceStateKind,
    id?: string,
    currentRoll?: BackgammonRoll | BackgammonRollForStart
  ): BackgammonDice
  public static initialize(
    color: BackgammonColor,
    stateKind: BackgammonDiceStateKind = 'inactive',
    id: string = generateId(),
    currentRoll: BackgammonRoll | BackgammonRollForStart | undefined = undefined
  ): BackgammonDice {
    const total = currentRoll
      ? currentRoll[1] !== undefined
        ? currentRoll[0] + (currentRoll[1] as number)
        : currentRoll[0]
      : undefined

    switch (stateKind) {
      case 'inactive':
        return {
          id,
          stateKind: 'inactive',
          color,
          currentRoll,
          total,
        } as BackgammonDiceInactive
      case 'rolling':
        return {
          id,
          stateKind: 'rolling',
          color,
          currentRoll,
          total,
        } as BackgammonDiceRolling
      case 'rolling-for-start':
        return {
          id,
          stateKind: 'rolling-for-start',
          color,
          currentRoll,
          total,
        } as BackgammonDiceRollingForStart
      case 'rolled-for-start':
        if (!currentRoll) {
          throw new Error('currentRoll is required for rolled-for-start dice')
        }
        return {
          id,
          stateKind: 'rolled-for-start',
          color,
          currentRoll: currentRoll as BackgammonRollForStart,
          total: currentRoll[0], // For start rolls, only first die counts
        } as BackgammonDiceRolledForStart
      case 'rolled':
        if (!currentRoll) {
          throw new Error('currentRoll is required for rolled dice')
        }
        return {
          id,
          stateKind: 'rolled',
          color,
          currentRoll,
          total: total!,
        } as BackgammonDiceRolled
      default:
        throw new Error('Unknown dice state: ' + String(stateKind))
    }
  }

  public static roll = function rollDice(
    dice: BackgammonDiceInactive | BackgammonDiceRolling
  ): BackgammonDiceRolled {
    const currentRoll: BackgammonRoll = [Dice.rollDie(), Dice.rollDie()]
    return {
      ...dice,
      stateKind: 'rolled',
      currentRoll,
      total: currentRoll[0] + currentRoll[1],
    }
  }

  public static switchDice = function switchDice(
    dice: BackgammonDiceRolled
  ): BackgammonDiceRolled {
    return {
      ...dice,
      currentRoll: [dice.currentRoll[1], dice.currentRoll[0]] as BackgammonRoll,
    }
  }

  public static isDouble = function isDouble(
    dice: BackgammonDiceRolled
  ): boolean {
    return dice.currentRoll[0] === dice.currentRoll[1]
  }

  public static rollForStart = function rollForStart(
    dice: BackgammonDiceRollingForStart
  ): BackgammonDiceRolledForStart {
    const currentRoll: BackgammonRollForStart = [Dice.rollDie(), undefined]
    return {
      ...dice,
      stateKind: 'rolled-for-start',
      currentRoll,
      total: currentRoll[0], // For start rolls, only first die counts
    } as BackgammonDiceRolledForStart
  }

  static rollDie = function rollDie(): BackgammonDieValue {
    // randomInt(1, 7) is exclusive on upper bound → yields 1..6 uniformly from
    // Node's CSPRNG; cast narrows number → BackgammonDieValue (1|2|3|4|5|6).
    return randomInt(1, 7) as BackgammonDieValue
  }
  // Convenience  mostly for tests
  static _RandomRoll = [this.rollDie(), this.rollDie()] as BackgammonRoll
}
