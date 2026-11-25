// The ONLY place that touches the live (undocumented) Canvas view internals.
// Official canvas.d.ts describes the JSON file format only, so every live operation is
// capability-probed at call time and falls back to public API behaviour.
import type { TFile, View } from 'obsidian';

export interface CanvasCapabilities {
	canFocusNode: boolean;
	reason: string;
}

interface LiveCanvasNode {
	id?: string;
}

interface LiveCanvas {
	nodes?: { get?: (id: string) => LiveCanvasNode | undefined; size?: number };
	selectOnly?: (node: LiveCanvasNode) => void;
	zoomToSelection?: () => void;
	zoomToBbox?: (bbox: unknown) => void;
	deselectAll?: () => void;
	tx?: number;
	ty?: number;
	tZoom?: number;
	setViewport?: (x: number, y: number, zoom: number) => void;
	requestSave?: () => void;
	createFileNode?: (opts: { file: unknown; pos: { x: number; y: number }; size?: { width: number; height: number }; save?: boolean; focus?: boolean }) => unknown;
	posCenter?: () => { x: number; y: number };
}

function liveCanvas(view: View | null): LiveCanvas | null {
	if (!view || view.getViewType() !== 'canvas') return null;
	const c = (view as unknown as { canvas?: unknown }).canvas;
	return typeof c === 'object' && c !== null ? c : null;
}

export function probeCanvas(view: View | null): CanvasCapabilities {
	const c = liveCanvas(view);
	if (!c) return { canFocusNode: false, reason: 'Нет открытого Canvas' };
	const ok =
		typeof c.nodes?.get === 'function' &&
		typeof c.selectOnly === 'function' &&
		(typeof c.zoomToSelection === 'function' || typeof c.zoomToBbox === 'function');
	return ok
		? { canFocusNode: true, reason: 'Живой Canvas API обнаружен (недокументированный, проверен E2E)' }
		: { canFocusNode: false, reason: 'Живой Canvas API недоступен в этой версии — используется запасной путь' };
}

/**
 * Selects and centers a node. Returns false (never throws) if the capability is missing,
 * the node is unknown or the internal API changed; callers then use the fallback.
 * Never writes to the canvas file.
 */
export function focusNode(view: View | null, nodeId: string): boolean {
	const c = liveCanvas(view);
	if (!c || !probeCanvas(view).canFocusNode) return false;
	try {
		const node = c.nodes?.get?.(nodeId);
		if (!node) return false;
		c.selectOnly?.(node);
		if (typeof c.zoomToSelection === 'function') c.zoomToSelection();
		return true;
	} catch {
		return false;
	}
}

// ---- GM Cockpit: selection and double-click binding (spikes S1, S6; tests/e2e/spikes.mjs) ----

interface LiveNodeFull extends LiveCanvasNode {
	nodeEl?: HTMLElement;
	file?: { path?: string };
}

interface LiveCanvasFull extends LiveCanvas {
	selection?: Set<LiveNodeFull>;
	nodes?: Map<string, LiveNodeFull> & LiveCanvas['nodes'];
	wrapperEl?: HTMLElement;
}

function fullCanvas(view: View | null): LiveCanvasFull | null {
	return liveCanvas(view) as LiveCanvasFull | null;
}

/** Vault paths of the files behind the currently selected file nodes (empty if unavailable). */
export function selectedFilePaths(view: View | null): string[] {
	try {
		const sel = fullCanvas(view)?.selection;
		if (!sel) return [];
		const out: string[] = [];
		for (const n of sel) if (typeof n.file?.path === 'string') out.push(n.file.path);
		return out;
	} catch {
		return [];
	}
}

/** File path of the file node that contains `target`, or null (text/group/link node, empty space). */
export function fileNodeAt(view: View | null, target: EventTarget | null): string | null {
	try {
		const c = fullCanvas(view);
		if (!c?.nodes || !(target instanceof Element)) return null;
		const el = target.closest('.canvas-node');
		if (!el) return null;
		for (const n of (c.nodes as Map<string, LiveNodeFull>).values()) {
			if (n.nodeEl === el) return typeof n.file?.path === 'string' ? n.file.path : null;
		}
		return null;
	} catch {
		return null;
	}
}

