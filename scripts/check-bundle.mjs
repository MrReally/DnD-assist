#!/usr/bin/env node
// Release gate: bundle size budget + mobile safety (no Node/Electron at runtime) + no network
// primitives other than Obsidian's requestUrl. Exit code != 0 on violation.
import { readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';

const BUDGET = 200 * 1024;
const js = readFileSync('main.js', 'utf8');
const size = statSync('main.js').size;
const problems = [];

const requires = [...js.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
const allowed = new Set(['obsidian']);
for (const r of new Set(requires)) {
	const bare = r.replace(/^node:/, '');
	if (!allowed.has(r)) problems.push(`runtime require("${r}")${builtinModules.includes(bare) || r === 'electron' ? ' — Node/Electron module breaks mobile' : ''}`);
}
for (const pat of [/\bfetch\(/, /XMLHttpRequest/, /new WebSocket/, /\beval\(/, /new Function\(/, /\.innerHTML\s*=/, /setInterval\(/]) {
	if (pat.test(js)) problems.push(`forbidden pattern ${pat}`);
}
if (size > BUDGET) problems.push(`main.js ${size} B exceeds budget ${BUDGET} B`);
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
if (manifest.isDesktopOnly !== false) problems.push('manifest.isDesktopOnly must be false (mobile-safe build)');

console.log(JSON.stringify({ mainJsBytes: size, budgetBytes: BUDGET, requires: [...new Set(requires)], isDesktopOnly: manifest.isDesktopOnly, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
