// Index of the ACTIVE canvas only (no vault-wide indexing). Rebuilt on demand when the
// canvas file's mtime or the overrides change.
import { TFile, type App } from 'obsidian';
import { buildItems, parseCanvas, type CanvasItem } from '../domain/canvas-model';
import type { NodeCategory } from '../domain/types';

export interface CanvasIndex {
	path: string;
	items: CanvasItem[];
	missingFiles: Set<string>;
	warnings: string[];
}

export class CanvasIndexService {
	private cache: { key: string; index: CanvasIndex } | null = null;

	constructor(private readonly app: App) {}

	invalidate(): void {
		this.cache = null;
	}

	async build(file: TFile, overrides: Record<string, NodeCategory>, foldYo: boolean): Promise<CanvasIndex> {
		const key = `${file.path}|${file.stat.mtime}|${file.stat.size}|${foldYo}|${JSON.stringify(overrides)}`;
		if (this.cache?.key === key) return this.cache.index;
		const text = await this.app.vault.cachedRead(file);
		const parsed = parseCanvas(text);
		const aliasesFor = (path: string): string[] => {
			const f = this.app.vault.getAbstractFileByPath(path);
			if (!(f instanceof TFile)) return [];
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter as { aliases?: unknown } | undefined;
			const a = fm?.aliases;
			return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : typeof a === 'string' ? [a] : [];
		};
		const items = buildItems(parsed, { foldYo, overrides, aliasesFor });
		const missingFiles = new Set<string>();
		for (const it of items) {
			if (it.filePath && !this.app.vault.getAbstractFileByPath(it.filePath)) missingFiles.add(it.nodeId);
		}
		const index: CanvasIndex = { path: file.path, items, missingFiles, warnings: parsed.warnings };
		this.cache = { key, index };
		return index;
	}
}
