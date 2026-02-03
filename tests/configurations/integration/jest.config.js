const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('../../../tsconfig.json');

/** @type {import('jest').Config} */
module.exports = {
  transform: {
    '^.+\\.(t|j)s$': ['@swc/jest'],
  },
  transformIgnorePatterns: ['/node_modules/(?!(?:@turf|kdbush|geokdbush|tinyqueue)/)'],
  coverageReporters: ['text', 'html'],
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/' }),
  collectCoverage: true,
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!*/node_modules/',
    '!/vendor/**',
    '!*/common/**',
    '!**/models/**',
    '!<rootDir>/src/*',
    '!**/pgbossFactory.ts',
  ],
  coverageDirectory: '<rootDir>/coverage/integration',
  rootDir: '../../../.',
  testMatch: ['<rootDir>/tests/integration/**/*.spec.ts'],
  setupFiles: ['<rootDir>/tests/configurations/jest.setup.ts'],
  setupFilesAfterEnv: [
    'jest-openapi',
    '<rootDir>/tests/configurations/initJestOpenapi.setup.ts',
    '<rootDir>/tests/matchers.js',
    '<rootDir>/tests/configurations/jest.setupAfterEnv.js',
  ],
  reporters: [
    'default',
    [
      'jest-html-reporters',
      { multipleReportsUnitePath: './reports', pageTitle: 'integration', publicPath: './reports', filename: 'integration.html' },
    ],
  ],
  moduleDirectories: ['node_modules', 'src'],
  testEnvironment: 'node',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: -10,
    },
  },
};
