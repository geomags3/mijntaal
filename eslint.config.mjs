import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    'dist/**',
    '.next/**',
    '.vinext/**',
    '.wrangler/**',
    '.sites-runtime/**',
    'outputs/**',
    'work/**',
    'public/dictionary/**',
  ]),
  {
    files: ['app/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],
    rules: {
      // Keep legacy JSON-boundary typing visible without hiding runtime-safety checks.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Existing mount/prop synchronization is supported without React Compiler.
      // These findings remain visible for incremental component refactoring.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    files: ['tests/**/*.cjs'],
    rules: {
      // The isolated VM harness deliberately uses CommonJS to load mocked modules.
      '@typescript-eslint/no-require-imports': 'off',
      // Audio mocks capture their receiver for assertions.
      '@typescript-eslint/no-this-alias': 'off',
    },
  },
]);
