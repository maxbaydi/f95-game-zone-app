# Режимы пересканирования библиотеки

**Статус:** active
**Модули:** src/main/libraryScanRequest.js, src/main/libraryReset.js, src/main/scanCandidateImportPolicy.js, src/main/importMetadata.js (mergeRefreshedGameMetadata), src/main/libraryDuplicates.js (summarizeDuplicateCleanup), src/main.js (обработчик `scan-library`), src/App.jsx (rescanLibrary, меню Rescan Library), src/core/library/LibraryResetModal.jsx
**Тесты:** test/libraryScanRequest.test.js, test/libraryReset.test.js, test/scanCandidateImportPolicy.test.js, test/importMetadata.test.js, test/libraryDuplicates.test.js; `node --test test/libraryScanRequest.test.js test/libraryReset.test.js test/scanCandidateImportPolicy.test.js test/importMetadata.test.js test/libraryDuplicates.test.js`

## Назначение
Раньше было два действия: обычный рескан (только новые папки) и «Reset Cache & Rescan», который чистил историю сканера, но уже известные игры без уверенного совпадения с каталогом откладывал «на проверку» и не обновлял. Не было ни способа обновить сведения об установленных играх без чистки, ни безопасного способа очистить локальную библиотеку и собрать её заново. Теперь есть четыре режима с понятными гарантиями.

## Для пользователя
Кнопка **Rescan Library** внизу окна открывает меню:

- **Find New Games** — быстрый проход: добавляет игры из папок, которых библиотека ещё не знает. Ничего не меняет у существующих записей.
- **Refresh Installed Games** — проверяет каждую папку заново: обновляет версию, исполняемый файл, движок, находит новые игры, чистит дубликаты и сообщает, у скольких игр пропали файлы. Название и автора игры, уже сопоставленной с каталогом или исправленной вручную, не портит.
- **Refresh Cached Screenshots** — докачивает скриншоты.
- **Reset Scan Cache & Rescan** — то же, что Refresh, но сначала стирает историю сканирований, кандидатов (Scan Hub) и кэш версий из живых тем (`library_live_versions`), чтобы следующая проверка обновлений прошла с нуля.
- **Rebuild Library From Scratch…** — окно подтверждения с чек-боксом. Локальный индекс библиотеки очищается (записи, версии, кэш обложек, избранное, ссылки на темы), перед этим сохраняется резервная копия базы, затем папки сканируются с нуля. Файлы игр, сохранения и локальные бэкапы сохранений не трогаются. Игры из облачной библиотеки вернутся как «Not installed» после следующей синхронизации.

Меню открывается над кнопкой внутри окна (см. library-toolbar-and-menus.md). Те же действия вынесены в **Scan Hub** (блок «Rescan and reset»: Refresh installed games, Reset cache & rescan, Rebuild library from scratch…), а кнопка **Find New Games** в его шапке запускает быстрый проход.

По завершении внизу показывается итог: сколько добавлено (и сколько из них без совпадения с каталогом), сколько обновлено, сколько нужно проверить, сколько игр с отсутствующими файлами. Папки, которые явно являются играми, но не нашлись в каталоге, добавляются сразу с бейджем «Not matched» (привязка — library-catalog-link.md). Если есть папки для проверки — кнопка **Open Scan Hub**; если есть игры без файлов — предупреждение с кнопкой **Show them**; если объединены дубликаты — «Merged N duplicate entries» с кнопкой **Details**.

Типичные ситуации:
- «Rebuilding the library needs an explicit confirmation» — режим запущен без подтверждения; используйте меню.
- «The library could not be backed up, so nothing was reset» — не удалось записать резервную копию; библиотека не изменена, проверьте место на диске.

## Как это работает
1. Рендерер вызывает `scanLibrary({ mode, confirm })`. `normalizeLibraryScanRequest` принимает и старые флаги `{ resetCache, forceRescan }`: `resetCache` → `reset_cache`, `forceRescan` → `refresh`. Явный `mode` важнее флагов; неизвестный режим = `incremental`.
2. `reset_library` требует `confirm === true` иначе IPC возвращает `LIBRARY_RESET_NOT_CONFIRMED`. `resetLibraryIndex` делает `VACUUM INTO` в `backups/library_index/library-<дата>.db` (при неудаче — копия файла), затем в одной транзакции удаляет таблицы из `LIBRARY_RESET_TABLES` (mappings, save_profiles, save_sync_state, banners, previews, scan_candidates, scan_jobs, versions, library_live_versions, games) и удаляет **все** числовые папки `cache/images/<id>` (не только текущих записей: `record_id` после очистки снова начинается с 1, и старая обложка могла бы достаться новой игре). Каталог метаданных и F95, `scan_sources`, `emulators`, `tags` и очередь облачных удалений не трогаются. Рендерер получает событие `library-reset` и очищает список, очередь кандидатов, задания сканера и результат последней живой проверки; главный процесс сбрасывает состояние живой проверки (`forget()`), и уже идущий прогон перестаёт записывать результаты под старыми id.
3. Сканер запускается с `forceRescan` для всех режимов кроме `incremental`. Для известных папок (индекс путей библиотеки) `splitAutoImportableScanGames` помечает кандидата `refreshExisting` и импортирует его независимо от уверенности совпадения с каталогом. Новые папки импортируются при `matchStatus = matched`, а без совпадения — если это не архив и `detectionScore >= 40` (помечаются `importUnmatched`); остальные ждут проверки в Scan Hub.
4. При импорте в существующую запись `mergeRefreshedGameMetadata` берёт название/автора/движок сканера только при наличии `atlasId` (уверенное совпадение или выбор пользователя); иначе сохраняет ранее записанные значения и заменяет только «Unknown». Версия берётся из папки, а если папка версию не выдаёт — остаётся записанная для этой же папки.
5. После импорта запускается чистка дубликатов по одинаковому пути и подсчёт состояний присутствия (`countLibraryInstallStates`), результат уходит в ответ и в строку прогресса. `summarizeDuplicateCleanup` превращает результат чистки в `duplicateMerges` (какая запись оставлена, какие объединены или не объединены). В любом исходе (нечего импортировать, отмена, ошибка источников) главный процесс шлёт `import-complete` и `games-library-synced`, чтобы список в окне перезагрузился, а не остался пустым после очистки. Если часть источников упала, но игры из остальных импортированы, ответ — `success: true, partialFailure: true, error: <текст>`; окно показывает предупреждение вместо «The library could not be rebuilt».

