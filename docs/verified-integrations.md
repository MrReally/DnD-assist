# Проверенные интеграции и источники (research gate)

Дата исследования: **18.10.2026**. Статусы: **VERIFIED** — проверено на реальном приложении/ответе; **UNVERIFIED** — существует, но не подтверждено для нашего сценария или не является документированным API; **BLOCKED** — недоступно в окружении.

| Источник | Версия / дата | Что проверено | Статус | Как используется |
|---|---|---|---|---|
| Obsidian desktop (официальный AppImage) | **1.14.4**, Electron 43.7.7, Chrome 150; sha256 `6362ddbe…ffeaa`; `releases.obsidian.md/desktop.json` → latestVersion 1.14.4 | Запуск в изолированном профиле под Xvfb, загрузка плагина, все E2E-сценарии | **VERIFIED** | Целевая версия E2E; `minAppVersion` 1.7.2 (используемые API существуют с ≤1.7) |
| Obsidian API types (`obsidian` на npm) | 1.14.4 (2026-10-08) | `Vault.process`, `DataAdapter.process/list/copy/remove`, `FileManager.processFrontMatter`, `MetadataCache`, `requestUrl`, `Workspace` события | **VERIFIED** (типы + E2E) | Все файловые операции и события |
| `canvas.d.ts` (из пакета `obsidian`) | 1.14.4 | Описывает **только JSON-формат** Canvas (nodes/edges/group/file/text/link, `[key: string]: any`) | **VERIFIED** как формат; живого API нет | Чтение `.canvas` через `Vault.cachedRead` + собственный валидатор |
| Живой Canvas view (`view.canvas.nodes/selectOnly/zoomToSelection`) | Obsidian 1.14.4 | Найдено в рантайме; выделение и центрирование узла подтверждены E2E (AC-06); отключение API → fallback (AC-06-fallback) | **UNVERIFIED** как публичный API (недокументирован), **VERIFIED** поведением на 1.14.4 | Только в `src/adapters/canvas-adapter.ts`, с проверкой возможностей при каждом вызове и запасным путём |
| Редактирование текстового узла Canvas | Obsidian 1.14.4 | Редактор узла находится **внутри iframe** (`embed-iframe`) | **VERIFIED** (E2E AC-37b) | Горячие клавиши игнорируются, если фокус в iframe/редакторе |
| Перезапись `.canvas` самим Obsidian | Obsidian 1.14.4 | При открытии Obsidian переформатирует JSON и добавляет `fromSide/toSide` рёбрам | **VERIFIED** (E2E AC-38, перехват записей) | Плагин в `.canvas` не пишет никогда; неизвестные поля сохраняет Obsidian |
| Диалог «Доверяете автору хранилища?» | Obsidian 1.14.4 | После ответа в той же сессии модальные окна (включая палитру команд) не открываются до перезапуска | **VERIFIED** (наблюдение) | E2E-раннер отвечает на диалог и один раз перезапускает Obsidian |
| obsidianmd/obsidian-sample-plugin | ветка `master`, получено 18.10.2026 (`raw.githubusercontent.com`) | `package.json`, `esbuild.config.mjs`, `tsconfig.json`, `eslint.config.mts`, `version-bump.mjs`, CI | **VERIFIED** | Структура сборки скопирована; зависимости закреплены точными версиями |
| eslint-plugin-obsidianmd | 0.4.2 | Правила Obsidian (recommended) | **VERIFIED** | `npm run lint`; peer-зависимость `obsidian@1.8.7` → `legacy-peer-deps` в `.npmrc` |
| docs.obsidian.md (Plugin guidelines, Mobile development) | доступно 18.10.2026 (HTTP 200) | Требования: без Node/Electron на мобильных, `requestUrl` вместо fetch, без innerHTML | **VERIFIED** | `scripts/check-bundle.mjs` проверяет бандл |
| TTG Club 5e (2014) — сайт | `https://5e14.ttg.club/bestiary/`, `/screens/conditions_and_disease` | Страницы отвечают 200; SPA-клиент | **VERIFIED** | Открытие ссылок в браузере (`window.open`), только https `*.ttg.club` |
| TTG 5e14 внутренний endpoint `POST /api/v1/bestiary` | наблюдение 18.10.2026 | Отвечает JSON-списком (`name.rus/eng`, `url`, `challengeRating`, `source`). Не документирован как публичный API | **UNVERIFIED** | Только опциональный «Онлайн-поиск TTG (экспериментально)», **выключен по умолчанию**, только по явному запросу, сохраняются лишь название и ссылка |
| TTG 5e14 `POST /api/v1/screens/conditions_and_disease` | наблюдение 18.10.2026 | Список экранов: русские названия и slug состояний | **VERIFIED** как источник названий | В код включены только короткие названия и ссылки (без текстов правил) |
| TTG Core API | `github.com/TTG-Club/core-api` (README) | REST под `/api/v2`, Spring Boot; применимость к 5e14 не подтверждена | **UNVERIFIED** | Не используется |
| Условия TTG | `https://new.ttg.club/terms`, прочитано 18.10.2026 | Разрешено личное некоммерческое использование для игр; запрещено копировать значительные части и собирать содержимое так, что это мешает сайту | **VERIFIED** | Нет скрейпинга и кэширования текстов; локальный справочник — только данные пользователя |
| Fantasy Statblocks | release **4.10.3** (`obsidian-5e-statblocks`); `src/api/api.ts` (`window.FantasyStatblocks`, `getCreatureFromBestiary`, `isResolved`) | Реальный плагин установлен в тестовое хранилище; SRD-бестиарий, `Goblin` → КД 15, хиты 7 | **VERIFIED** (E2E COMPAT-FSB) | Необязательный адаптер под флагом, без импорта кода |
| Initiative Tracker | github.com/Obsidian-TTRPG-Community/initiative-tracker | Ориентир модели; код не копировался (GPL) | — | Не интегрирован |
| Leaflet / Relations / Calendarium / Dice Roller | — | Не нужны ядру по ТЗ | — | Не интегрированы; плагин работает без них (AC-40) |
| Playwright `_electron` | playwright-core 1.64.1 | Obsidian отклоняет внедряемый загрузчик (timeout) | **BLOCKED** для Obsidian | Используется `connectOverCDP` к `--remote-debugging-port` (VERIFIED) |
| GitHub API / codeload | — | 403 из окружения агента | **BLOCKED** (только окружение) | Файлы получены через `raw.githubusercontent.com` и release-ссылки |

