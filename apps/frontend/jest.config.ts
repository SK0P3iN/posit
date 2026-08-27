import type { Config } from 'jest';

// Minimal, standalone Jest config for this package. This repo's root
// jest.config.ts delegates to `@nx/jest`'s getJestProjects(), but there is no
// Nx project wiring for apps/frontend yet, so that aggregator finds nothing
// here (the same situation libraries/nestjs-libraries/jest.config.ts already
// documents and works around for that package). Run this config directly and
// independently of the root `pnpm test`:
//   npx jest --config apps/frontend/jest.config.ts
const config: Config = {
  displayName: 'frontend',
  rootDir: __dirname,
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  moduleNameMapper: {
    '^@gitroom/frontend/(.*)$': '<rootDir>/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/../../libraries/helpers/src/$1',
    '^@gitroom/react/(.*)$':
      '<rootDir>/../../libraries/react-shared-libraries/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // isolatedModules: transpile each file independently instead of
          // type-checking the whole program graph. This is the first test
          // file in this package and pulling in the full @gitroom program
          // (which has no dedicated test tsconfig) is out of scope here;
          // per-file transpilation is enough to run assertions against
          // runtime behavior.
          isolatedModules: true,
          module: 'commonjs',
          target: 'es2020',
          lib: ['es2020', 'dom'],
          jsx: 'react-jsx',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          strictPropertyInitialization: false,
          strictNullChecks: false,
          skipLibCheck: true,
        },
      },
    ],
  },
};

export default config;
