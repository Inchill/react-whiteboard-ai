import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist', 'dist-demo', 'coverage', 'eval/out'] },
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2022,
            globals: globals.browser,
        },
        plugins: {
            'react-hooks': reactHooks,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            quotes: ['error', 'single', { avoidEscape: true }],
            semi: ['error', 'always'],
            'eol-last': ['error', 'always'],
            indent: ['error', 4, { SwitchCase: 1 }],
            'no-console': 'warn',
        },
    },
    {
        // Command-line scripts: they report to the terminal.
        files: ['eval/**/*.ts'],
        languageOptions: { globals: globals.node },
        rules: { 'no-console': 'off' },
    },
);
