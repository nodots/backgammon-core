/**
 * PerformanceRatingCalculator Unit Tests
 *
 * Tests the core PR calculation logic including error classification,
 * skill level assignment, and game analysis.
 */

import { describe, expect, test, jest, beforeEach, afterEach } from '@jest/globals'
import { PerformanceRatingCalculator, setAiModuleForTesting, AiModuleInterface, ANALYSIS_HINTS_CONFIG } from '../PerformanceRatingCalculator'

// Create mock AI module for testing
const createMockAiModule = (overrides: Partial<AiModuleInterface> = {}): AiModuleInterface => ({
  gnubgHints: {
    isAvailable: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    getMoveHints: jest.fn<() => Promise<any[]>>().mockResolvedValue([
      {
        moves: [{ from: 6, to: 3, fromContainer: 'point', toContainer: 'point', moveKind: 'point-to-point', isHit: false, player: 'white' }],
        equity: 0.5,
      },
    ]),
    getBuildInstructions: jest.fn<() => string>().mockReturnValue('Install GNUBG'),
    ...overrides.gnubgHints,
  },
  buildHintContextFromGame: jest.fn<() => any>().mockReturnValue({
    request: {
      positionId: 'test',
      matchId: 'test',
      activePlayerColor: 'white',
      activePlayerDirection: 'clockwise',
    },
  }),
  ...overrides,
})

