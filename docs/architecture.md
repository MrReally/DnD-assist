# Архитектура Canvas Assist

## Слои

```text
src/
  main.ts                 жизненный цикл, команды, события, контекстные горячие клавиши
  controller.ts           склейка: активное приключение, хранилища, выбор цели, события Vault
  settings.ts             лёгкие глобальные настройки (loadData/saveData), реестр корней
  domain/                 ЧИСТЫЙ код: без obsidian/DOM/сети/файлов (запрещено ESLint)
    types.ts actions.ts reducer.ts undo.ts combat.ts effect-clock.ts encounter.ts
    hp.ts rest.ts character.ts character-markdown.ts canvas-model.ts conditions.ts
    migrations.ts schema.ts state.ts normalize.ts ids.ts
  adapters/
    vault-port.ts         узкий интерфейс файловых операций (тесты подменяют его памятью)
    obsidian-vault.ts     реализация через Vault/DataAdapter/FileManager/MetadataCache
    canvas-adapter.ts     ЕДИНСТВЕННОЕ место с живым Canvas API (проба возможностей + fallback)
    ttg-adapter.ts        ссылки TTG; опциональный онлайн-поиск (выкл. по умолчанию)
    offline-reference.ts  локальный JSON-справочник пользователя
    statblock-adapter.ts  необязательный Fantasy Statblocks (флаг)
  services/
    persistence.ts        AdventureStore: sidecar, очередь записи, ревизии, миграции, восстановление
    adventure-registry.ts корни приключений, переименования, переподключение, копии
    import-service.ts     JSON → предпросмотр → запись управляемого блока Markdown
    canvas-index.ts navigation.ts hotkeys.ts
  ui/                     нативный DOM + компоненты Obsidian, без фреймворков
    overlay.ts            верхняя строка, лента инициативы, навигатор, панель цели (поверх Canvas)
    panel.ts              боковая панель: бой, партия, шаблоны, время, история
    *-modal.ts            урон/лечение, эффекты, отдых, импорт, шаблоны, карточка, восстановление
```

## Поток данных

```text
UI / горячая клавиша / команда
   → Controller.act(payload)
     → AdventureStore.dispatch          (очередь на приключение)
        → domain.dispatch(state, action)  чистый редьюсер; идемпотентность по actionId
        → diff → HistoryEntry(patch)      Undo/Redo = применение before/after патча
        → DataAdapter.process(...)        запись, только если на диске ожидаемые revision+stateId
     ← успех ТОЛЬКО после записи; иначе состояние в памяти не меняется
   → onChange → перерисовка (по сигнатуре: без изменений — без пересборки DOM)
```

## Ключевые инварианты и где они обеспечены

| Инвариант | Механизм | Тесты |
|---|---|---|
| Запись принадлежит ровно одному приключению | `action.adventureId === state.adventureId`, отдельный store на корень, вложенные корни запрещены | unit AC-32, integration AC-01, E2E AC-01 |
| Один PC — одно состояние | HP PC живут в `characters`, участник боя ссылается `characterId`; один PC — один раз в бою | unit combat |
| Уникальные `combatantId` | генерируются при запуске шаблона/добавлении | unit/E2E AC-13, AC-14 |
| Пользовательский Markdown не меняется вне блока | `<!-- canvas-assist:begin/end -->`, повреждённые маркеры → отказ | unit import, E2E AC-10 |
| Успех только после записи | `persist()` до обновления `state`; при ошибке — «НЕ сохранено» | integration AC-33, E2E AC-33 |
| Нет тихого last-write-wins | `revision`+`stateId` в `process()`; конфликт → копия локальной версии, остановка записи | integration/E2E AC-35 |
| Сначала резервная копия, потом миграция | `safeCopy` перед записью v2; без копии миграция отменяется | integration/E2E AC-43 |
| Повреждённый файл не перезаписывается | режим только чтения + копия `.corrupt-*` | integration/E2E AC-34 |
| Таймеры только по игровым событиям | `emitEvent` с монотонным `eventSeq`; эффект считает события с `seq > createdAtEventSeq` | unit effects, E2E AC-22/23 |
| Canvas не изменяется плагином | нет кода записи; E2E перехватывает все записи и проверяет стек | E2E AC-38 |

## Временная модель (§8)

- События: `round-start`, `turn-start`, `turn-end`, `round-end`; каждое получает `eventSeq`.
- Эффект хранит `createdAtEventSeq`, `duration` (`manual` / `turns{owner,phase,remaining}` / `rounds{phase,remaining}` / `game-time{expiresAtMinute}`), независимые `target` и `sourceCombatantId`.
- «До начала следующего хода X» = `turns{owner: X, phase: start, remaining: 1}`.
- Повторный конец хода в раунде невозможен: `actedThisRound` + `turnEnded` + `turnInstanceId`.
- Прыжок к участнику: события только для текущего (конец) и целевого (начало); пропущенные показываются в подтверждении.
- «Предыдущий ход» — по компактному журналу `turnLog` (до 20 ходов: тики `from→to` и снимки истёкших эффектов). Undo — по общей истории.
- Владелец длительности удалён/бой завершён → `needsDecision`, а не удаление.

## Хранение

- `<AdventureRoot>/.canvas-assist-state.json` — компактный JSON, схема v2 (`schemas/adventure-state.schema.json`), проверяется рантайм-валидатором `domain/schema.ts`; ajv-тесты сверяют оба.
- Резервные копии: `.canvas-assist-state.backup-v1-*.json` (лимит настраивается), `.corrupt-*`, `.conflict-local-*`, `.conflict-external-*`, `.before-fork-*`, `.replaced-*`.
- Глобально (`data.json` плагина): только реестр корней и настройки.
- История: последние 100 действий / 256 КиБ (настраивается), `appliedActionIds` — 500 последних.

## ADR (решения по умолчанию)

1. **Пробел не назначается.** Canvas использует Space(+drag) для панорамирования. По умолчанию: «Следующий ход» `Shift+Space`, «Предыдущий» `Shift+Alt+Space`. Остальное — как в ТЗ (`Shift+F/D/H/E/K`). Клавиши сравниваются по `KeyboardEvent.code`, поэтому работают в русской раскладке. Все действия доступны и как команды Obsidian (без назначенных клавиш).
2. **Оверлей монтируется рядом с содержимым Canvas, а не внутри него**: Canvas перехватывает указатель в своём поддереве, и клики по кнопкам терялись (найдено E2E).
3. **Перерисовка по сигнатуре** (adventureId, revision, статус, цель, свёрнутость): без изменений DOM не пересобирается — иначе первый клик после смены вкладки терялся.
4. **Навигатор свёрнут по умолчанию** (не закрывает Canvas); `Shift+F` разворачивает его и ставит фокус в поиск.
5. **Компактный JSON** для sidecar (типичное состояние ≈115 КБ вместо ≈570 КБ с отступами); человекочитаемая часть — Markdown-листы.
6. **Копия папки приключения** с тем же `adventureId` не подключается молча: предлагается «сделать отдельным приключением» (новый ID, резервная копия).
7. **Онлайн TTG выключен по умолчанию**; без сети нет ни одного запроса плагина (E2E AC-40 считает вызовы транспорта).
8. **Цвета**: производные `color-mix` от переменных темы, чтобы контраст текста ≥ 4.5:1 в светлой и тёмной теме (E2E AC-41).
