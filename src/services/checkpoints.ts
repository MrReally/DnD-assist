// Canvas checkpoints: full copies of one .canvas file in <root>/.canvas-assist-checkpoints/<canvas>/.
// Restoring replaces ONLY the layout file (after a protective copy); the game state sidecar is never touched.
import type { VaultPort } from '../adapters/vault-port';

export const CHECKPOINT_DIR = '.canvas-assist-checkpoints';

export interface CheckpointInfo {
	path: string;
	name: string;
	at: string;
	nodes: number;
	kind: 'manual' | 'protective';
}

const stamp = (d: Date): string => d.toISOString().replace(/[:.]/g, '-');
const safe = (s: string): string => s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'точка';

export function canvasFolder(root: string, canvasRel: string): string {
	return `${root}/${CHECKPOINT_DIR}/${safe(canvasRel.replace(/\.canvas$/, '').replace(/\//g, '＿'))}`;
}

export function countNodes(json: string): number {
	try {
		const j = JSON.parse(json) as { nodes?: unknown };
		return Array.isArray(j.nodes) ? j.nodes.length : 0;
	} catch {
		return 0;
	}
}

export async function createCheckpoint(port: VaultPort, root: string, canvasPath: string, canvasRel: string, name: string, kind: 'manual' | 'protective' = 'manual', now = new Date()): Promise<CheckpointInfo> {
	const data = await port.read(canvasPath);
	JSON.parse(data); // never snapshot a corrupt canvas silently
	const dir = canvasFolder(root, canvasRel);
	await port.mkdirp(dir);
	const file = `${dir}/${stamp(now)}__${kind === 'protective' ? 'before-restore' : 'manual'}__${safe(name)}.canvas`;
	await port.write(file, data);
	return { path: file, name: safe(name), at: now.toISOString(), nodes: countNodes(data), kind };
}

export async function listCheckpoints(port: VaultPort, root: string, canvasRel: string): Promise<CheckpointInfo[]> {
	const dir = canvasFolder(root, canvasRel);
	let files: string[] = [];
	try {
		files = (await port.list(dir)).files;
	} catch {
		return [];
	}
	const out: CheckpointInfo[] = [];
	for (const f of files) {
		const base = f.split('/').pop() ?? f;
		const m = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)__(manual|before-restore)__(.*)\.canvas$/.exec(base);
		if (!m) continue;
		const at = (m[1] ?? '').replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z');
		let nodes = 0;
		try {
			nodes = countNodes(await port.read(f));
		} catch {
			nodes = 0;
		}
		out.push({ path: f, name: m[3] ?? '', at, nodes, kind: m[2] === 'manual' ? 'manual' : 'protective' });
	}
	return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** Protective copy first; if it fails nothing is changed. Validates the checkpoint before writing. */
export async function restoreCheckpoint(port: VaultPort, root: string, canvasPath: string, canvasRel: string, cp: CheckpointInfo): Promise<CheckpointInfo> {
	const data = await port.read(cp.path);
	JSON.parse(data);
	const protective = await createCheckpoint(port, root, canvasPath, canvasRel, 'до восстановления', 'protective');
	await port.write(canvasPath, data);
	return protective;
}
