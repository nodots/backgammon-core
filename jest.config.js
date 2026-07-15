const collectCoverage = process.env.COVERAGE === '1'

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: './src',
  coverageDirectory: '../coverage',
  verbose: false,
  collectCoverage,
  coverageReporters: ['text', 'lcov'],
  // Coverage gate for the decomposed Game modules (nodots/backgammon-core#134).
  // Enforced only under COVERAGE=1 (CI). A directory-path key aggregates
  // coverage across all files under src/Game/ (rather than per-file), so the
  // well-covered modules (shared/guards/lifecycle/undo/cube) balance the
  // thinner delegators (executeRobotTurn) and the large turnFlow file. The
  // branch floor sits just under the current aggregate and ratchets toward 75
  // as the remaining turnFlow no-move/blocked paths gain coverage.
  coverageThreshold: {
    './src/Game/': {
      statements: 75,
      functions: 75,
      lines: 75,
      branches: 70,
    },
  },
  testMatch: ['**/?(*.)+(test).ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        useESM: false,
        diagnostics: false,
      },
    ],
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@nodots-llc/backgammon-ai$': '<rootDir>/__mocks__/backgammonAiMock.ts',
    '^@nodots-llc/backgammon-types$': '<rootDir>/../../types/src/index.ts',
  },
}
