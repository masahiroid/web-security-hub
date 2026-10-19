import js from '@eslint/js';
import globals from 'globals';
import security from 'eslint-plugin-security';

export default [
  { ignores: ['node_modules/**', '.desktop/**', '.runtime/**', 'artifacts/**', 'sites/**', 'src-tauri/**', 'core/verifier/generated/**', 'public/generated/**', 'docs/internal/**', 'training/sast/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
    plugins: { security },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'security/detect-child-process': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-possible-timing-attacks': 'error'
    }
  },
  { files: ['**/*.mjs', 'public/**/*.js', 'desktop/welcome/**/*.js'], languageOptions: { sourceType: 'module', globals: globals.browser } },
  { files: ['core/ai/assertionAdapter.js', 'core/crawler/**/*.js', 'core/runner/caseExecutor.js', 'core/security/dynamic/passiveAnalyzer.js', 'desktop/ui/**/*.js', 'scripts/**/*.js', 'test/**/*.js'], languageOptions: { globals: globals.browser } }
];
