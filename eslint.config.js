const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettierPlugin = require('eslint-plugin-prettier');

module.exports = [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'services/**/node_modules/**',
      'services/**/dist/**',
      'services/web-dapp/out/**'
    ]
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: 'module'
    },
    plugins: {
      '@typescript-eslint': tseslint,
      prettier: prettierPlugin
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'prettier/prettier': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module'
    },
    plugins: {
      prettier: prettierPlugin
    },
    rules: {
      'prettier/prettier': 'warn'
    }
  }
];
