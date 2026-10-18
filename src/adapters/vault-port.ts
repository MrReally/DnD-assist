// Narrow file-system port. Implemented by ObsidianVaultPort (real app) and MemoryVaultPort (tests).
// Services depend only on this interface, which keeps them testable without Obsidian.

export interface FolderListing {
	files: string[];
	folders: string[];
}

export interface VaultPort {
	/** Raw adapter access (works for hidden dot-files that Obsidian does not index). */
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	/** Read-modify-write; if fn throws, nothing is written. */
	process(path: string, fn: (data: string) => string): Promise<string>;
	list(folder: string): Promise<FolderListing>;
	/** Copies a file (used only for backups/conflict copies). */
	copy(from: string, to: string): Promise<void>;
	/** Deletes a plugin-owned service file (only backup rotation uses this). */
	removeServiceFile(path: string): Promise<void>;

	/** Indexed Markdown notes. */
	noteExists(path: string): boolean;
	readNote(path: string): Promise<string>;
	createNote(path: string, content: string): Promise<void>;
	processNote(path: string, fn: (data: string) => string): Promise<string>;
	/** Adds/updates frontmatter keys without touching the note body. */
	setFrontmatter(path: string, values: Record<string, unknown>): Promise<void>;
	frontmatterOf(path: string): Record<string, unknown> | null;
	folderExists(path: string): boolean;
}

export class FileConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FileConflictError';
	}
}
