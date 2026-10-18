// Plugin-own navigation history (recent 8, back/forward). Independent of Obsidian's history.

export interface NavEntry {
	canvasPath: string;
	nodeId: string;
	title: string;
}

const same = (a: NavEntry, b: NavEntry): boolean => a.canvasPath === b.canvasPath && a.nodeId === b.nodeId;

export class NavigationHistory {
	private stack: NavEntry[] = [];
	private index = -1;
	recent: NavEntry[] = [];

	constructor(private readonly recentLimit = 8) {}

	push(entry: NavEntry): void {
		const cur = this.stack[this.index];
		if (cur && same(cur, entry)) return;
		this.stack = this.stack.slice(0, this.index + 1);
		this.stack.push(entry);
		if (this.stack.length > 50) this.stack.shift();
		this.index = this.stack.length - 1;
		this.recent = [entry, ...this.recent.filter((r) => !same(r, entry))].slice(0, this.recentLimit);
	}

	canBack(): boolean {
		return this.index > 0;
	}

	canForward(): boolean {
		return this.index < this.stack.length - 1;
	}

	back(): NavEntry | null {
		if (!this.canBack()) return null;
		this.index -= 1;
		return this.stack[this.index] ?? null;
	}

	forward(): NavEntry | null {
		if (!this.canForward()) return null;
		this.index += 1;
		return this.stack[this.index] ?? null;
	}

	/** Called on file rename/delete so stale entries never point to another file. */
	renamePath(oldPath: string, newPath: string): void {
		const fix = (e: NavEntry): NavEntry => (e.canvasPath === oldPath ? { ...e, canvasPath: newPath } : e);
		this.stack = this.stack.map(fix);
		this.recent = this.recent.map(fix);
	}

	forCanvas(canvasPath: string): NavEntry[] {
		return this.recent.filter((r) => r.canvasPath === canvasPath);
	}
}
