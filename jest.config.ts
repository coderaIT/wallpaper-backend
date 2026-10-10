import type { Config } from 'jest';

const shared = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }],
  },
  // Generated Prisma client uses explicit ".js" relative imports (nodenext style).
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
} satisfies Partial<Config>;

const config: Config = {
  projects: [
    {
      ...shared,
      displayName: 'unit',
      rootDir: '.',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
    },
    {
      ...shared,
      displayName: 'e2e',
      rootDir: '.',
      testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
      globalSetup: '<rootDir>/test/setup/global-setup.ts',
      setupFiles: ['<rootDir>/test/setup/env.ts'],
      testTimeout: 60_000,
    },
  ],
  collectCoverageFrom: ['src/**/*.ts', '!src/generated/**', '!src/main.ts'],
  coverageDirectory: 'coverage',
};

export default config;
