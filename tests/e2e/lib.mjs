// Real-app E2E harness: launches the official Obsidian desktop build in an isolated, temporary
// profile + vault and drives it over the Chrome DevTools Protocol (playwright-core connectOverCDP).
// Playwright's _electron launcher is not used: the Obsidian binary rejects its injected loader.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT = join(REPO, 'tests', 'e2e', 'out');
export const PLUGIN_ID = 'canvas-assist';

export function obsidianBinary() {
	const candidates = [process.env.OBSIDIAN_BIN, join(REPO, '.cache', 'obsidian', 'squashfs-root', 'obsidian'), '/opt/obs/squashfs-root/obsidian', '/usr/bin/obsidian', '/Applications/Obsidian.app/Contents/MacOS/Obsidian'].filter(Boolean);
	return candidates.find((p) => existsSync(p)) ?? null;
}

export function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function freePort() {
	return new Promise((res, rej) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address();
			s.close(() => res(port));
		});
		s.on('error', rej);
	});
}

/** Creates an isolated sandbox: <root>/vault (copy of fixtures), <root>/config (Obsidian profile). */
/** Obsidian reads its global config from XDG_CONFIG_HOME on Linux and from ~/Library/Application Support on macOS (HOME is redirected into the sandbox). */
function writeGlobalProfile(root, profile, files) {
	const dirs = [join(profile, 'obsidian')];
	if (process.platform === 'darwin') dirs.push(join(root, 'Library', 'Application Support', 'obsidian'));
	if (process.platform === 'win32') dirs.push(join(root, 'AppData', 'Roaming', 'obsidian'));
	for (const d of dirs) {
		mkdirSync(d, { recursive: true });
		for (const [name, data] of Object.entries(files)) writeFileSync(join(d, name), data);
	}
}

export function createSandbox(name, extraPlugins = [], size = { width: 1440, height: 900 }) {
	const root = join(OUT, 'sandbox', name);
	rmSync(root, { recursive: true, force: true });
	const vault = join(root, 'vault');
	cpSync(join(REPO, 'tests', 'fixtures', 'test-vault'), vault, { recursive: true });
	for (const adv of ['Приключение А', 'Приключение Б']) mkdirSync(join(vault, adv, 'trash'), { recursive: true });
	// JSON import fixtures inside the vault (import reads files from the vault only).
	cpSync(join(REPO, 'tests', 'fixtures', 'import'), join(vault, 'Импорт'), { recursive: true });
	const configDir = join(vault, '.obsidian');
	mkdirSync(join(configDir, 'plugins', PLUGIN_ID), { recursive: true });
	installPlugin(vault);
	for (const p of extraPlugins) cpSync(p.dir, join(configDir, 'plugins', p.id), { recursive: true });
	writeFileSync(join(configDir, 'community-plugins.json'), JSON.stringify([PLUGIN_ID, ...extraPlugins.map((p) => p.id)]));
	writeFileSync(join(configDir, 'app.json'), JSON.stringify({ promptDelete: false, alwaysUpdateLinks: true }));
	const profile = join(root, 'config');
	writeGlobalProfile(root, profile, {
		'obsidian.json': JSON.stringify({ vaults: { e2evault0001: { path: vault, ts: Date.now(), open: true } }, updateDisabled: true }),
		// Per-vault window state read by Obsidian on start: reference 13" laptop size.
		'e2evault0001.json': JSON.stringify({ x: 0, y: 0, width: size.width, height: size.height, isMaximized: false, devTools: false, zoom: 0 }),
	});
	return { root, vault, profile, configDir };
}

/** Sandbox around an already prepared vault (e.g. the demo vault): isolated profile, window size from `size`. */
export function createSandboxFromVault(name, vault, size = { width: 1440, height: 900 }) {
	const root = join(OUT, 'sandbox', name);
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	const profile = join(root, 'config');
	writeGlobalProfile(root, profile, {
		'obsidian.json': JSON.stringify({ vaults: { e2evault0001: { path: vault, ts: Date.now(), open: true } }, updateDisabled: true }),
		'e2evault0001.json': JSON.stringify({ x: 0, y: 0, width: size.width, height: size.height, isMaximized: false, devTools: false, zoom: 0 }),
	});
	return { root, vault, profile, configDir: join(vault, '.obsidian') };
}

/** Installs the plugin like a user would: the three release files into <vault>/.obsidian/plugins/<id>. */
export function installPlugin(vault) {
	const dir = join(vault, '.obsidian', 'plugins', PLUGIN_ID);
	mkdirSync(dir, { recursive: true });
	const src = process.env.CA_E2E_FROM_RELEASE ? join(REPO, 'release') : REPO;
	for (const f of ['main.js', 'manifest.json', 'styles.css']) cpSync(join(src, f), join(dir, f));
	cpSync(process.env.CA_E2E_FROM_RELEASE ? join(src, 'srd51.json') : join(REPO, 'data', 'srd51', 'srd51.json'), join(dir, 'srd51.json'));
}

export class ObsidianApp {
	constructor(sandbox, opts = {}) {
		this.sandbox = sandbox;
		this.opts = opts;
		this.console = [];
		this.pageErrors = [];
		this.requests = [];
	}

