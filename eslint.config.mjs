import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      '.next/**',
      '.tmp/**',
      'node_modules/**',
      'wireframes/**',
      'src/features/shared/api/schema.d.ts',
      'out/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'db/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      'max-params': ['error', 4],
      'max-lines': [
        'error',
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ['src/server/**/*.ts', 'src/lib/**/*.ts'],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 40, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ['src/server/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: [
      'src/app/**/*.ts',
      'src/app/**/*.tsx',
      'src/components/**/*.ts',
      'src/components/**/*.tsx',
      'src/features/**/*.ts',
      'src/features/**/*.tsx',
    ],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 60, skipBlankLines: true, skipComments: true },
      ],
    },
  },
];

export default eslintConfig;
