# Отчёт о тестировании Canvas Assist

Сгенерировано: 2026-10-18T03:06:24.631Z · коммит `43ca3c0` (рабочая копия с изменениями) · `node scripts/make-report.mjs`

## Сводка (формат §14.2)

```text
BUILD             PASS · main.js 199144 B (бюджет 204800 B) · v1.0.0
UNIT              PASS · 94/94 тестов · 1503 мс
INTEGRATION       PASS · 31/31 тестов · 1178 мс
REAL DESKTOP E2E  PASS · INFO 1, PASS 55, NOT_RUN 1 · Obsidian 1.14.4 · linux x64 (Xvfb) · 2026-10-18T03:03:16.073Z
MOBILE E2E        NOT_RUN · нет эмулятора iOS/Android; выполнена статическая проверка мобильной безопасности бандла
DATA INTEGRITY    PASS
SECURITY          PASS
PERFORMANCE       PASS · ход p95 3.645 мс (100 уч./200 эфф.) · поиск 500 узлов p95 0.548 мс · простой CPU 0% · +2 МиБ heap
LEGAL/TTG         VERIFIED (условия прочитаны 18.10.2026) · онлайн-endpoint 5e14 — UNVERIFIED как публичный API, выключен по умолчанию
KNOWN ISSUES      S1: 0 · S2: 0 · S3/S4: см. docs/limitations.md
ARTIFACTS         release/canvas-assist-<версия>.zip, release/SHA256SUMS.txt, tests/e2e/out/{results.json,results.md,screenshots/}, tests/perf/out/perf.json
```

Критерии приёмки, подтверждённые на реальном Obsidian desktop: **45 из 45**.
Мобильная платформа не проверялась на устройстве/эмуляторе, поэтому продукт **не** объявляется «полностью протестированным на всех платформах».

## Команды и окружение

```bash
npm ci
npm run check            # lint + typecheck + unit + integration + build + bundle gate
npm run test:perf
./scripts/fetch-e2e-deps.sh   # официальный Obsidian 1.14.4 (sha256) + Fantasy Statblocks 4.10.3
npm run release && CA_E2E_FROM_RELEASE=1 npm run test:e2e
node scripts/make-report.mjs
```

- Obsidian: 1.14.4 (`/opt/obs/squashfs-root/obsidian`), Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) obsidian/1.14.4 Chrome/150.0.7871.250 Electron/43.7.7 Safari/537.36
- ОС: linux x64, Node v22.22.0; окно 1440×900 (эталон «13-дюймовый ноутбук»), Xvfb, драйвер: Chrome DevTools Protocol (playwright-core connectOverCDP)
- Длительность E2E: 169 с
- Проверенный артефакт: `release/main.js` sha256 `0ffec34d3c217c9f79985afb059abc32107bc8bf8983fd86b6781c61bad64dd7` (сравните с release/SHA256SUMS.txt)

## Матрица AC-01…AC-45