	async launch() {
		const bin = obsidianBinary();
		if (!bin) throw new Error('BLOCKED: REAL_OBSIDIAN_E2E — Obsidian binary not found (set OBSIDIAN_BIN)');
		this.port = await freePort();
		const args = ['--no-sandbox', `--remote-debugging-port=${this.port}`, '--disable-gpu', '--force-device-scale-factor=1', `--window-size=${this.opts.width ?? 1440},${this.opts.height ?? 900}`];
		if (this.opts.offline) args.push('--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>');
		const env = { ...process.env, HOME: this.sandbox.root, XDG_CONFIG_HOME: this.sandbox.profile, LANG: 'ru_RU.UTF-8' };
		if (this.opts.offline) {
			delete env.HTTPS_PROXY;
			delete env.HTTP_PROXY;
			delete env.https_proxy;
			delete env.http_proxy;
		}
		this.proc = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
		this.log = [];
		this.proc.stdout.on('data', (d) => this.log.push(d.toString()));
		this.proc.stderr.on('data', (d) => this.log.push(d.toString()));
		const deadline = Date.now() + 60000;
		let lastErr;
		while (Date.now() < deadline) {
			try {
				this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.port}`, { timeout: 5000 });
				break;
			} catch (e) {
				lastErr = e;
				await sleep(500);
			}
		}
		if (!this.browser) throw new Error(`Не удалось подключиться к Obsidian по CDP: ${lastErr}`);
		this.page = await this.findPage();
		this.page.on('console', (m) => this.console.push({ type: m.type(), text: m.text() }));
		this.page.on('pageerror', (e) => this.pageErrors.push(String(e)));
		this.cdp = await this.page.context().newCDPSession(this.page);
		await this.cdp.send('Network.enable');
		this.cdp.on('Network.requestWillBeSent', (e) => this.requests.push({ url: e.request.url, initiator: e.initiator?.type, ts: Date.now() }));
		await this.page.waitForFunction(() => typeof window.app !== 'undefined' && window.app.workspace?.layoutReady, null, { timeout: 60000 });
		// Reference profile: 13" laptop (1440×900). --window-size is ignored by Obsidian, so set bounds via CDP.
		try {
			const { windowId } = await this.cdp.send('Browser.getWindowForTarget');
			await this.cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: this.opts.width ?? 1440, height: this.opts.height ?? 900, windowState: 'normal' } });
			await sleep(500);
		} catch (e) {
			// Not fatal: some window managers refuse; screenshots then use the default size.
			this.boundsError = String(e);
		}
		return this;
	}

	async findPage() {
		const deadline = Date.now() + 30000;
		while (Date.now() < deadline) {
			for (const ctx of this.browser.contexts()) {
				for (const p of ctx.pages()) if (p.url().startsWith('app://obsidian.md/index.html')) return p;
			}
			await sleep(300);
		}
		throw new Error('Окно Obsidian не найдено');
	}

	/** Turns restricted mode off and enables the plugin via Obsidian's own plugin manager. */
	async enablePlugin() {
		// The vault ships plugins: Obsidian asks whether to trust the author. The driver answers it.
		const trust = this.page.getByRole('button', { name: /Довериться автору|Trust author/ });
		if (await trust.count().catch(() => 0)) {
			await trust.first().click();
			await sleep(1500);
		}
		return this.page.evaluate(async (id) => {
			const p = window.app.plugins;
			if (!p.isEnabled?.() && typeof p.setEnable === 'function') await p.setEnable(true);
			if (!p.enabledPlugins.has(id)) await p.enablePluginAndSave(id);
			const deadline = Date.now() + 20000;
			while (!p.plugins[id]?._loaded && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
			return { loaded: !!p.plugins[id]?._loaded, version: p.manifests[id]?.version, restricted: !p.isEnabled?.() };
		}, PLUGIN_ID);
	}

	async eval(fn, arg) {
		return this.page.evaluate(fn, arg);
	}

	async openFile(path) {
		await this.page.evaluate(async (p) => {
			const f = window.app.vault.getAbstractFileByPath(p);
			if (!f) throw new Error(`no file ${p}`);
			const leaf = window.app.workspace.getLeaf(false);
			await leaf.openFile(f);
			window.app.workspace.setActiveLeaf(leaf, { focus: true });
		}, path);
		await sleep(700);
	}

	async command(id) {
		const ok = await this.page.evaluate((cid) => window.app.commands.executeCommandById(cid), id);
		await sleep(300);
		return ok;
	}

	async screenshot(name) {
		const path = join(OUT, 'screenshots', `${name}.png`);
		mkdirSync(dirname(path), { recursive: true });
		await this.page.screenshot({ path });
		return path;
	}

	async close({ kill = false } = {}) {
		try {
			if (!kill) await this.page.evaluate(() => window.app?.workspace?.requestSaveLayout?.()).catch(() => undefined);
			await this.browser?.close().catch(() => undefined);
		} finally {
			if (this.proc && this.proc.exitCode === null) {
				this.proc.kill(kill ? 'SIGKILL' : 'SIGTERM');
				const deadline = Date.now() + 10000;
				while (this.proc.exitCode === null && this.proc.signalCode === null && Date.now() < deadline) await sleep(100);
				if (this.proc.exitCode === null && this.proc.signalCode === null) this.proc.kill('SIGKILL');
			}
			await sleep(500);
		}
	}

	pluginErrors() {
		return [...this.pageErrors, ...this.console.filter((c) => c.type === 'error' && /canvas.assist|canvas-assist|Canvas Assist/i.test(c.text)).map((c) => c.text)];
	}
}

/**
 * First start of a fresh vault shows Obsidian's "trust author" dialog. The driver answers it,
 * then restarts once: in Obsidian 1.14.4 modals do not open in the same session right after that
 * dialog (observed for the built-in command palette too), so tests run in the second session.
 */
export async function launchTrusted(sandbox, opts = {}) {
	const first = await new ObsidianApp(sandbox, opts).launch();
	await first.enablePlugin();
	await first.close();
	const app = await new ObsidianApp(sandbox, opts).launch();
	const r = await app.enablePlugin();
	if (!r.loaded) throw new Error('plugin did not load after restart');
	return app;
}

export function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}
