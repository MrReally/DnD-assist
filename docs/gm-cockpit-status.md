# GM Cockpit — состояние прототипа (вертикальный срез)

Ветка `claude/gm-cockpit-spec-qz2m5e`. Obsidian 1.14.4 (Linux, Xvfb), окно 1280×800, изолированный Vault.

## Реализовано
- **GM Cockpit panel** (`src/ui/gm-panel.ts`) — правая боковая панель рядом со штатным Canvas, нативный DOM.
- **Узел → карточка**: `watchCanvas` (`src/adapters/canvas-adapter.ts`): выбор через `canvas.selection` (без polling), двойной клик по файловому узлу персонажа, запасные пути — команда «Открыть выбранный объект в GM Cockpit», пункт меню узла `canvas:node-menu` (**не проверен E2E**), настройка отключения двойного клика.
- **Домен**: `src/domain/card.ts` (узел → персонаж внутри корня приключения, ввод HP `−7 / +5 / =12`); HP меняются существующими действиями `hp/damage`, `hp/heal`, `character/set-hp` → тот же редьюсер, Undo/Redo, sidecar.
- **Brass Atlas** (токены в `.gmc`, область видимости ограничена), рамка выбранного узла `.gmc-themed .canvas-node.is-focused`. Шрифты не встраиваются: системные fallback (Cormorant/Inter используются, только если установлены).
- **Импорт заклинаний**: `src/domain/spell-import.ts` — цепочка импортёров (локальная библиотека по названию/ссылке, JSON, ручной ввод), без сетевых запросов. **UI импорта и локальное хранилище карточек в этом срезе НЕ реализованы** — только домен и тесты.
- **Lightkey**: `src/domain/osc.ts`, `src/domain/lightkey.ts`, `src/adapters/osc-transport.ts`; настройки хоста/порта/адреса/команды, команда «Lightkey: тестовая отправка». Привязка cue к заклинанию — модель `CueBinding` есть, UI привязки нет.
- Бюджет бандла: `main.js` 213 019 Б (потолок 512 000 Б); CSS отдельно.

## Проверки
| Набор | Результат |
|---|---|
| lint + tsc | PASS |
| unit | 133/133 PASS (новые: card 15, osc/lightkey 9, spell-import 15) |
| integration | 31/31 PASS |
| Спайки §8 (`tests/e2e/spikes.mjs`) | 7/7 PASS, см. `gm-cockpit-matrix.md` |
| Срез E2E (`tests/e2e/cockpit.mjs`) | 12/12 PASS |
| Регрессия v1 E2E (`npm run test:e2e`) | 55 PASS, 1 NOT_RUN (mobile), 1 INFO — как в v1 |

## Не подтверждено
Реальный Lightkey (порт, глаголы); macOS/Windows; другие версии Obsidian; меню узла; мобильные; рельс 40 px; PartyDock/InitiativeStrip в новой раскладке; производительность 500+ узлов на новом коде (прогон v1 PERF/MEM PASS включал новый код, но не измерял двойной клик).
