// JSON → preview → explicit apply. Notes are created/updated only inside Elements/Персонажи of the
// active adventure, and only the plugin-owned block of an existing note is replaced.
import { parseImportText, planImport, type CharacterImport, type ImportIssue, type ImportPlan } from '../domain/character';
import { appendSeparator, findManagedBlock, mergeManagedBlock, newCharacterNote, removeAppendedBlock, renderSheetBlock } from '../domain/character-markdown';
import { newId } from '../domain/ids';
import { joinPath, relativeTo, safeRelativePath, sanitizeFileName } from '../domain/normalize';
import type { AdventureState, CharacterState, FileSnapshot } from '../domain/types';
import type { VaultPort } from '../adapters/vault-port';
import type { AdventureStore, DispatchOutcome } from './persistence';

export const PC_FOLDER = 'Elements/Персонажи';

export type ImportMode = 'create' | 'update' | 'skip';

export interface ImportCandidate {
	index: number;
	input: CharacterImport | null;
	errors: ImportIssue[];
	warnings: ImportIssue[];
	mode: ImportMode;
	/** Root-relative note path. */
	targetPath: string;
	existingId: string | null;
	/** A note with the same file name exists but is not linked by ID: the user must choose. */
	nameClash: string | null;
	reason: string;
}

export interface ImportReportLine {
	index: number;
	name: string;
	status: 'created' | 'updated' | 'skipped' | 'error';
	message: string;
}

async function listPcFolder(port: VaultPort, root: string): Promise<string[]> {
	const folder = joinPath(root, PC_FOLDER);
	if (!port.folderExists(folder)) return [];
	try {
		const { files } = await port.list(folder);
		return files.filter((f) => f.toLowerCase().endsWith('.md'));
	} catch {
		return [];
	}
}

function uniquePath(base: string, taken: Set<string>): string {
	if (!taken.has(base)) return base;
	const stem = base.replace(/\.md$/i, '');
	for (let i = 2; i < 1000; i++) {
		const p = `${stem} ${i}.md`;
		if (!taken.has(p)) return p;
	}
	return `${stem} ${Date.now()}.md`;
}

export async function prepareImport(port: VaultPort, state: AdventureState, text: string): Promise<{ fatal: string | null; candidates: ImportCandidate[] }> {
	const parsed = parseImportText(text);
	if (parsed.fatal) return { fatal: parsed.fatal, candidates: [] };
	const root = state.rootPath;
	const files = await listPcFolder(port, root);
	const idByFile = new Map<string, string>();
	for (const f of files) {
		const id = port.frontmatterOf(f)?.canvasAssistId;
		if (typeof id === 'string') idByFile.set(f, id);
	}
	const taken = new Set(files.map((f) => relativeTo(root, f) ?? f));
	const candidates: ImportCandidate[] = [];
	for (const rec of parsed.records) {
		const base: ImportCandidate = {
			index: rec.index,
			input: rec.value,
			errors: rec.errors,
			warnings: rec.warnings,
			mode: 'skip',
			targetPath: '',
			existingId: null,
			nameClash: null,
			reason: 'Ошибки валидации — запись пропускается',
		};
		const input = rec.value;
		if (!input || rec.errors.length) {
			candidates.push(base);
			continue;
		}
		const fileName = `${sanitizeFileName(input.name)}.md`;
		const defaultPath = `${PC_FOLDER}/${fileName}`;
		const byId = input.characterId ? state.characters[input.characterId] : undefined;
		if (byId) {
			candidates.push({ ...base, mode: 'update', targetPath: byId.notePath, existingId: byId.id, reason: `Совпадение по ID ${byId.id}` });
			continue;
		}
		const linkedFile = input.characterId ? [...idByFile.entries()].find(([, id]) => id === input.characterId)?.[0] : undefined;
		if (linkedFile) {
			const rel = relativeTo(root, linkedFile) ?? defaultPath;
			candidates.push({ ...base, mode: 'update', targetPath: rel, existingId: input.characterId ?? null, reason: `Заметка с canvasAssistId ${input.characterId}` });
			continue;
		}
		if (taken.has(defaultPath)) {
			const clashId = idByFile.get(joinPath(root, defaultPath)) ?? null;
			const free = uniquePath(defaultPath, taken);
			taken.add(free);
			candidates.push({
				...base,
				mode: 'skip',
				targetPath: free,
				existingId: clashId && state.characters[clashId] ? clashId : null,
				nameClash: defaultPath,
				reason: 'Заметка с таким именем уже есть, но не связана по ID. Выберите: обновить её или создать новую.',
			});
			continue;
		}
		taken.add(defaultPath);
		candidates.push({ ...base, mode: 'create', targetPath: defaultPath, reason: 'Новый персонаж' });
	}
	return { fatal: null, candidates };
}

export function previewPlan(state: AdventureState, c: ImportCandidate, overwriteRuntime: boolean): ImportPlan | null {
	if (!c.input || c.mode === 'skip') return null;
	const existing = c.existingId ? state.characters[c.existingId] ?? null : null;
	const id = c.existingId ?? c.input.characterId ?? 'pc-new';
	const path = c.mode === 'update' && c.nameClash ? c.nameClash : c.targetPath;
	return planImport(c.input, existing, id, path, overwriteRuntime);
}

