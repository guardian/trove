import guardian from '@guardian/eslint-config';
import globals from 'globals';

export default [
	{ ignores: ['lambdas/*/dist/'] },
	...guardian.configs.recommended,
	{
		files: ['**/*.{js,mjs,jsx,ts,mts,tsx}'],
		languageOptions: {
			sourceType: 'module',
			parserOptions: { sourceType: 'module' },
			globals: {
				// Flat config merges globals, so unwanted inherited names must be disabled.
				...Object.fromEntries(
					Object.keys({ ...globals.browser, ...globals.node }).map((name) => [
						name,
						'off',
					]),
				),
				...globals.nodeBuiltin,
			},
		},
	},
];
