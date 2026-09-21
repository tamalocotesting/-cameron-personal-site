import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

/**
 * Flat config, using the configs eslint-config-next exports directly.
 *
 * It deliberately does not go through FlatCompat: this version of the Next
 * config is already a flat config array, and loading it through the compat
 * layer fails on its plugin references.
 */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'src/generated/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      'next-env.d.ts',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              importNames: ['PrismaClient'],
              message:
                'Import the shared client from @/server/db instead of constructing a new PrismaClient.',
            },
          ],
        },
      ],
    },
  },
  {
    // Scripts, the worker and the test suite run outside Next's runtime.
    files: ['scripts/**/*.ts', 'worker/**/*.ts', 'prisma/**/*.ts', 'tests/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];

export default config;