| AC | Критерий | Реальный Obsidian | Шаги E2E | Автотесты без UI |
|---|---|---|---|---|
| AC-01 | Изоляция приключений A/B | PASS | AC-01 | integration/persistence |
| AC-02 | Несколько Canvas одного приключения | PASS | AC-02, TWO-TABS | — |
| AC-03 | Папки не создаются | PASS | AC-03+AC-43 | integration/persistence |
| AC-04 | Русский поиск | PASS | AC-04 | unit/canvas-search, perf |
| AC-05 | Типизация узлов | PASS | AC-05 | unit/canvas-search |
| AC-06 | Навигация/фокус и fallback | PASS | AC-06, AC-06-fallback | — |
| AC-07 | Внешний TTG и локальные параметры | PASS | AC-07, AC-40 | — |
| AC-08 | JSON-импорт | PASS | AC-08 | unit+integration/import |
| AC-09 | Частичный импорт | PASS | AC-09 | unit/import |
| AC-10 | Повторный импорт | PASS | AC-10 | unit+integration/import |
| AC-11 | Ошибочный JSON | PASS | AC-11 | unit+integration/import |
| AC-12 | Персональные ресурсы | PASS | AC-12a, AC-12b | — |
| AC-13 | Шаблон боя | PASS | AC-13 | unit/combat |
| AC-14 | Пять одинаковых монстров | PASS | AC-14 | unit/combat |
| AC-15 | Индивидуальная инициатива | PASS | AC-15+AC-17 | unit/combat |
| AC-16 | Общая инициатива | PASS | AC-16 | unit/combat |
| AC-17 | Равная инициатива | PASS | AC-15+AC-17 | unit/combat |
| AC-18 | Раунд | PASS | AC-18 | unit/combat |
| AC-19 | Цель против хода | PASS | AC-19+AC-20 | unit/combat |
| AC-20 | Ручной ввод урона | PASS | AC-19+AC-20 | unit/combat |
| AC-21 | Нулевые HP | PASS | AC-21 | unit/combat |
| AC-22 | «3 хода» | PASS | AC-22 | unit/effects |
| AC-23 | Событие источника | PASS | AC-23 | unit/effects |
| AC-24 | Два одинаковых состояния | PASS | AC-24 | unit/effects |
| AC-25 | Undo эффекта | PASS | AC-25 | unit/effects |
| AC-26 | Ручная правка эффекта | PASS | AC-26 | unit/effects |
| AC-27 | Концентрация | PASS | AC-27 | unit/effects |
| AC-28 | Выборочный отдых | PASS | AC-28+AC-29 | unit/rest-history |
| AC-29 | Неизвестный ресурс | PASS | AC-28+AC-29 | unit/rest-history |
| AC-30 | Переключение партии | PASS | AC-30 | unit/rest-history |
| AC-31 | Перезапуск | PASS | AC-31, UNDO-AFTER-RESTART | integration/persistence |
| AC-32 | Повтор action | PASS | AC-32 | unit/combat, integration/schema |
| AC-33 | Сбой записи | PASS | AC-33 | integration/persistence |
| AC-34 | Повреждённый JSON | PASS | AC-34 | integration/persistence |
| AC-35 | Конкурентная запись | PASS | AC-35 | integration/persistence |
| AC-36 | Переименование | PASS | AC-36, RENAME-CLOSED, COPY-FORK | integration/persistence |
| AC-37 | Горячие клавиши | PASS | AC-37, AC-37b | unit/services |
| AC-38 | Сложный Canvas | PASS | AC-38 | — |
| AC-39 | Выключение плагина | PASS | AC-39 | — |
| AC-40 | Офлайн | PASS | AC-40 | — |
| AC-41 | Темы и ширины | PASS | AC-41 | — |
| AC-42 | Нет утечек | PASS | AC-42 | — |
| AC-43 | Миграция | PASS | AC-03+AC-43 | integration/persistence, integration/schema |
| AC-44 | Безопасность | PASS | AC-44-import | unit/canvas-search, unit/import, unit/services |
| AC-45 | Удаление оригинала | PASS | AC-45, AC-45-nav | — |

## Все шаги E2E

