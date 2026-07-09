module.exports = {
  displayName: "Unit Tests",
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "../",
  reporters: [
    ["<rootDir>/tests/scripts/custom-reporter.js", {}],
    ["<rootDir>/tests/scripts/verbose-reporter.js", {}]
  ],
  testMatch: [
    "<rootDir>/tests/unit/**/*.test.ts",
    "<rootDir>/tests/mocks/**/*.test.ts"
  ],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@core/(.*)$": "<rootDir>/src/core/$1",
    "^@api/(.*)$": "<rootDir>/src/api/$1",
    "^@auth/(.*)$": "<rootDir>/src/auth/$1",
    "^@streaming/(.*)$": "<rootDir>/src/streaming/$1",
    "^@utils/(.*)$": "<rootDir>/src/utils/$1",
    "^@types/(.*)$": "<rootDir>/src/types/$1"
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/*.test.ts",
    "!src/**/*.spec.ts"
  ],
  coverageDirectory: "<rootDir>/tests/logs/coverage/unit",
  // Coverage is collected on demand (npm run test:coverage) but intentionally
  // not gated: this unit slice cannot see the API/server files that only the
  // integration/e2e suites exercise, and jest does not merge coverage across
  // the three configs, so any global threshold here would be misleading.
  // Use timeout in setup.ts instead
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true
};