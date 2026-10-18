import esbuild from 'esbuild';
import process from 'process';
import { builtinModules } from 'node:module';

// Based on obsidianmd/obsidian-sample-plugin. Node built-ins stay external so that a stray
// import fails the mobile-safety check (scripts/check-bundle.mjs) instead of being bundled.
const banner = `/*
D&D Canvas Assist — bundled by esbuild. Source: see repository.
*/
`;

const prod = process.argv[2] === 'production';

const context = await esbuild.context({
	banner: { js: banner },
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'@codemirror/autocomplete',
		'@codemirror/collab',
		'@codemirror/commands',
		'@codemirror/language',
		'@codemirror/lint',
		'@codemirror/search',
		'@codemirror/state',
		'@codemirror/view',
		'@lezer/common',
		'@lezer/highlight',
		'@lezer/lr',
		...builtinModules,
	],
	format: 'cjs',
	target: 'es2021',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outfile: 'main.js',
	minify: prod,
	metafile: true,
	// Keep Cyrillic UI strings as UTF-8 instead of 6-byte \u escapes (≈2× smaller bundle).
	charset: 'utf8',
});

if (prod) {
	await context.rebuild();
	await context.dispose();
	process.exit(0);
} else {
	await context.watch();
}
