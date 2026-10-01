# Резервные копии библиотеки

**Статус:** active
**Модули:** src/main/libraryBackups.js, src/main/libraryReset.js (backupDatabaseFile, LIBRARY_RESET_TABLES, LIBRARY_BACKUP_DIRECTORY_NAME), src/main/libraryMaintenanceIpc.js, src/core/settings/LibrarySettings.jsx (LibraryBackupsCard), src/core/library/LibraryResetModal.jsx
**Тесты:** test/libraryBackups.test.js, test/libraryReset.test.js; `node --test test/libraryBackups.test.js test/libraryReset.test.js`

## Назначение
«Rebuild Library From Scratch» сохраняет копию базы перед очисткой, но вернуть её раньше мог только разработчик. Теперь копии видны в настройках, их можно создать вручную и восстановить одной кнопкой; перед восстановлением текущая библиотека тоже сохраняется, так что шаг обратим.

## Для пользователя
1. Откройте **Settings → Library & folders → Library backups**.
2. **Back up now** — сохранить текущую библиотеку (список игр, версии, избранное, ссылки на темы).
3. В списке — дата, число игр и размер каждой копии. **Restore…** → подтверждение: текущая библиотека сначала сохраняется, затем заменяется выбранной копией.
4. После восстановления список игр перезагружается, баннеры скачиваются заново в фоне.

Что не входит в копию: файлы игр, сохранения, каталог метаданных и F95, папки сканирования. Они не меняются ни при создании, ни при восстановлении копии.

Типичные ошибки:
- «Wait for the library scan to finish» — во время сканирования восстановление недоступно.
- «This backup could not be restored. Your library was not changed.» — файл повреждён; библиотека осталась прежней.
- «Your current library could not be backed up first…» — нет места на диске, восстановление не начиналось.

## Как это работает
1. Копии — файлы `*.db` в `<userData>/backups/library_index` (`backupDatabaseFile`: `VACUUM INTO`, при неудаче копия файла).
2. `listLibraryBackups` читает папку, дату берёт из имени `library-YYYYMMDD-HHmmss.db` (локальное время), иначе из времени файла; число игр — через отдельное соединение только для чтения (`SELECT COUNT(*) FROM games`), `null`, если файл не читается. Сортировка — новые сверху.
3. `restoreLibraryBackup`:
   1. путь должен быть файлом прямо в папке копий (`isPathInsideLibraryBackups`, без `..` и подпапок) и существовать;
   2. страховочная копия текущей базы;
   3. `ATTACH DATABASE ? AS restore_src`, чтение списка таблиц и колонок **до** удаления — не-SQLite файл отваливается здесь;
   4. одна транзакция: `DELETE` всех таблиц `LIBRARY_RESET_TABLES` (сначала дочерние), затем `INSERT … SELECT` только общих колонок в обратном порядке; таблицы, которых нет в копии, дают 0;
   5. `COMMIT`, всегда `DETACH` (и после `ROLLBACK`);
   6. кэш картинок: папки `cache/images/<id>` записей, которые после восстановления стали другой игрой (другие title+creator), удаляются; строки `banners`/`previews` на несуществующие файлы убираются — карточка берёт баннер с сайта, пока он скачивается заново.
4. IPC после успеха шлёт `library-reset` (рендерер очищает список), затем `games-library-synced` (перезагрузка) и в фоне последовательно скачивает баннеры записей с `f95_id` (`downloadImages(…, true, false, "0", false)`), каждая — `game-updated`.
5. `LIBRARY_RESET_TABLES` включает `library_live_versions` (перед `games`).

## Контракт
| IPC | Вход | Результат |
|-----|------|-----------|
| `list-library-backups` | — | `[{ path, fileName, createdAt (ISO), sizeBytes, gameCount \| null }]` |
| `create-library-backup` | — | `{ success, backupPath }` / `{ success:false, error }` |
| `restore-library-backup` | `{ backupPath }` | `{ success, restoredGames, restored: { [table]: count } }` / `{ success:false, code, error }` |

Модуль: `restoreLibraryBackup({ appPaths, db, backupPath, backupDatabase?, now?, logger? }) → { success, safetyBackupPath, restored, recordIds, removedImageDirectories }`.
Коды: `LIBRARY_BACKUP_OUTSIDE_FOLDER`, `LIBRARY_BACKUP_NOT_FOUND`, `LIBRARY_RESTORE_BACKUP_FAILED`, `LIBRARY_RESTORE_FAILED`, `LIBRARY_BUSY`, `INVALID_INPUT`. Лог-префикс `[library.backups]`. Копии не удаляются автоматически.

## Граничные случаи и ошибки
- Копия старой версии приложения (нет колонок/таблиц) → переносятся общие колонки, недостающие получают значения по умолчанию.
- Файл не SQLite / без таблицы `games` → `LIBRARY_RESTORE_FAILED`, библиотека не изменена, страховочная копия остаётся.
- Файл вне папки копий или путь с `..` → отказ без обращения к базе.
- Во время сканирования → `LIBRARY_BUSY`.
- Нет сети → восстановление завершается, баннеры появятся позже (скачивание в фоне, ошибки только в логе).
- Скриншоты, удалённые при очистке, показываются с сайта до следующего «Refresh Cached Screenshots».

## Проверка
Вручную: Back up now → в списке новая строка; Rebuild Library From Scratch → Restore… на копии до сброса → библиотека вернулась, в списке появилась страховочная копия; повреждённый `.db` в папке копий → понятная ошибка, библиотека прежняя.

Тесты: `libraryBackups.test.js` — список с числом игр, пустая папка, восстановление после сброса со страховочной копией, частичные схемы, отказ для чужих/отсутствующих файлов, откат для не-SQLite; `libraryReset.test.js` — очистка `library_live_versions`. Браузерный смоук: карточка в настройках (пусто, список, подтверждение, итог).

## История изменений
- 2026-09-27 — список, создание и восстановление копий библиотеки; живые версии тем входят в сброс и восстановление.