describe('PerformanceRatingCalculator', () => {
  let calculator: PerformanceRatingCalculator
  let mockAiModule: AiModuleInterface

  beforeEach(() => {
    mockAiModule = createMockAiModule()
    setAiModuleForTesting(mockAiModule)
    calculator = new PerformanceRatingCalculator()
  })

  afterEach(() => {
    setAiModuleForTesting(null)
  })

  describe('Error Classification', () => {
    test('classifyError should return "none" for equity loss < 0.020', () => {
      // Access private method via type casting for testing
      const classify = (calculator as any).classifyError.bind(calculator)

      expect(classify(0)).toBe('none')
      expect(classify(0.01)).toBe('none')
      expect(classify(0.019)).toBe('none')
    })

    test('classifyError should return "doubtful" for equity loss 0.020-0.039', () => {
      const classify = (calculator as any).classifyError.bind(calculator)

      expect(classify(0.020)).toBe('doubtful')
      expect(classify(0.030)).toBe('doubtful')
      expect(classify(0.039)).toBe('doubtful')
    })

    test('classifyError should return "error" for equity loss 0.040-0.079', () => {
      const classify = (calculator as any).classifyError.bind(calculator)

      expect(classify(0.040)).toBe('error')
      expect(classify(0.060)).toBe('error')
      expect(classify(0.079)).toBe('error')
    })

    test('classifyError should return "blunder" for equity loss 0.080-0.159', () => {
      const classify = (calculator as any).classifyError.bind(calculator)

      expect(classify(0.080)).toBe('blunder')
      expect(classify(0.120)).toBe('blunder')
      expect(classify(0.159)).toBe('blunder')
    })

    test('classifyError should return "very_bad" for equity loss >= 0.160', () => {
      const classify = (calculator as any).classifyError.bind(calculator)

      expect(classify(0.160)).toBe('very_bad')
      expect(classify(0.200)).toBe('very_bad')
      expect(classify(0.500)).toBe('very_bad')
    })
  })

  describe('Skill Level Assignment', () => {
    test('getSkillLevel should return "World Class" for PR <= 3.0', () => {
      expect(PerformanceRatingCalculator.getSkillLevel(0)).toBe('World Class')
      expect(PerformanceRatingCalculator.getSkillLevel(1.0)).toBe('World Class')
      expect(PerformanceRatingCalculator.getSkillLevel(3.0)).toBe('World Class')
    })

    test('getSkillLevel should return "Expert" for PR 3.0-5.0', () => {
      expect(PerformanceRatingCalculator.getSkillLevel(3.1)).toBe('Expert')
      expect(PerformanceRatingCalculator.getSkillLevel(4.0)).toBe('Expert')
      expect(PerformanceRatingCalculator.getSkillLevel(5.0)).toBe('Expert')
    })

    test('getSkillLevel should return "Advanced" for PR 5.0-7.0', () => {
      expect(PerformanceRatingCalculator.getSkillLevel(5.1)).toBe('Advanced')
      expect(PerformanceRatingCalculator.getSkillLevel(6.0)).toBe('Advanced')
      expect(PerformanceRatingCalculator.getSkillLevel(7.0)).toBe('Advanced')
    })

    test('getSkillLevel should return "Intermediate" for PR 7.0-11.0', () => {
      expect(PerformanceRatingCalculator.getSkillLevel(7.1)).toBe('Intermediate')
      expect(PerformanceRatingCalculator.getSkillLevel(9.0)).toBe('Intermediate')
      expect(PerformanceRatingCalculator.getSkillLevel(11.0)).toBe('Intermediate')
    })

    test('getSkillLevel should return "Casual" for PR 11.0-15.0', () => {
      expect(PerformanceRatingCalculator.getSkillLevel(11.1)).toBe('Casual')
      expect(PerformanceRatingCalculator.getSkillLevel(13.0)).toBe('Casual')
      expect(PerformanceRatingCalculator.getSkillLevel(15.0)).toBe('Casual')
    })

    test('getSkillLevel should return "Beginner" for PR > 15.0', () => {
      expect(PerformanceRatingCalculator.getSkillLevel(15.1)).toBe('Beginner')
      expect(PerformanceRatingCalculator.getSkillLevel(20.0)).toBe('Beginner')
      expect(PerformanceRatingCalculator.getSkillLevel(50.0)).toBe('Beginner')
    })
  })

  describe('PR Formula', () => {
    test('PR should equal averageEquityLoss * 500', () => {
      // This tests the formula used in calculateGamePR
      const testCases = [
        { avgLoss: 0.005, expectedPR: 2.5 },   // World Class
        { avgLoss: 0.010, expectedPR: 5.0 },   // Expert
        { avgLoss: 0.015, expectedPR: 7.5 },   // Advanced
        { avgLoss: 0.020, expectedPR: 10.0 },  // Intermediate
        { avgLoss: 0.030, expectedPR: 15.0 },  // Casual
        { avgLoss: 0.050, expectedPR: 25.0 },  // Beginner
      ]

      for (const { avgLoss, expectedPR } of testCases) {
        const pr = avgLoss * 500
        expect(pr).toBe(expectedPR)
      }
    })
  })

  describe('Move Step Formatting', () => {
    test('formatMoveStep should format bar re-entry correctly', () => {
      const format = (calculator as any).formatMoveStep.bind(calculator)

      const barMove = { from: 0, to: 5, fromContainer: 'bar', toContainer: 'point', moveKind: 'reenter', isHit: false, player: 'white' }
      expect(format(barMove)).toBe('bar/5')
    })

    test('formatMoveStep should format bear-off correctly', () => {
      const format = (calculator as any).formatMoveStep.bind(calculator)

      const bearOffMove = { from: 3, to: 0, fromContainer: 'point', toContainer: 'off', moveKind: 'bear-off', isHit: false, player: 'white' }
      expect(format(bearOffMove)).toBe('3/off')
    })

    test('formatMoveStep should format point-to-point correctly', () => {
      const format = (calculator as any).formatMoveStep.bind(calculator)

      const normalMove = { from: 13, to: 7, fromContainer: 'point', toContainer: 'point', moveKind: 'point-to-point', isHit: false, player: 'white' }
      expect(format(normalMove)).toBe('13/7')
    })
  })

  describe('calculateGamePR Integration', () => {
    test('should return analysisComplete: false when GNUBG is not available', async () => {
      // Override the mock for this test
      const unavailableModule = createMockAiModule({
        gnubgHints: {
          isAvailable: jest.fn<() => Promise<boolean>>().mockResolvedValue(false),
          getMoveHints: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
          getBuildInstructions: jest.fn<() => string>().mockReturnValue('Install GNUBG'),
        },
      })
      setAiModuleForTesting(unavailableModule)

      const result = await calculator.calculateGamePR('test-game', [], [])

      expect(result.analysisComplete).toBe(false)
      expect(result.error).toContain('GNU Backgammon hints are required')
    })

    test('should handle empty move actions', async () => {
      const result = await calculator.calculateGamePR('test-game', [], [])

      // With no moves, analysis should complete but have no player stats
      expect(result.gameId).toBe('test-game')
      expect(Object.keys(result.playerResults).length).toBe(0)
    })

    test('should track per-player statistics', async () => {
      const mockGame = {
        id: 'test-game',
        stateKind: 'moving',
        activeColor: 'white',
        players: [
          { id: 'player1', userId: 'user1', color: 'white', direction: 'clockwise' },
          { id: 'player2', userId: 'user2', color: 'black', direction: 'counterclockwise' },
        ],
        board: { points: [] },
      } as any

      const moveActions = [
        { player: 'player1', move: { originPosition: 6, destinationPosition: 3 }, dice: [3, 1] },
        { player: 'player2', move: { originPosition: 19, destinationPosition: 22 }, dice: [3, 2] },
        { player: 'player1', move: { originPosition: 8, destinationPosition: 5 }, dice: [3, 4] },
      ]

      const result = await calculator.calculateGamePR(
        'test-game',
        [mockGame, mockGame, mockGame],
        moveActions
      )

      expect(result.gameId).toBe('test-game')
      expect(result.analysisComplete).toBe(true)

      // Player 1 made 2 moves, Player 2 made 1 move
      expect(result.playerResults['player1']?.totalMoves).toBe(2)
      expect(result.playerResults['player2']?.totalMoves).toBe(1)
    })

    test('re-asserts the full analysis config on every run', async () => {
      // Regression: the engine config is a process-global that robot turns
      // overwrite with per-robot skill settings. Analysis must pin its own
      // complete config each run or it inherits the robot's.
      const configureMock = jest
        .fn<(config: Record<string, unknown>) => Promise<void>>()
        .mockResolvedValue(undefined)
      const moduleWithConfigure = createMockAiModule()
      moduleWithConfigure.gnubgHints.configure = configureMock
      setAiModuleForTesting(moduleWithConfigure)

      await calculator.calculateGamePR('test-game', [], [])
      await calculator.calculateGamePR('test-game', [], [])

      expect(configureMock).toHaveBeenCalledTimes(2)
      expect(configureMock).toHaveBeenCalledWith(ANALYSIS_HINTS_CONFIG)
      // The config must be complete: partial configs merge into whatever the
      // previous engine caller left behind.
      expect(ANALYSIS_HINTS_CONFIG).toEqual({
        evalPlies: 2,
        moveFilter: 4,
        usePruning: true,
        noise: 0,
      })
    })

    test('tolerates an ai module without configure', async () => {
      const result = await calculator.calculateGamePR('test-game', [], [])
      expect(result.analysisComplete).toBe(true)
    })
  })
})

