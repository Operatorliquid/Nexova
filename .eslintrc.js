module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./apps/*/tsconfig.json', './packages/*/tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'import', 'boundaries'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:import/typescript',
    'prettier',
  ],
  settings: {
    'import/resolver': {
      typescript: {
        project: ['./apps/*/tsconfig.json', './packages/*/tsconfig.json'],
      },
    },
    'boundaries/elements': [
      { type: 'shared', pattern: 'packages/shared/*' },
      { type: 'core', pattern: 'packages/core/*' },
      { type: 'retail', pattern: 'packages/retail/*' },
      { type: 'integrations', pattern: 'packages/integrations/*' },
      { type: 'agent-runtime', pattern: 'packages/agent-runtime/*' },
      { type: 'api', pattern: 'apps/api/*' },
      { type: 'worker', pattern: 'apps/worker/*' },
      { type: 'dashboard', pattern: 'apps/dashboard/*' },
    ],
    'boundaries/ignore': ['**/*.test.ts', '**/*.spec.ts', '**/test/**'],
  },
  rules: {
    // ══════════════════════════════════════════════════════════════════════
    // BOUNDARY RULES - Enforce module dependencies
    // ══════════════════════════════════════════════════════════════════════
    'boundaries/element-types': [
      'error',
      {
        default: 'disallow',
        rules: [
          // shared: NO dependencies on other packages
          { from: 'shared', allow: [] },
          // core: only shared
          { from: 'core', allow: ['shared'] },
          // retail: shared + core
          { from: 'retail', allow: ['shared', 'core'] },
          // integrations: shared + core (NO retail)
          { from: 'integrations', allow: ['shared', 'core'] },
          // agent-runtime: shared + core + integrations (retail via DI only)
          { from: 'agent-runtime', allow: ['shared', 'core', 'integrations'] },
          // api: all packages
          { from: 'api', allow: ['shared', 'core', 'retail', 'integrations', 'agent-runtime'] },
          // worker: all packages
          { from: 'worker', allow: ['shared', 'core', 'retail', 'integrations', 'agent-runtime'] },
          // dashboard: only shared (for types)
          { from: 'dashboard', allow: ['shared'] },
        ],
      },
    ],

    // ══════════════════════════════════════════════════════════════════════
    // IMPORT RULES
    // ══════════════════════════════════════════════════════════════════════
    'import/order': [
      'warn',
      {
        groups: ['builtin', 'external', 'internal', ['parent', 'sibling'], 'index'],
        pathGroups: [{ pattern: '@nexova/**', group: 'internal', position: 'before' }],
        pathGroupsExcludedImportTypes: ['builtin'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    'import/no-cycle': 'error',
    'import/no-self-import': 'error',
    'import/no-useless-path-segments': 'error',
    'import/no-relative-packages': 'error',

    // ══════════════════════════════════════════════════════════════════════
    // TYPESCRIPT RULES
    // ══════════════════════════════════════════════════════════════════════
    '@typescript-eslint/explicit-function-return-type': [
      'warn',
      {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
      },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': [
      'warn',
      {
        prefer: 'type-imports',
        fixStyle: 'inline-type-imports',
      },
    ],
    '@typescript-eslint/no-floating-promises': 'warn',
    '@typescript-eslint/await-thenable': 'warn',
    '@typescript-eslint/no-unsafe-assignment': 'warn',
    '@typescript-eslint/no-unsafe-member-access': 'warn',
    '@typescript-eslint/no-unsafe-call': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',
    '@typescript-eslint/no-unsafe-argument': 'warn',
    '@typescript-eslint/no-misused-promises': 'warn',
    '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
    '@typescript-eslint/restrict-template-expressions': 'warn',
    '@typescript-eslint/require-await': 'warn',
    '@typescript-eslint/ban-types': 'warn',
    '@typescript-eslint/no-redundant-type-constituents': 'warn',
    '@typescript-eslint/no-duplicate-type-constituents': 'warn',
    '@typescript-eslint/no-base-to-string': 'warn',

    // ══════════════════════════════════════════════════════════════════════
    // GENERAL RULES
    // ══════════════════════════════════════════════════════════════════════
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'prefer-const': 'error',
    'no-var': 'error',
    'no-unsafe-finally': 'warn',
    'no-useless-escape': 'warn',
  },
  overrides: [
    // Relax rules for test files
    {
      files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-floating-promises': 'off',
      },
    },
    // Dashboard (React)
    {
      files: ['apps/dashboard/**/*.tsx', 'apps/dashboard/**/*.ts'],
      extends: ['plugin:react/recommended', 'plugin:react-hooks/recommended'],
      settings: { react: { version: 'detect' } },
      rules: {
        'react/react-in-jsx-scope': 'off',
        'react/prop-types': 'off',
        'react/no-unescaped-entities': 'warn',
        'react-hooks/set-state-in-effect': 'warn',
        'react-hooks/static-components': 'warn',
        'react-hooks/immutability': 'warn',
      },
    },
  ],
};
