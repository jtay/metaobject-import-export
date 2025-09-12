import js from '@eslint/js';
import ts from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
	{ ignores: ['eslint.config.mjs', 'node_modules/**', 'dist/**', '.cursor/**'] },
	js.configs.recommended,
	...ts.configs.recommended,
	reactPlugin.configs.flat.recommended,
	{
		plugins: {
			react: reactPlugin,
			import: importPlugin,
			'react-hooks': reactHooks
		},
		languageOptions: {
			sourceType: 'module',
			ecmaVersion: 'latest',
			parserOptions: { ecmaFeatures: { jsx: true } }
		},
		settings: {
			react: { version: 'detect' },
			'import/resolver': {
				typescript: {
					alwaysTryTypes: true,
					project: ['./tsconfig.json']
				}
			}
		},
		rules: {
			'react/jsx-uses-react': 'off',
			'react/react-in-jsx-scope': 'off',
			'no-console': 'warn',
			'no-unused-expressions': 'off',
			'@typescript-eslint/no-unused-expressions': 'off',
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/exhaustive-deps': 'warn'
		}
	}
]; 