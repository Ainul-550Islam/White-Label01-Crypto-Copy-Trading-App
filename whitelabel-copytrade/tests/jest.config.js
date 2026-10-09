/**
 * Jest config for the framework-agnostic billing library specs under tests/
 * (entitlements, limits, plans, catalog). These modules have no Nest wiring
 * and no spec next to their sources, so this tree is where they are tested.
 *
 * Specs are type-checked by ts-jest (tests/tsconfig.json extends the API's), so an API
 * change that breaks them fails here instead of silently rotting.
 *
 *   npm run test:billing-lib        (from whitelabel-copytrade/)
 *
 * WHY `testPathIgnorePatterns` EXISTS
 * -----------------------------------
 * `roots: ['<rootDir>/tests']` also reaches `tests/e2e/`, whose specs import the
 * customer-web and admin-web React trees (`renderToStaticMarkup`, `.tsx`
 * components, `@tanstack/react-query`). Those specs are covered by their own
 * config - `tests/e2e/jest.config.js`, which sets `jsx: react-jsx` and maps the
 * web/admin aliases - and are run by `npm run test:e2e`. Compiling them here
 * failed on every `npm run test:billing-lib` with TS6142 ("'--jsx' is not set")
 * and TS2593 ("Cannot find name 'describe'"), because this config's
 * `tests/tsconfig.json` extends the API's and therefore has neither `jsx` nor
 * the jest types. The two trees are one `roots` apart, so the gate is explicit.
 */
const path = require('path');

const root = path.resolve(__dirname, '..');

module.exports = {
  rootDir: root,
  roots: ['<rootDir>/tests'],
  testRegex: '.*\\.spec\\.tsx?$',
  // E2E specs own a separate config; see the note above.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/e2e/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': ['ts-jest', { tsconfig: path.join(__dirname, 'tsconfig.json') }],
  },
  moduleNameMapper: {
    '^@wlct/(shared-types|config|utils|validation)$': '<rootDir>/packages/$1/src',
    '^src/(.*)$': '<rootDir>/apps/api/src/$1',
  },
};
