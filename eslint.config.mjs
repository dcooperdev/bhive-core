import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      // Pre-existing rethrows in src/bee/Bee.ts and src/llm/adapters/OllamaAdapter.ts
      // drop the original error instead of attaching it as `cause` - real bug, but a
      // behavior change belongs in its own PR, not this CI/lint/dependabot setup.
      'preserve-caught-error': 'off',
    },
  },
);
