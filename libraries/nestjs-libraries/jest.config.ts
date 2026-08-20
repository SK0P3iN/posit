import type { Config } from 'jest';

// Minimal, standalone Jest config for this package. This repo's root
// jest.config.ts delegates to `@nx/jest`'s getJestProjects(), but there is no
// Nx project wiring for libraries/nestjs-libraries yet, so that aggregator
// finds nothing here. Run this config directly and independently of the root
// `pnpm test`:
//   npx jest --config libraries/nestjs-libraries/jest.config.ts
const config: Config = {
  displayName: 'nestjs-libraries',
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@gitroom/nestjs-libraries/(.*)$': '<rootDir>/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/../helpers/src/$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          // isolatedModules: transpile each file independently instead of
          // type-checking the whole program graph. This is the first spec
          // file in the repo and pulling in the full @gitroom program (which
          // has no dedicated test tsconfig) is out of scope here; per-file
          // transpilation is enough to run assertions against runtime
          // behavior.
          isolatedModules: true,
          module: 'commonjs',
          target: 'es2020',
          lib: ['es2020', 'dom'],
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
