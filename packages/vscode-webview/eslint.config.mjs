import { defineConfig, globalIgnores } from 'eslint/config';
import { fixupConfigRules, fixupPluginRules } from '@eslint/compat';
import typescriptEslintEslintPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default defineConfig([
  globalIgnores(['**/eslint.config.mjs']),

  {
    extends: fixupConfigRules(compat.extends('plugin:prettier/recommended', 'plugin:react-hooks/recommended')),
    plugins: {
      '@typescript-eslint': fixupPluginRules(typescriptEslintEslintPlugin),
      'react-hooks': fixupPluginRules(reactHooks),
      'simple-import-sort': simpleImportSort,
    },
    languageOptions: {
      globals: { ...globals.browser },
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // No inline options — defers to the repo's own .prettierrc (root)
      // rather than digital-factory-ui's project-specific width/quote style.
      'prettier/prettier': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },

  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: fixupConfigRules(compat.extends('plugin:@typescript-eslint/recommended')),
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: 'tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
]);
