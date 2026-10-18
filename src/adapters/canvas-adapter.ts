// The ONLY place that touches the live (undocumented) Canvas view internals.
// Official canvas.d.ts describes the JSON file format only, so every live operation is
// capability-probed at call time and falls back to public API behaviour.
import type { View } from 'obsidian';

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