export interface CanvasWatchHandlers {
	/** Called (no polling) after pointer/keyboard input has settled with the new selection. */
	onSelection: (paths: string[]) => void;
	/** Double click on a file node. Return true to consume it (Canvas then does not start editing). */
	onDoubleClick: (path: string) => boolean;
}

/**
 * Listens on the Canvas view's own container. Selection is read two animation frames after
 * pointerup/keyup because Canvas updates `selection` after pointerup (a microtask is too early).
 * Returns a disposer. Never throws and never writes to the canvas.
 */
export function watchCanvas(view: View, h: CanvasWatchHandlers): () => void {
	const host = view.containerEl;
	let frame = 0;
	let last = '';
	const read = (): void => {
		window.cancelAnimationFrame(frame);
		frame = window.requestAnimationFrame(() => {
			frame = window.requestAnimationFrame(() => {
				const paths = selectedFilePaths(view);
				const key = paths.join('\n');
				if (key === last) return;
				last = key;
				h.onSelection(paths);
			});
		});
	};
	const dbl = (ev: MouseEvent): void => {
		const path = fileNodeAt(view, ev.target);
		if (!path) return;
		try {
			if (h.onDoubleClick(path)) {
				ev.stopPropagation();
				ev.preventDefault();
			}
		} catch (err) {
			console.error('[Canvas Assist] double click handler failed', err);
		}
	};
	host.addClass('gmc-themed');
	host.addEventListener('pointerup', read, true);
	host.addEventListener('keyup', read, true);
	host.addEventListener('dblclick', dbl, true);
	return () => {
		window.cancelAnimationFrame(frame);
		host.removeClass('gmc-themed');
		host.removeEventListener('pointerup', read, true);
		host.removeEventListener('keyup', read, true);
		host.removeEventListener('dblclick', dbl, true);
	};
}

// ---- view points (spike S4) ----------------------------------------------------------------------

export interface Viewport {
	x: number;
	y: number;
	zoom: number;
}

export function getViewport(view: View | null): Viewport | null {
	const c = liveCanvas(view);
	if (!c || typeof c.tx !== 'number' || typeof c.ty !== 'number' || typeof c.tZoom !== 'number') return null;
	return { x: c.tx, y: c.ty, zoom: c.tZoom };
}

/** Moves the Canvas camera. Returns false (never throws) when the internal API is unavailable. */
export function setViewport(view: View | null, v: Viewport): boolean {
	const c = liveCanvas(view);
	if (!c || typeof c.setViewport !== 'function') return false;
	try {
		c.setViewport(v.x, v.y, v.zoom);
		return true;
	} catch {
		return false;
	}
}

/** Asks Canvas to flush pending edits to disk (best effort). */
export function requestCanvasSave(view: View | null): void {
	try {
		(liveCanvas(view))?.requestSave?.();
	} catch {
		// optional
	}
}

// ---- explicit "add to Canvas" (spec §3.6: never automatic) ---------------------------------------------

/**
 * Adds a file node at the centre of the current view through Canvas' own node factory, so Obsidian itself
 * writes the .canvas file (the plugin never edits the JSON). Returns false when the internal API is missing.
 */
export function addFileNode(view: View | null, file: TFile): boolean {
	const c = liveCanvas(view);
	if (!c || typeof c.createFileNode !== 'function') return false;
	try {
		const p = typeof c.posCenter === 'function' ? c.posCenter() : { x: 0, y: 0 };
		c.createFileNode({ file, pos: { x: p.x - 130, y: p.y - 70 }, size: { width: 260, height: 140 }, save: true, focus: false });
		c.requestSave?.();
		return true;
	} catch {
		return false;
	}
}
