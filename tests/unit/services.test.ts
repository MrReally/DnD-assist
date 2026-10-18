import { describe, expect, it } from 'vitest';
import { parseOfflineReference, OfflineReference } from '../../src/adapters/offline-reference';
import { safeTtgUrl, TtgLinkProvider, TtgOnlineSearch } from '../../src/adapters/ttg-adapter';
import { CONDITIONS } from '../../src/domain/conditions';
import { formatClock, formatMinutes } from '../../src/domain/effect-clock';
import { findConflicts, isTypingTarget, matchesHotkey, parseHotkey } from '../../src/services/hotkeys';
import { NavigationHistory } from '../../src/services/navigation';
import { DEFAULT_SETTINGS, mergeSettings } from '../../src/settings';

describe('горячие клавиши', () => {
	it('разбор и сопоставление по физической клавише (русская раскладка)', () => {
		const hk = parseHotkey('Shift+F')!;
		expect(hk).toEqual({ shift: true, alt: false, mod: false, code: 'KeyF' });
		// On a Russian layout e.key is «А», but e.code stays KeyF.
		expect(matchesHotkey({ code: 'KeyF', shiftKey: true, altKey: false, ctrlKey: false, metaKey: false }, hk)).toBe(true);
		expect(matchesHotkey({ code: 'KeyF', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }, hk)).toBe(false);
		expect(parseHotkey('Shift+Alt+Space')).toEqual({ shift: true, alt: true, mod: false, code: 'Space' });
		expect(parseHotkey('Hyper+X')).toBeNull();
		expect(parseHotkey('')).toBeNull();
	});
	it('конфликты: дубликаты и голый пробел', () => {
		const c = findConflicts({ ...DEFAULT_SETTINGS.hotkeys, heal: 'Shift+D', next: 'Space' });
		expect(c.some((x) => x.includes('Shift+D'))).toBe(true);
		expect(c.some((x) => x.includes('панорамированием'))).toBe(true);
		expect(findConflicts(DEFAULT_SETTINGS.hotkeys)).toEqual([]);
	});
	it('ввод текста распознаётся без DOM (null-безопасно)', () => {
		expect(isTypingTarget(null)).toBe(false);
		const fake = { closest: (sel: string) => (sel.includes('iframe') ? {} : null), isContentEditable: false };
		expect(isTypingTarget(fake as unknown as EventTarget)).toBe(true);
	});
});

describe('история навигации', () => {
	it('недавние 8, назад/вперёд, переименование', () => {
		const n = new NavigationHistory(8);
		for (let i = 0; i < 10; i++) n.push({ canvasPath: 'a.canvas', nodeId: `n${i}`, title: `${i}` });
		expect(n.recent).toHaveLength(8);
		expect(n.back()?.nodeId).toBe('n8');
		expect(n.back()?.nodeId).toBe('n7');
		expect(n.forward()?.nodeId).toBe('n8');
		n.push({ canvasPath: 'a.canvas', nodeId: 'x', title: 'x' });
		expect(n.canForward()).toBe(false);
		n.renamePath('a.canvas', 'b.canvas');
		expect(n.forCanvas('b.canvas')).toHaveLength(8);
	});
});

describe('справочники', () => {
	it('TTG: только https-ссылки ttg.club', () => {
		expect(safeTtgUrl('/bestiary/goblin')).toBe('https://5e14.ttg.club/bestiary/goblin');
		expect(safeTtgUrl('https://5e14.ttg.club/bestiary/goblin')).toBe('https://5e14.ttg.club/bestiary/goblin');
		expect(safeTtgUrl('javascript:alert(1)')).toBeNull();
		expect(safeTtgUrl('http://5e14.ttg.club/x')).toBeNull();
		expect(safeTtgUrl('https://evil.example/ttg.club')).toBeNull();
		expect(safeTtgUrl('https://ttg.club.evil.example/')).toBeNull();
		expect(new TtgLinkProvider().getSourceUrl({ provider: 'ttg2014', ref: 'nonsense' })).toBe('https://5e14.ttg.club/bestiary/');
	});
	it('онлайн-поиск выключен по умолчанию: ни одного запроса', async () => {
		let calls = 0;
		const s = new TtgOnlineSearch(async () => {
			calls++;
			return { status: 200, json: [] };
		}, () => false);
		expect(await s.search('гоблин')).toEqual([]);
		expect(calls).toBe(0);
	});
	it('онлайн-поиск: разбор ответа, сбой сети не ломает UI', async () => {
		const ok = new TtgOnlineSearch(async () => ({ status: 200, json: [{ name: { rus: 'Гоблин', eng: 'Goblin' }, url: '/bestiary/goblin', challengeRating: '1/4', source: { shortName: 'MM' } }, { name: { rus: 'Зло' }, url: 'javascript:x' }] }), () => true);
		const hits = await ok.search('гоблин');
		expect(hits).toEqual([{ ref: { provider: 'ttg2014', ref: 'https://5e14.ttg.club/bestiary/goblin' }, name: 'Гоблин', subtitle: 'Goblin · ПО 1/4 · MM', url: 'https://5e14.ttg.club/bestiary/goblin' }]);
		expect(await ok.getSummary()).toBeNull();
		const down = new TtgOnlineSearch(async () => {
			throw new Error('offline');
		}, () => true);
		expect(await down.search('гоблин')).toEqual([]);
		expect(await down.isAvailable()).toBe(false);
	});
	it('локальный JSON-справочник', async () => {
		const r = new OfflineReference();
		r.load(JSON.stringify({ creatures: [{ name: 'Гоблин', aliases: ['Goblin'], ac: 15, hpMax: 7, sourceUrl: 'javascript:alert(1)' }, { nope: 1 }] }));
		expect(r.size).toBe(1);
		const hits = await r.search('goblin');
		expect(hits[0]!.name).toBe('Гоблин');
		const sum = await r.getSummary(hits[0]!.ref);
		expect(sum).toMatchObject({ ac: 15, hpMax: 7, sourceUrl: null });
		expect(parseOfflineReference('{').error).toMatch(/Некорректный JSON/);
	});
	it('реестр состояний: стабильные id и ссылки на TTG без текстов правил', () => {
		expect(CONDITIONS.find((c) => c.id === 'frightened')?.name).toBe('Испуганный');
		expect(CONDITIONS.every((c) => c.url.startsWith('https://5e14.ttg.club/screens/'))).toBe(true);
		expect(new Set(CONDITIONS.map((c) => c.id)).size).toBe(CONDITIONS.length);
	});
});

describe('настройки и время', () => {
	it('слияние настроек с защитой от мусора', () => {
		const s = mergeSettings({ historyMaxEntries: 1e9, restProfile: 'x', hotkeys: { damage: 'Shift+X' }, adventures: [{ adventureId: 'a', rootPath: 'A', name: 'A' }, null, 5] });
		expect(s.historyMaxEntries).toBe(1000);
		expect(s.restProfile).toBe('2014');
		expect(s.hotkeys.damage).toBe('Shift+X');
		expect(s.hotkeys.search).toBe('Shift+F');
		expect(s.adventures).toHaveLength(1);
		expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});
	it('формат игрового времени', () => {
		expect(formatMinutes(0)).toBe('0 мин.');
		expect(formatMinutes(1500)).toBe('1 д. 1 ч.');
		expect(formatClock(1440 + 75)).toBe('День 2, 01:15');
	});
});
