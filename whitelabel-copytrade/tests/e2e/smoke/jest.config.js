// # Responsibility: runs the cross-app component smoke specs (render-to-static-markup, no browser) for the web and admin JSX surfaces.
//
// These specs are NOT end-to-end tests and are no longer filed as such. They render a page
// component to static markup with a primed react-query cache and assert on the HTML: a real
// regression net for the page components, but it never issues a request, never runs a browser and
// never clicks anything. The audit found them labelled `tests/e2e/*.spec.ts` - a claim the
// directory could not support, and one that hid the absence of any browser test in the repository.
//
// The browser suite is `tests/e2e/browser/*.spec.ts`, run by Playwright
// (`npm run test:e2e:browser`), and it is the layer that actually drives a chromium page against
// the running web app.
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
const adminSource = path.join(repositoryRoot, 'apps', 'admin-web', 'src');
const webSource = path.join(repositoryRoot, 'apps', 'web', 'src');

module.exports = {
  rootDir: repositoryRoot,
  roots: ['<rootDir>/tests/e2e/smoke'],
  testMatch: ['<rootDir>/tests/e2e/smoke/**/*.spec.ts'],
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.[jt]sx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'Node',
          jsx: 'react-jsx',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          skipLibCheck: true,
          strict: true,
          isolatedModules: true,
          types: ['node', 'jest'],
        },
        diagnostics: false,
        isolatedModules: true,
      },
    ],
  },
  moduleNameMapper: {
    '^@wlct/shared-types$': '<rootDir>/packages/shared-types/src/index.ts',
    '^@wlct/validation$': '<rootDir>/packages/validation/src/index.ts',
    '^@wlct/utils/api-error$': '<rootDir>/packages/utils/src/api-error.ts',
    '^@/components/ui$': path.join(adminSource, 'components', 'ui.tsx'),
    '^@/lib/(api-client|format|theme)$': path.join(adminSource, 'lib', '$1'),
    '^@/lib/(.*)$': path.join(webSource, 'lib', '$1'),
    '^@/api/(.*)$': path.join(webSource, 'api', '$1'),
    '^@/layout/(.*)$': path.join(webSource, 'layout', '$1'),
    '^@/components/(.*)$': path.join(webSource, 'components', '$1'),
    '^@/(.*)$': path.join(webSource, '$1'),
  },
};
