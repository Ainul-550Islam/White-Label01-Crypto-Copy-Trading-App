/**
 * Jest config for the framework-agnostic billing library specs under tests/
 * (entitlements, limits, plans, catalog). These modules have no Nest wiring
 * and no spec next to their sources, so this tree is where they are tested.
 *
 * Specs are type-checked by ts-jest (tests/tsconfig.json extends the API's), so an API
 * change that breaks them fails here instead of silently rotting.
 *
 *   npm run test:billing-lib        (from whitelabel-copytrade/)
 */
const path = require('path');

const root = path.resolve(__dirname, '..');

module.exports = {
  rootDir: root,
  roots: ['<rootDir>/tests'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: path.join(__dirname, 'tsconfig.json') }],
  },
  moduleNameMapper: {
    '^@wlct/(shared-types|config|utils|validation)$': '<rootDir>/packages/$1/src',
    '^src/(.*)$': '<rootDir>/apps/api/src/$1',
  },
};
