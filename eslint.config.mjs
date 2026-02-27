import js from '@eslint/js';
import globals from 'globals';
import jest from 'eslint-plugin-jest';

export default [
    js.configs.recommended,
    {
        ignores: ['coverage/**', 'dist/**']
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                ...globals.es2021,
                chrome: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': 'warn',
            'no-console': 'off',
            'no-case-declarations': 'warn'
        }
    },
    {
        files: ['jest.config.js', 'jest.setup.js', 'eslint.config.mjs'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.jest
            }
        }
    },
    {
        files: ['__tests__/**/*.js', '**/*.test.js'],
        plugins: {
            jest: jest
        },
        languageOptions: {
            globals: {
                ...globals.jest,
                ...globals.node
            }
        },
        rules: {
            ...jest.configs.recommended.rules,
            'jest/no-done-callback': 'off', // Many legacy tests use done()
            'jest/no-conditional-expect': 'warn'
        }
    }
];
