import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'release',
		'docs',
		'tests/fixtures',
		'.cache',
		'tests/e2e/out',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'scripts',
		'tests/e2e/*.mjs',
		'vitest.config.ts',
		'schemas',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['tests/**/*.ts'],
		languageOptions: { globals: { ...globals.node } },
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/no-tfile-tfolder-cast': 'off',
			'@typescript-eslint/no-non-null-assertion': 'off',
		},
	},
	{
		files: ['src/domain/**/*.ts'],
		rules: {
			'no-restricted-imports': ['error', { patterns: ['obsidian', 'electron', 'node:*', 'fs', 'path', '../adapters/*', '../services/*', '../ui/*'] }],
		},
	},
	{
		rules: {
			// Russian UI: proper nouns (Canvas, JSON, TTG, D&D, Elements/Персонажи) are false positives.
			'obsidianmd/ui/sentence-case': 'off',
			// minAppVersion is 1.7.2: the declarative settings API (1.13+) cannot be required yet.
			'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
		},
	},
	{
		files: ['src/ui/settings-tab.ts'],
		rules: { '@typescript-eslint/no-deprecated': 'off' },
	},
);
