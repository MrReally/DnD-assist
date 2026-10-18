import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import type { FolderListing, VaultPort } from './vault-port';

/** VaultPort over the public Obsidian API (Vault, DataAdapter, FileManager, MetadataCache). */
export class ObsidianVaultPort implements VaultPort {
	constructor(private readonly app: App) {}

	private n(path: string): string {
		return normalizePath(path);
	}

	async exists(path: string): Promise<boolean> {
		return this.app.vault.adapter.exists(this.n(path));
	}

	async read(path: string): Promise<string> {
		return this.app.vault.adapter.read(this.n(path));
	}

	async write(path: string, data: string): Promise<void> {
		await this.app.vault.adapter.write(this.n(path), data);
	}

	async process(path: string, fn: (data: string) => string): Promise<string> {
		return this.app.vault.adapter.process(this.n(path), fn);
	}

	async list(folder: string): Promise<FolderListing> {
		const r = await this.app.vault.adapter.list(this.n(folder));
		return { files: r.files, folders: r.folders };
	}

	async copy(from: string, to: string): Promise<void> {
		await this.app.vault.adapter.copy(this.n(from), this.n(to));
	}

	async removeServiceFile(path: string): Promise<void> {
		const p = this.n(path);
		const name = p.split('/').pop() ?? '';
		// Guard: only rotated plugin backups may ever be removed.
		if (!name.startsWith('.canvas-assist-state.') || name === '.canvas-assist-state.json') {
			throw new Error('Удаление разрешено только для резервных копий Canvas Assist');
		}
		await this.app.vault.adapter.remove(p);
	}

	private file(path: string): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(this.n(path));
		return f instanceof TFile ? f : null;
	}

	noteExists(path: string): boolean {
		return this.file(path) !== null;
	}

	async readNote(path: string): Promise<string> {
		const f = this.file(path);
		if (!f) throw new Error(`Заметка не найдена: ${path}`);
		return this.app.vault.cachedRead(f);
	}

	async createNote(path: string, content: string): Promise<void> {
		await this.app.vault.create(this.n(path), content);
	}

	async processNote(path: string, fn: (data: string) => string): Promise<string> {
		const f = this.file(path);
		if (!f) throw new Error(`Заметка не найдена: ${path}`);
		return this.app.vault.process(f, fn);
	}

	async setFrontmatter(path: string, values: Record<string, unknown>): Promise<void> {
		const f = this.file(path);
		if (!f) throw new Error(`Заметка не найдена: ${path}`);
		await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
			for (const [k, v] of Object.entries(values)) fm[k] = v;
		});
	}

	frontmatterOf(path: string): Record<string, unknown> | null {
		const f = this.file(path);
		if (!f) return null;
		const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
		return fm ? { ...fm } : null;
	}

	folderExists(path: string): boolean {
		return this.app.vault.getAbstractFileByPath(this.n(path)) instanceof TFolder;
	}
}
