# Матрица совместимости

| Компонент | Версия | Статус | Evidence |
|---|---|---|---|
| Obsidian desktop, Linux x64 | 1.14.4 (Electron 43.7.7) | **PASS** | `tests/e2e/out/results.json`, `docs/test-report.md` |
| Obsidian desktop, macOS | — | NOT_RUN | раннер готов: `OBSIDIAN_BIN=/Applications/Obsidian.app/Contents/MacOS/Obsidian npm run test:e2e` |
| Obsidian desktop, Windows | — | NOT_RUN | раннер готов (укажите `OBSIDIAN_BIN`) |
| Obsidian mobile iOS / Android | — | NOT_RUN | статическая проверка бандла PASS (`scripts/check-bundle.mjs`) |
| Минимальная версия (`minAppVersion`) | 1.7.2 | не проверялась | используемые API: `Vault.process`, `DataAdapter.process`, `FileManager.processFrontMatter`, `requestUrl` |
| Темы | «Светлая» (moonstone), «Тёмная» (obsidian) | **PASS** | контраст ≥ 4.5:1, без обрезания на 1440 и 820 px (AC-41) |
| Fantasy Statblocks | 4.10.3 | **PASS** (вместе в одном хранилище, адаптер под флагом) | E2E `COMPAT-FSB` |
| Initiative Tracker, Leaflet, Relations, Calendarium, Dice Roller | — | не требуются | плагин работает без них (AC-40) |
| Без сети | — | **PASS** | E2E `AC-40` (прокси-«чёрная дыра», 0 HTTP-вызовов плагина) |
| Node.js для сборки | 20.x, 22.x | 22.22 проверено локально; CI-матрица 20/22 | `.github/workflows/ci.yml` |
