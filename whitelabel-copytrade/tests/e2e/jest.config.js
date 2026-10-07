// # Responsibility: runs the repository's cross-app smoke specs with the web and admin JSX/test environment.
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const adminSource = path.join(repositoryRoot, 'apps', 'admin-web', 'src');
const webSource = path.join(repositoryRoot, 'apps', 'web', 'src');

module.exports = {
  rootDir: repositoryRoot,
  roots: ['<rootDir>/tests/e2e'],
  testMatch: ['<rootDir>/tests/e2e/**/*.spec.ts'],
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
    '^@/components/ui$': path.join(adminSource, 'components', 'ui.tsx'),
    '^@/lib/(api-client|api-error|format|theme)$': path.join(adminSource, 'lib', '$1'),
    '^@/lib/(.*)$': path.join(webSource, 'lib', '$1'),
    '^@/api/(.*)$': path.join(webSource, 'api', '$1'),
    '^@/layout/(.*)$': path.join(webSource, 'layout', '$1'),
    '^@/components/(.*)$': path.join(webSource, 'components', '$1'),
    '^@/(.*)$': path.join(webSource, '$1'),
  },
};