| ID | Проверка | Статус | мс | Evidence (сокращённо) |
|---|---|---|---|---|
| ENV | Окружение | INFO |  | {"pluginFrom":"release","pluginMainJsSha256":"0ffec34d3c217c9f79985afb059abc32107bc8bf8983fd86b6781c61bad64dd7","obsidian":"1.14.4","binary":"/opt/obs/squashfs-root/obsidian","os":"linux x64","node":"v22.22.0","userAgent |
| BOOT | Плагин загружается в реальном Obsidian | PASS | 509 | {"loaded":true,"version":"1.0.0","restricted":false} |
| AC-03+AC-43 | Подключение приключения А: миграция v1→v2 с резервной копией, без новых папок | PASS | 1718 | {"backup":".canvas-assist-state.backup-v1-2026-10-18T03-03-22-117Z.json","characters":["adv-A-pc-alex"]} |
| REG-B | Подключение приключения Б (то же имя персонажа, другой ID) | PASS | 1704 | {"alex":{"id":"adv-B-pc-alex","name":"Алекс","notePath":"Elements/Персонажи/Алекс.md","classes":[],"hp":{"current":7,"max":12,"temporary":0},"ac":13,"initiativeModifier":null,"speedFeet":null,"spellSlots":{},"hitDice":[] |
| AC-01 | Изоляция A/B: урон Алексу в A не меняет ни байта в B; автопереключение | PASS | 11911 | {"aHp":12,"bHp":7,"bSha":"c2173ee742e40218ed265f3f5c007b0ac8f6775486160fc995cf0bcd6beda28a"} |
| AC-02 | Несколько Canvas одного приключения: общее состояние, навигатор перестраивается | PASS | 3366 | {"nodes1":["node-02","node-01","group-01","group-loot","node-03"],"nodes2":["node-04","node-05"]} |
| AC-04 | Русский поиск: гоб / ГоБ / ё=е, частичные совпадения | PASS | 2465 | {"гоб":"n-gob","ГоБ":"n-gob","елкин":"n-star","шепот":"n-hb","таверна еж":"n-dup1"} |
| AC-37 | Горячие клавиши не срабатывают при вводе текста | PASS | 359 | {"typed":"таверна ежD"} |
| AC-06 | Навигация: фокус и выделение узла через проверенный Canvas Adapter | PASS | 812 | {"selection":["n-star"],"centered":{"cx":500,"cy":115,"tx":500,"ty":115}} |
| AC-06-fallback | Навигация при недоступном Canvas API: запасной путь не ломает Canvas | PASS | 1640 | {"tabsBefore":0,"tabsAfter":1,"canvasNodes":15} |
| AC-05 | Типизация: группа NPC → NPC; ручной override; Ignore исключается | PASS | 2451 | {"categories":{"g-npc":"npc","g-loot":"loot","g-plot":"plot","g-hb":"homebrew","n-gob":"npc","n-star":"npc","n-missing":"npc","n-loot1":"loot","n-dup1":"plot","n-dup2":"plot","n-plot":"plot","n-hb":"homebrew","n-link":"n |
| AC-45-nav | Ссылка на отсутствующую заметку помечена «источник недоступен» | PASS | 6 | {"className":"ca-nav-item is-missing"} |
| AC-11 | Ошибочный JSON: сообщение с полем; ничего в хранилище не изменилось | PASS | 1876 | {"fatal":"Синтаксическая ошибка JSON: Expected double-quoted property name in JSON at position 69 (line 1 column 70)","errors":["$.name: имя обязательно","$.hitPoints.max: значение 0 вне диапазона 1…10000","$.hitPoints.c |
| AC-08 | Импорт JSON создаёт Markdown в Elements/Персонажи со стабильным ID | PASS | 1234 | {"reason":"Заметка с таким именем уже есть, но не связана по ID. Выберите: обновить её или создать новую.","report":"ОтчётМира: создан — Elements/Персонажи/Мира 2.md","notePreview":"---\ncanvasAssistId: pc-mira-import\n- |
| AC-09 | Частичный лист: неизвестное остаётся пустым | PASS | 990 | {"character":{"id":"pc-01a14cf730b73ec49bff3f","name":"Бор Неполный","notePath":"Elements/Персонажи/Бор Неполный.md","classes":[{"name":"Плут","level":2}],"hp":{"current":0,"max":null,"temporary":0},"ac":14,"initiativeMo |
| AC-10 | Повторный импорт (повышение уровня): максимум меняется, текущие HP и ячейки сохраняются | PASS | 1000 | {"diff":"Постоянные значения листа:Класс: Волшебник 3 → Волшебник 4Максимум хитов: 20 → 26Ячейки 2 ур. (максимум): 2 → 3Кости хитов d6 (всего): 3 → 4Текущие ресурсы (сохраняются без изменений):Текущие хиты: остаётся 9 (в |
| AC-44-import | HTML/JS из JSON не исполняется и не рендерится | PASS | 3726 | {"warnings":4,"file":"Хакер img src=x onerror=alert(1).md","dom":{"scripts":0,"imgs":0,"bold":0,"text":"Хакер img src=x onerror=alert(1)Свойстваpc-01a14cf73885bcb8775123Добавить свойствоcanvasAssistId: pc-01a14cf73885bcb |
| AC-12a | Персональные ресурсы: временные хиты, ячейки, свободный счётчик сохраняются | PASS | 2063 | {"hp":{"current":9,"max":26,"temporary":3},"slot1":{"current":1,"max":4},"counter":{"id":"ctr-01a14cf749e8f6434c588a","name":"Ки","current":2,"max":null,"recovery":"manual"}} |
| AC-13 | Шаблон боя запускается дважды: новые ID, шаблон неизменен | PASS | 2707 | {"first":{"enc":"enc-01a14cf7521b4206d3ef71","cmb":["cmb-01a14cf7521b1c203f7126","cmb-01a14cf7521b4654dd6f47","cmb-01a14cf7521b6d2d3d7ed5","cmb-01a14cf7521bd3e914ae91","cmb-01a14cf7521c6e1af61a0c","cmb-01a14cf7521c049455 |
| AC-14 | Пять одинаковых монстров: номера и независимые HP | PASS | 21 | {"names":["Алекс","Мира","Бор Неполный","Хакер <img src=x onerror=alert(1)>","Гоблин 1","Гоблин 2","Гоблин 3","Гоблин 4","Гоблин 5"]} |
| AC-15+AC-17 | Индивидуальная инициатива и стабильный порядок при равенстве | PASS | 4571 | {"order":["Гоблин 2","Гоблин 5","Алекс","Мира","Гоблин 3","Гоблин 4","Гоблин 1","Бор Неполный","Хакер <img src=x onerror=alert(1)>"],"swapped":["Гоблин 2","Гоблин 5","Мира","Алекс","Гоблин 3","Гоблин 4","Гоблин 1","Бор Н |
| AC-16 | Общая инициатива группы: общий ход, раздельные HP | PASS | 1019 | {"group":["Гоблин 1","Гоблин 4"]} |
| AC-18 | Раунд: после последнего «Next» +1 ровно один раз; «Previous» возвращает | PASS | 3287 | {"slots":8,"lastActive":"Хакер <img src=x onerror=alert(1)> (1)"} |
| AC-19+AC-20 | Shift+D по выбранной цели не меняет активного; число вводится вручную | PASS | 863 | {"active":"Гоблин 2 (18)"} |
| AC-21 | Нулевые HP: участник остаётся, эффект не исчезает | PASS | 1404 | {"hp":{"current":0,"max":7,"temporary":0}} |
| AC-22 | «3 конца собственных ходов» при наложении в чужой ход | PASS | 7523 | {"history":[{"end":1,"remaining":2},{"end":2,"remaining":1},{"end":3,"remaining":0}],"effectId":"eff-01a14cf785fe01f8e622d5"} |
| AC-25 | Undo возвращает истёкший эффект, Redo снова снимает | PASS | 693 | {"restored":{"kind":"turns","ownerCombatantId":"cmb-01a14cf75698e4bcac500a","phase":"end","remaining":1}} |
| AC-23 | «До начала следующего хода источника» — на turn-start источника | PASS | 3691 | {"source":"Мира","roundStartPassedBeforeSourceTurn":true} |
| AC-24 | Два одинаковых состояния от разных источников: снятие одного не снимает второе | PASS | 1919 | {"pill":[{"text":"Испуганный ×2 · ∞, ∞","title":"Испуганный: Гоблин 2 (∞)\nИспуганный: Гоблин 5 (∞)"}],"remainingSource":"Гоблин 5"} |
| AC-26 | Ручная правка эффекта (продление) не меняет историю других | PASS | 461 | {"duration":{"kind":"rounds","phase":"end","remaining":2},"kinds":["manual","turns","until-turn","rounds","game-time"]} |
| AC-27 | Концентрация: связь эффект↔источник; снятие без проверки правил | PASS | 2444 | {"concentration":"Концентрация: Удержание личности","linked":"Парализованный"} |
| AC-07 | TTG: sourceUrl открывает правильный справочник; локальные параметры без сети | PASS | 998 | {"opened":["https://5e14.ttg.club/bestiary/goblin"],"stats":["Хиты7/7","КД—","Иниц.3"]} |
| AC-38 | Сложный Canvas: файлы .canvas не изменены плагином (неизвестные поля целы) | PASS | 10 | {"pluginCanvasWrites":0,"pluginStateWrites":93,"obsidianOwnCanvasRewrites":["Приключение А/Холсты/01.canvas","Приключение Б/Холсты/01.canvas","Приключение Б/Холсты/02.canvas","Приключение А/Холсты/02.canvas","Приключение |
| AC-37b | Редактирование текстового узла Canvas: Shift+Space и Shift+F не меняют бой | PASS | 4782 | {"editing":{"isEditing":true,"focus":"IFRAME","inNode":true}} |
| AC-30 | Переключение партии: бой не переписывается молча | PASS | 870 | {"parties":["Без партии","Основная","Партия 2"]} |
| AC-32 | Повтор actionId не удваивает урон и не увеличивает раунд (реальное хранилище) | PASS | 50 | {"hp0":7,"hp":6,"a":true,"bDup":true,"n1":true,"n2dup":true,"sameSlot":true,"round0":5,"r1":5,"r2":5} |
| AC-31 | Аварийное завершение после подтверждённого действия → всё восстановлено | PASS | 2787 | {"round":5,"history":81,"revision":96} |
| AC-12b | Ресурсы отображаются после перезапуска | PASS | 399 | {"temp":"3"} |
| UNDO-AFTER-RESTART | Undo/Redo после перезапуска | PASS | 747 | {"label":"Следующий ход"} |
| AC-33 | Сбой записи: нет ложного «сохранено» | PASS | 418 | {"ok":false,"error":"Не сохранено: EIO: simulated disk failure","label":"НЕ сохранено","hp0":7,"hp1":7} |
| AC-35 | Конкурентная запись: внешнее изменение → конфликт версий, без тихой перезаписи | PASS | 1188 | {"localCopy":"Приключение А/.canvas-assist-state.conflict-local-2026-10-18T03-04-39-657Z.json"} |
| AC-34 | Повреждённый JSON: режим только чтения, оригинал сохранён, понятное сообщение | PASS | 1831 | {"message":"Файл состояния повреждён (некорректный JSON: Expected double-quoted property name in JSON at position 45 (line 1 column 46)). Работа в режиме только чтения. Оригинал не изменён, копия: Приключение Б/.canvas-a |
| AC-45 | Удаление оригинала: «источник недоступен», бой восстановим | PASS | 3308 | {"warn":"лист недоступен"} |
| AC-36 | Переименование корня приключения и заметки: пути обновлены, новый PC не создан | PASS | 4988 | {"registry":[{"adventureId":"adv-A","rootPath":"Приключение А (переим.)","name":"Приключение А (переим.)"},{"adventureId":"adv-B","rootPath":"Приключение Б","name":"Приключение Б"}]} |
| AC-28+AC-29 | Выборочный долгий отдых; ручной счётчик не восстанавливается | PASS | 2249 | {"preview":"Предпросмотр: до → послеМираХиты: 9 → 26Ячейки 1 ур.: 1 → 4Ячейки 2 ур.: 2 → 3Кости хитов d6: 2 → 4"} |
| AC-41 | Светлая/тёмная темы, маленькое окно: читаемость и отсутствие обрезания | PASS | 5620 | {"moonstone":{"minContrast":6.04,"worst":[{"r":6.041230482584354,"cls":"ca-chip-hp ca-zero","text":"♥ 0/?","color":"color(srgb 0.679608 0.17451 0.234902)","bg":"rgb(246, 246, 246)"},{"r":6.041230482584354,"cls":"ca-chip- |
| AC-42 | Нет утечек: 100 открытий/закрытий панелей | PASS | 11300 | {"before":{"dom":963,"listeners":1},"afterPanelsAndNav":{"dom":965,"listeners":1},"after":{"dom":963,"listeners":1,"modals":0}} |
| PERF | Производительность в реальном приложении | PASS | 18635 | {"searchP50":0.2,"searchP95":0.8,"nextTurnWithWriteP50":33.4,"nextTurnWithWriteP95":38.3,"cloneP95":2.2,"stateBytes":208310,"historyBytes":81350,"idle":{"taskSecondsPer10s":0,"scriptSeconds":0,"cpuPercentOfOneCore":0,"ne |
| MEM | Дополнительная память плагина (heap с плагином / без) | PASS | 4451 | {"withPluginMiB":23.6,"withoutMiB":21.6,"deltaMiB":2} |
| AC-39 | Выключение плагина: Canvas и Markdown читаются штатно | PASS | 3719 | {"overlays":0,"nodes":5,"md":"markdown"} |
| TWO-TABS | Два Canvas одного приключения в разных вкладках: общее состояние без конфликтов | PASS | 2839 | {"roundBefore":1,"roundAfter":1,"shown":"Массовка 15 (85)","overlays":{"total":2,"active":1}} |
| CONSOLE | Нет ошибок плагина в консоли за всю сессию | PASS | 0 | {"consoleMessages":0} |
| RENAME-CLOSED | Переименование корня при закрытом Obsidian: безопасное переподключение по adventureId | PASS | 1996 | {"registry":[{"adventureId":"adv-A","rootPath":"Приключение А","name":"Приключение А"},{"adventureId":"adv-B","rootPath":"Приключение Б (диск)","name":"Приключение Б (диск)"}]} |
| COPY-FORK | Копия папки приключения с тем же ID: не смешивается, явное разделение | PASS | 2966 | {"forkedId":"adv-01a14cf8ec3249c7c52ff5","characters":4} |
| AC-40 | Офлайн: старт и бой без сети/TTG/сторонних плагинов | PASS | 4917 | {"stats":["Хиты4/7","КД15","Иниц.—"],"pluginHttpCalls":0,"obsidianOwnRequests":["https://5e14.ttg.club/"],"ttgRequestsByCanvasLinkEmbed":[{"url":"https://5e14.ttg.club/","initiator":"script"}]} |
| COMPAT-FSB | Совместимость: реальный Fantasy Statblocks 4.10.3 + адаптер под флагом | PASS | 4750 | {"fsb":{"version":"4.10.3","resolved":true,"goblin":true},"prefilled":{"hp":"7","ac":"15"},"card":"Fantasy Statblocks: КД 15, хиты 7, скорость 30 ft.УронЛечениеВрем. хитыЭффектВременный КД в боюПусто — КД листа/карточки" |
| MOBILE | Мобильный E2E (iOS/Android) | NOT_RUN |  | Нет эмулятора Android/iOS с Obsidian в окружении. Выполнена статическая проверка отсутствия Node/Electron импортов (scripts/check-bundle.mjs). |

## Производительность

Методика: unit-бенчмарки (Node, `tests/perf`) — 200 повторов «следующего хода», 50 поисков на размер; в реальном приложении — `performance.now()` вокруг ввода в поиск навигатора, `Performance.getMetrics` (TaskDuration) за 10 с простоя при закрытых панелях, heap после принудительной GC с плагином и без. Цифры ниже — фактические измерения этого прогона на Linux CI-машине; на macOS M1 не измерялось.

```json
{
  "unitBench": {
    "nextTurn": {
      "p50": 2.263,
      "p95": 3.645,
      "serializeP95": 2.218,
      "stateBytes": 363694,
      "historyEntries": 100
    },
    "search": {
      "100": {
        "buildMs": 6.83,
        "searchP50": 0.072,
        "searchP95": 0.468
      },
      "500": {
        "buildMs": 4.97,
        "searchP50": 0.266,
        "searchP95": 0.548
      },
      "2000": {
        "buildMs": 24.7,
        "searchP50": 1.572,
        "searchP95": 2.424
      }
    },
    "typicalState": {
      "bytes": 115260,
      "historyEntries": 100,
      "historyBytes": 90673
    },
    "characters": {
      "1": {
        "damageAllMs": 0.15
      },
      "10": {
        "damageAllMs": 0.99
      },
      "100": {
        "damageAllMs": 67.53
      }
    }
  },
  "inApp": {
    "searchP50": 0.2,
    "searchP95": 0.8,
    "nextTurnWithWriteP50": 33.4,
    "nextTurnWithWriteP95": 38.3,
    "cloneP95": 2.2,
    "stateBytes": 208310,
    "historyBytes": 81350,
    "idle": {
      "taskSecondsPer10s": 0,
      "scriptSeconds": 0,
      "cpuPercentOfOneCore": 0,
      "networkRequestsInIdle": 0,
      "heapMiB": 53.8
    }
  },
  "memory": {
    "withPluginMiB": 23.6,
    "withoutMiB": 21.6,
    "deltaMiB": 2
  }
}
```

Отклонения: «следующий ход с записью на диск» в приложении на 100 участников/200 эффектов — это редьюсер + сериализация + запись через DataAdapter; UI показывает «сохранение…» до завершения и не подтверждает действие раньше записи.

## Скриншоты

- [theme-moonstone-1440](evidence/screenshots/theme-moonstone-1440.png)
- [theme-obsidian-1440](evidence/screenshots/theme-obsidian-1440.png)
- [theme-moonstone-820](evidence/screenshots/theme-moonstone-820.png)
- [theme-obsidian-820](evidence/screenshots/theme-obsidian-820.png)
- [ac33-not-saved](evidence/screenshots/ac33-not-saved.png)
- [ac34-recovery](evidence/screenshots/ac34-recovery.png)
- [ac35-conflict](evidence/screenshots/ac35-conflict.png)
- [ac39-disabled](evidence/screenshots/ac39-disabled.png)
- [ac40-offline](evidence/screenshots/ac40-offline.png)
- [compat-fsb-card](evidence/screenshots/compat-fsb-card.png)
- [final-main](evidence/screenshots/final-main.png)

Машинные результаты: [e2e-results.json](evidence/e2e-results.json), [perf.json](evidence/perf.json).