## Контракт
IPC `scan-library` вход: `{ mode?: "incremental" | "refresh" | "reset_cache" | "reset_library", confirm?: boolean, resetCache?: boolean, forceRescan?: boolean }`.

Ответ: `{ success, mode, scanned, imported, importedUnmatched, refreshed, reviewQueued, warningsCount, errorsCount, duplicateRecordsRemoved, duplicateMerges: [{ gamePath, keptRecordId, keptTitle, mergedTitles, failedTitles }], installedCount, missingCount, notInstalledCount, libraryReset: { clearedGames, clearedVersions, backupPath } | null, cancelled?, error?, errorCode? }`. `importedUnmatched` входит в `imported`.

Коды ошибок: `LIBRARY_RESET_NOT_CONFIRMED`, `LIBRARY_RESET_BACKUP_FAILED`, `LIBRARY_RESET_FAILED`, `SCAN_ALREADY_RUNNING`, `SCAN_CACHE_RESET_FAILED`.

Событие `library-reset` → рендерер: `{ clearedGames, clearedVersions, backupPath }`. Событие `scan-cache-reset` → `{ clearedCandidates, clearedJobs }`. Ответ `scan-library` дополнен полями `partialFailure`, `error` (текст при частичном сбое).

Резервные копии: `<userData>/backups/library_index/library-YYYYMMDD-HHmmss.db`; не удаляются автоматически, восстанавливаются из настроек (library-backups.md). Сброс очищает и `library_live_versions`.

## Граничные случаи и ошибки
- Нет включённых папок сканирования → `No enabled scan sources configured`, ничего не меняется (при `reset_library` индекс уже очищен и резервная копия сохранена).
- Отмена во время скана → `cancelled: true`; уже импортированные записи остаются.
- Сбой любого `DELETE` при сбросе → откат транзакции, библиотека не изменена, `LIBRARY_RESET_FAILED`.
- Сбой резервного копирования → сброс не начинается.
- Известная папка, у которой сканер выдал «Unknown» название и версию → запись сохраняет прежние значения.
- Папка, которая существует, но не вошла ни в одну включённую папку сканирования, при `reset_library` в библиотеку не вернётся — об этом предупреждает чек-бокс.
- Облако: после `reset_library` каталог аккаунта не изменяется; локальные удаления не ставятся в очередь облачных удалений (это восстановление индекса, а не удаление игр).

## Проверка
Вручную:
1. Меню Rescan Library → Refresh Installed Games: в итоге «N installed game(s) refreshed», версии и exec-пути в деталях актуальны, запись с обложкой из каталога не переименовалась в имя папки.
2. Rebuild Library From Scratch…: кнопка неактивна до чек-бокса; после подтверждения список пустеет, игры появляются заново по мере скана, в `backups/library_index` появился файл `.db`.
3. Запустить `reset_library` без подтверждения через DevTools → ответ `LIBRARY_RESET_NOT_CONFIRMED`.

Тесты: `libraryScanRequest.test.js` (нормализация режимов, совместимость флагов, подтверждение), `libraryReset.test.js` (очистка таблиц, сохранение каталога, резервная копия — реальная SQLite, откат при сбое, отказ без бэкапа), `scanCandidateImportPolicy.test.js` (обновление известных папок), `importMetadata.test.js` (слияние метаданных при обновлении). В браузере проверены меню, окно подтверждения и вызов `scanLibrary({ mode: "reset_library", confirm: true })`.

## История изменений
- 2026-09-29 — действия сброса в Scan Hub; кнопка Scan Hub больше не передаёт событие клика в IPC (вызов падал); `reset_cache` чистит и кэш живых версий; полная очистка папок обложек при rebuild; `import-complete`/`games-library-synced` во всех исходах; частичный сбой источников не считается провалом rebuild; живая проверка не пишет под старыми id после очистки.
- 2026-09-27 — добавлены режимы `refresh` и `reset_library`, обновление известных папок без «проверки», модальное окно сброса, итоговая сводка с количеством игр без файлов.
- 2026-09-27 — автоимпорт явных игр без совпадения (`importedUnmatched`), сводка объединённых дубликатов (`duplicateMerges`), меню внутри окна, кнопки Open Scan Hub / Show them / Details в итоге.
