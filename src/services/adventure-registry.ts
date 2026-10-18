// Maps vault paths to registered adventure roots. Only the light-weight list of roots lives in
// plugin settings; everything else is in each adventure's own sidecar file.
import type { RegisteredAdventure } from '../settings';
import { isInside } from '../domain/normalize';
import type { VaultPort } from '../adapters/vault-port';
import { STATE_FILE } from './persistence';

export const KNOWN_SUBFOLDERS = ['Холсты', 'Сюжет', 'Elements', 'Images', 'trash'];

export interface RootCandidate {
	path: string;
	score: number;
	hasState: boolean;
	markers: string[];
}

export class AdventureRegistry {
	constructor(
		private readonly port: VaultPort,
		private readonly list: () => RegisteredAdventure[],
		private readonly save: (list: RegisteredAdventure[]) => Promise<void>,
	) {}

	all(): RegisteredAdventure[] {
		return this.list();
	}

	/** Longest registered root containing the path. Nested roots are refused at registration. */
	findForPath(vaultPath: string): RegisteredAdventure | null {
		let best: RegisteredAdventure | null = null;
		for (const a of this.list()) {
			if (isInside(a.rootPath, vaultPath) && (!best || a.rootPath.length > best.rootPath.length)) best = a;
		}
		return best;
	}

	byId(adventureId: string): RegisteredAdventure | null {
		return this.list().find((a) => a.adventureId === adventureId) ?? null;
	}

	/** Suggests adventure roots among the ancestors of a Canvas file (no vault-wide scan). */
	async candidatesFor(canvasPath: string): Promise<RootCandidate[]> {
		const parts = canvasPath.split('/');
		parts.pop();
		const out: RootCandidate[] = [];
		for (let i = parts.length; i >= 1; i--) {
			const path = parts.slice(0, i).join('/');
			const markers = KNOWN_SUBFOLDERS.filter((f) => this.port.folderExists(`${path}/${f}`));
			const hasState = await this.port.exists(`${path}/${STATE_FILE}`);
			let score = markers.length * 10 + (hasState ? 100 : 0);
			if (parts[i] === 'Холсты') score += 15;
			out.push({ path, score, hasState, markers });
		}
		return out.sort((a, b) => b.score - a.score || b.path.length - a.path.length);
	}

	validateNewRoot(rootPath: string): string | null {
		if (!rootPath) return 'Корень приключения не может быть корнем всего хранилища';
		for (const a of this.list()) {
			if (a.rootPath === rootPath) return null;
			if (isInside(a.rootPath, rootPath) || isInside(rootPath, a.rootPath)) {
				return `Вложенные приключения не поддерживаются: пересекается с «${a.rootPath}»`;
			}
		}
		return null;
	}

	async register(entry: RegisteredAdventure): Promise<void> {
		const err = this.validateNewRoot(entry.rootPath);
		if (err) throw new Error(err);
		const others = this.list().filter((a) => a.adventureId !== entry.adventureId && a.rootPath !== entry.rootPath);
		const dup = this.list().find((a) => a.adventureId === entry.adventureId && a.rootPath !== entry.rootPath);
		if (dup && (await this.port.exists(`${dup.rootPath}/${STATE_FILE}`))) {
			throw new Error(`Приключение с тем же ID уже зарегистрировано в «${dup.rootPath}». Скопированная папка? Создайте новое состояние.`);
		}
		await this.save([...others, entry]);
	}

	async unregister(adventureId: string): Promise<void> {
		await this.save(this.list().filter((a) => a.adventureId !== adventureId));
	}

	/** Folder rename/move events: update registered roots that are the folder or inside it. */
	async handleRename(oldPath: string, newPath: string): Promise<RegisteredAdventure[]> {
		const changed: RegisteredAdventure[] = [];
		const next = this.list().map((a) => {
			if (a.rootPath === oldPath || isInside(oldPath, a.rootPath)) {
				const rootPath = newPath + a.rootPath.slice(oldPath.length);
				const updated = { ...a, rootPath, name: rootPath.split('/').pop() || a.name };
				changed.push(updated);
				return updated;
			}
			return a;
		});
		if (changed.length) await this.save(next);
		return changed;
	}

	/**
	 * Relinks a registered adventure whose root was renamed while the app was closed:
	 * a state file with the same adventureId found at the candidate root.
	 */
	async relink(adventureId: string, newRoot: string): Promise<void> {
		const next = this.list().map((a) => (a.adventureId === adventureId ? { ...a, rootPath: newRoot, name: newRoot.split('/').pop() || a.name } : a));
		await this.save(next);
	}
}
