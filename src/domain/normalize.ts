export interface NormalizeOptions {
	/** Treat «ё» and «е» as the same letter. */
	foldYo: boolean;
}

export function normalizeText(input: string, opts: NormalizeOptions): string {
	let s = input.normalize('NFC').toLowerCase();
	if (opts.foldYo) s = s.replace(/ё/g, 'е');
	return s.replace(/\s+/g, ' ').trim();
}

/** Characters forbidden in file names on at least one supported platform or by Obsidian links. */
// eslint-disable-next-line no-control-regex -- control characters must be rejected in file names
const FORBIDDEN_FILE_CHARS = /[\\/:*?"<>|#^[\]\u0000-\u001f]/g;

export function sanitizeFileName(name: string): string {
	const cleaned = name.replace(FORBIDDEN_FILE_CHARS, ' ').replace(/\s+/g, ' ').trim();
	const noDots = cleaned.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
	return noDots.slice(0, 120) || 'Персонаж';
}

/**
 * Normalizes a vault-relative path and rejects anything that could escape a root:
 * absolute paths, drive letters, `..` segments, empty segments, control characters.
 */
export function safeRelativePath(path: string): string | null {
	if (typeof path !== 'string' || path.length === 0 || path.length > 1024) return null;
	// eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
	if (/[\u0000-\u001f]/.test(path)) return null;
	const unified = path.replace(/\\/g, '/');
	if (unified.startsWith('/') || /^[a-zA-Z]:/.test(unified)) return null;
	const parts = unified.split('/');
	for (const p of parts) {
		if (p === '' || p === '.' || p === '..') return null;
	}
	return parts.join('/');
}

export function joinPath(root: string, rel: string): string {
	if (!root) return rel;
	return `${root.replace(/\/+$/, '')}/${rel}`;
}

/** Returns the root-relative part of a vault path or null if it is outside root. */
export function relativeTo(root: string, vaultPath: string): string | null {
	if (!root) return vaultPath;
	const prefix = root.endsWith('/') ? root : `${root}/`;
	return vaultPath.startsWith(prefix) ? vaultPath.slice(prefix.length) : null;
}

export function isInside(root: string, vaultPath: string): boolean {
	return relativeTo(root, vaultPath) !== null;
}

export function basename(path: string): string {
	const last = path.split('/').pop() ?? path;
	return last.replace(/\.(md|canvas|json)$/i, '');
}

export function escapeMarkdownInline(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\|/g, '\\|')
		.replace(/\[\[/g, '\\[\\[')
		.replace(/!\[/g, '!\\[')
		.replace(/\r?\n/g, ' ');
}

/** True if a string looks like it contains HTML/script markup. */
export function looksLikeMarkup(s: string): boolean {
	return /<\s*\/?\s*[a-z!][^>]*>|javascript:|on\w+\s*=/i.test(s);
}