export async function applyImport(
	port: VaultPort,
	store: AdventureStore,
	candidates: ImportCandidate[],
	opts: { overwriteRuntime: boolean; addToPartyId: string | null },
): Promise<{ report: ImportReportLine[]; outcome: DispatchOutcome | null }> {
	const state = store.state;
	if (!state || !store.writable) return { report: [], outcome: { ok: false, changed: false, duplicate: false, label: 'Импорт', error: 'Запись недоступна' } };
	const root = state.rootPath;
	const report: ImportReportLine[] = [];
	const characters: CharacterState[] = [];
	const files: FileSnapshot[] = [];
	const usedIds = new Set(Object.keys(state.characters));
	for (const c of candidates) {
		const name = c.input?.name ?? `#${c.index + 1}`;
		if (!c.input || c.mode === 'skip') {
			report.push({ index: c.index, name, status: 'skipped', message: c.errors.length ? c.errors.map((e) => `${e.path}: ${e.message}`).join('; ') : c.reason });
			continue;
		}
		const rel = safeRelativePath(c.mode === 'update' && c.nameClash ? c.nameClash : c.targetPath);
		if (!rel || !rel.startsWith(`${PC_FOLDER}/`)) {
			report.push({ index: c.index, name, status: 'error', message: 'Путь вне Elements/Персонажи этого приключения отклонён' });
			continue;
		}
		const full = joinPath(root, rel);
		const existing = c.existingId ? state.characters[c.existingId] ?? null : null;
		let id = c.existingId ?? null;
		if (!id && c.mode === 'update') {
			const fmId = port.frontmatterOf(full)?.canvasAssistId;
			if (typeof fmId === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(fmId)) id = fmId;
		}
		if (!id) id = c.input.characterId && !usedIds.has(c.input.characterId) ? c.input.characterId : newId('pc');
		usedIds.add(id);
		const plan = planImport(c.input, existing, id, rel, opts.overwriteRuntime);
		const block = renderSheetBlock(c.input, id);
		try {
			if (c.mode === 'create') {
				if (port.noteExists(full)) throw new Error('Файл уже существует — создание отменено');
				await port.createNote(full, newCharacterNote(c.input.name, id, block));
				files.push({ path: full, beforeBlock: null, afterBlock: block });
				report.push({ index: c.index, name, status: 'created', message: rel });
			} else {
				if (!port.noteExists(full)) throw new Error('Заметка для обновления не найдена');
				let before = '';
				let separator: string | undefined;
				await port.processNote(full, (text) => {
					const loc = findManagedBlock(text);
					before = loc?.content ?? '';
					if (!loc) separator = appendSeparator(text);
					return mergeManagedBlock(text, block);
				});
				const fm = port.frontmatterOf(full);
				if (fm?.canvasAssistId !== id) await port.setFrontmatter(full, { canvasAssistId: id });
				files.push({ path: full, beforeBlock: before, afterBlock: block, ...(separator !== undefined ? { appendedSeparator: separator } : {}) });
				report.push({ index: c.index, name, status: 'updated', message: rel });
			}
			characters.push({ ...plan.character, notePath: rel });
		} catch (err) {
			report.push({ index: c.index, name, status: 'error', message: err instanceof Error ? err.message : String(err) });
		}
	}
	if (characters.length === 0) return { report, outcome: null };
	const outcome = await store.dispatch({ type: 'import/apply', characters, addToPartyId: opts.addToPartyId, files });
	if (!outcome.ok) {
		report.push({ index: -1, name: 'Состояние', status: 'error', message: `Заметки записаны, но состояние не сохранено: ${outcome.error ?? ''}. Повторный импорт свяжет их по ID.` });
	}
	return { report, outcome };
}

/** Restores managed blocks after undoing an import, only where the note still holds what we wrote. */
export async function revertImportFiles(port: VaultPort, files: FileSnapshot[]): Promise<string[]> {
	const notes: string[] = [];
	for (const f of files) {
		if (f.beforeBlock === null) {
			notes.push(`Файл «${f.path}» создан импортом и оставлен на месте (удаление не выполняется автоматически).`);
			continue;
		}
		if (!port.noteExists(f.path)) {
			notes.push(`Файл «${f.path}» не найден — восстановление блока пропущено.`);
			continue;
		}
		try {
			let skipped = false;
			await port.processNote(f.path, (text) => {
				const loc = findManagedBlock(text);
				if (!loc || loc.content !== f.afterBlock) {
					skipped = true;
					return text;
				}
				if (f.beforeBlock === '') return removeAppendedBlock(text, f.appendedSeparator ?? '');
				return text.slice(0, loc.start) + (f.beforeBlock ?? '') + text.slice(loc.end);
			});
			if (skipped) notes.push(`Блок в «${f.path}» изменён после импорта — оставлен без изменений.`);
		} catch (err) {
			notes.push(`«${f.path}»: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	return notes;
}