describe('Error Type Distribution', () => {
  test('error thresholds should not overlap', () => {
    // These are the thresholds from classifyError
    const thresholds = [
      { max: 0.020, type: 'none' },
      { max: 0.040, type: 'doubtful' },
      { max: 0.080, type: 'error' },
      { max: 0.160, type: 'blunder' },
      { max: Infinity, type: 'very_bad' },
    ]

    for (let i = 0; i < thresholds.length - 1; i++) {
      expect(thresholds[i].max).toBeLessThan(thresholds[i + 1].max)
    }
  })

  test('skill levels should cover the full PR range', () => {
    const skillLevelCoverage = [
      { maxPR: 3.0, level: 'World Class' },
      { maxPR: 5.0, level: 'Expert' },
      { maxPR: 7.0, level: 'Advanced' },
      { maxPR: 11.0, level: 'Intermediate' },
      { maxPR: 15.0, level: 'Casual' },
      { maxPR: Infinity, level: 'Beginner' },
    ]

    // Verify complete coverage from 0 to infinity
    let previousMax = 0
    for (const { maxPR } of skillLevelCoverage) {
      expect(maxPR).toBeGreaterThan(previousMax)
      previousMax = maxPR
    }

    // Last level should go to infinity
    expect(skillLevelCoverage[skillLevelCoverage.length - 1].maxPR).toBe(Infinity)
  })
})
