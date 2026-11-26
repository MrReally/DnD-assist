#!/usr/bin/env node
// Builds the DEMO vault: node scripts/demo-vault/make-demo-vault.mjs <outDir> [pluginDir]
// pluginDir = an extracted release folder (canvas-assist/); when given, the plugin is pre-installed and pre-connected.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [out, plugin] = process.argv.slice(2);
if (!out) throw new Error('usage: make-demo-vault.mjs <outDir> [pluginDir]');
const root = resolve(new URL('../..', import.meta.url).pathname);
const tmp = mkdtempSync(join(tmpdir(), 'demo-'));
process.env.DEMO_SCRIPT_DIR = join(root, 'scripts', 'demo-vault');
try {
	await build({ entryPoints: [join(root, 'scripts/demo-vault/gen.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(tmp, 'gen.mjs'), logLevel: 'error' });
	const { generate } = await import(pathToFileURL(join(tmp, 'gen.mjs')).href);
	const r = generate(resolve(out), { srdFile: join(root, 'data/srd51/srd51.json'), ...(plugin ? { pluginDir: resolve(plugin) } : {}) });
	console.log(`demo vault: ${resolve(out)} (${r.files.length} entries)`);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
