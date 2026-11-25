// Room (location) card model parsed from a Markdown note. Reference only: there is NO "searched/found/taken"
// state, no progress counters and no history (SPEC §10). Sections whose heading marks them as hidden are
// only styled differently (hatching + icon + text).
export interface RoomSection {
	heading: string;
	body: string;
	hidden: boolean;
	level: number;
}

export interface RoomModel {
	title: string;
	intro: string;
	sections: RoomSection[];
}

const HIDDEN_RE = /скрыт|тайн|секрет|hidden|secret/i;

export function stripFrontmatter(md: string): string {
	return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

export function parseRoom(md: string, fallbackTitle: string): RoomModel {
	const lines = stripFrontmatter(md).split(/\r?\n/);
	let title = fallbackTitle;
	const intro: string[] = [];
	const sections: RoomSection[] = [];
	let cur: RoomSection | null = null;
	let inFence = false;
	let seenTitle = false;
	for (const line of lines) {
		if (/^```/.test(line)) inFence = !inFence;
		const m = inFence ? null : /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
		if (m) {
			const level = (m[1] ?? '#').length;
			const text = m[2] ?? '';
			if (!seenTitle && level === 1) {
				title = text || fallbackTitle;
				seenTitle = true;
				continue;
			}
			cur = { heading: text, body: '', hidden: HIDDEN_RE.test(text), level };
			sections.push(cur);
			continue;
		}
		if (cur) cur.body += `${line}\n`;
		else intro.push(line);
	}
	for (const s of sections) s.body = s.body.trim();
	return { title, intro: intro.join('\n').trim(), sections };
}

/** Room notes live under Elements/Локации. */
export function isRoomNote(relPath: string): boolean {
	return /^Elements\/Локации\/.+\.md$/.test(relPath);
}
