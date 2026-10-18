import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { FolderListing, VaultPort } from '../../src/adapters/vault-port';

/** In-memory VaultPort with failure injection, used for integration tests (not a substitute for E2E). */
export class MemoryVaultPort implements VaultPort {
	files = new Map<string, string>();
	folders = new Set<string>();
	failWrites = false;
	failCopies = false;
	writes: string[] = [];

	static fromDir(dir: string): MemoryVaultPort {
		const v = new MemoryVaultPort();
		const walk = (d: string) => {
			for (const name of readdirSync(d)) {
				const p = join(d, name);
				const rel = relative(dir, p).split('\\').join('/');
				if (statSync(p).isDirectory()) {
					v.addFolder(rel);
					walk(p);
				} else v.files.set(rel, name.endsWith('.png') ? '<binary>' : readFileSync(p, 'utf8'));
			}
		};
		walk(dir);
		return v;
	}

	addFolder(path: string): void {
		const parts = path.split('/');
		for (let i = 1; i <= parts.length; i++) this.folders.add(parts.slice(0, i).join('/'));
	}

	snapshot(prefix: string): string {
		return JSON.stringify([...this.files.entries()].filter(([k]) => k.startsWith(prefix)).sort());
	}

	private checkWrite(path: string): void {
		if (this.failWrites) throw new Error('EROFS: read-only file system');
		this.writes.push(path);
		const dir = path.split('/').slice(0, -1).join('/');
		if (dir) this.addFolder(dir);
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path) || this.folders.has(path);
	}
	async read(path: string): Promise<string> {
		const v = this.files.get(path);
		if (v === undefined) throw new Error(`ENOENT: ${path}`);
		return v;
	}
	async write(path: string, data: string): Promise<void> {
		this.checkWrite(path);
		this.files.set(path, data);
	}
	async process(path: string, fn: (data: string) => string): Promise<string> {
		const cur = await this.read(path);
		const next = fn(cur);
		this.checkWrite(path);
		this.files.set(path, next);
		return next;
	}
	async list(folder: string): Promise<FolderListing> {
		const files: string[] = [];
		const folders: string[] = [];
		for (const f of this.files.keys()) if (f.startsWith(`${folder}/`) && !f.slice(folder.length + 1).includes('/')) files.push(f);
		for (const f of this.folders) if (f.startsWith(`${folder}/`) && !f.slice(folder.length + 1).includes('/')) folders.push(f);
		return { files, folders };
	}
	async copy(from: string, to: string): Promise<void> {
		if (this.failCopies) throw new Error('copy failed');
		const v = await this.read(from);
		if (this.files.has(to)) throw new Error('target exists');
		this.checkWrite(to);
		this.files.set(to, v);
	}
	async removeServiceFile(path: string): Promise<void> {
		this.files.delete(path);
	}
	noteExists(path: string): boolean {
		return this.files.has(path);
	}
	async readNote(path: string): Promise<string> {
		return this.read(path);
	}
	async createNote(path: string, content: string): Promise<void> {
		if (this.files.has(path)) throw new Error('File already exists.');
		await this.write(path, content);
	}
	async processNote(path: string, fn: (data: string) => string): Promise<string> {
		return this.process(path, fn);
	}
	async setFrontmatter(path: string, values: Record<string, unknown>): Promise<void> {
		await this.process(path, (text) => {
			const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
			const lines = m ? (m[1] as string).split('\n') : [];
			for (const [k, v] of Object.entries(values)) {
				const i = lines.findIndex((l) => l.startsWith(`${k}:`));
				const line = `${k}: ${String(v)}`;
				if (i >= 0) lines[i] = line;
				else lines.push(line);
			}
			const body = m ? text.slice(m[0].length) : text;
			return `---\n${lines.join('\n')}\n---\n${body}`;
		});
	}
	frontmatterOf(path: string): Record<string, unknown> | null {
		const text = this.files.get(path);
		if (!text) return null;
		const m = /^---\n([\s\S]*?)\n---/.exec(text);
		if (!m) return null;
		const out: Record<string, unknown> = {};
		for (const l of (m[1] as string).split('\n')) {
			const i = l.indexOf(':');
			if (i > 0) out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
		}
		return out;
	}
	folderExists(path: string): boolean {
		return this.folders.has(path);
	}
}
