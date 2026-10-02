// Mark Jest so `memory-mongo` ignores MONGO_TEST_URI from shell/compose and uses mongodb-memory-server.
process.env.OPENAD_JEST = '1';

module.exports = {
  displayName: 'openad-api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testTimeout: 120_000,
  globalSetup: '<rootDir>/jest-global-setup.cjs',
  globalTeardown: '<rootDir>/jest-global-teardown.cjs',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/app/openad-api',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
    '!src/**/*.module.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 45,
      branches: 35,
      functions: 40,
      statements: 45,
    },
  },
};