## Решения, принятые по результатам исследования

1. **Запись в Canvas не реализована вообще.** Команда «создать карточку боя на Canvas» допускалась ТЗ только как отдельно протестированная; она не нужна ядру и снята из объёма первой версии.
2. **Фокус узла** — через недокументированные методы живого Canvas с проверкой возможностей и fallback (открыть заметку через публичный API или подсветить результат в навигаторе).
3. **TTG по умолчанию — только ссылки.** Онлайн-поиск — эксперимент с явным включением; `getSummary` не реализован (нет документированного формата и прав на тексты).
4. **Состояния**: стабильные английские `id`, русские названия как на TTG 2014 (Ослеплённый, Испуганный, Сбитый с ног…) и ссылки на страницы TTG.


## GM Cockpit: TTG Club 2014 и Lightkey (проверено 25.11.2026)

| Источник | Что проверено | Статус | Решение |
|---|---|---|---|
| `https://5e14.ttg.club/robots.txt` | HTTP 200: `Disallow: /api` (а также `/search`, `/creatures` и др.) для всех агентов | **VERIFIED** | Автоматические запросы к `/api` с 5e14 **не выполняются**. Прежний «экспериментальный» онлайн-поиск (`POST /api/v1/bestiary`) остаётся выключенным по умолчанию; для заклинаний онлайн-загрузки нет |
| `https://new.ttg.club/terms` | Личное некоммерческое использование разрешено; запрещены копирование «целиком или значительными частями» для публикации и «автоматический сбор содержимого в объёме, который мешает работе» | **VERIFIED** (текст прочитан) | Нет массового копирования и кэширования чужих текстов. Локальная библиотека содержит только то, что ввёл или вставил сам мастер |
| Условия именно для 5e14 | Отдельной страницы условий для 5e14 не найдено; применимы условия основного сайта | **UNVERIFIED** | Считать применимыми условия ttg.club; при сомнении — запросить разрешение у администрации |
| `github.com/TTG-Club/core-api` | README: Spring Boot 3.4, REST, JWT, PostgreSQL. Публичного описания API для сторонних клиентов нет. API нового сайта ≠ гарантированный API 5e14 | **UNVERIFIED** как публичный API | Не используется. Список репозиториев организации недоступен из окружения (GitHub API 403 вне сессионных репозиториев) |
| `5e14.ttg.club/sitemap.xml` | Страницы вида `/spells/<slug>` существуют | **VERIFIED** | Ссылки разбираются для идентификации (slug) и открытия в браузере |
| Lightkey External Control | Поиск по справке (lightkeyapp.com/help/excon): адрес cue копируется через External Control → Copy OSC Address; форма `/live/<Панель>/cue/<Cue>/activate`, для переключения глагол `activate` заменяется на `toggle`. Страница справки напрямую из окружения не открылась (404 по curl) | **PARTIAL** (по пересказу поисковика) | Адрес и глагол — настраиваемые поля. Порт по умолчанию 21600 — **UNVERIFIED**, обязательно сверить в Lightkey. `deactivate` и аргументы — не подтверждены документацией, поддерживается как «custom» |
| OSC 1.0 | Кодирование (выравнивание по 4 байта, type tags) | **VERIFIED** unit-тестами и приёмом реального UDP-пакета | Собственный минимальный кодер, без зависимостей |
| Lightkey на живом приложении | — | **NOT_RUN** | Нужны версия Lightkey и реальные cue для финального теста |

| D&D 5e SRD 5.1 | CC-BY-4.0, PDF `https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf` (403 стр., sha256 `2504d2a0…f1f0`, скачан 26.11.2026) | **VERIFIED**: структурный импорт (`scripts/srd/import-srd.mjs`) и независимая сверка эталонными значениями, списанными с текста PDF (`tests/unit/srd-reference.test.ts`); значения 1.1.0, внесённые по памяти, заменены | `data/srd51/srd51.json`, `src/domain/srd.ts`. Атрибуция: «This work includes material from the System Reference Document 5.1 by Wizards of the Coast LLC, CC-BY-4.0». Русские названия — общепринятая терминология |
