# Экспорт и импорт сохранений через файл

**Статус:** active
**Модули:** src/main/saveTransfer.js, src/main/saveTransferIpc.js, src/main/detectors/saveProfileDetector.js, src/main/detectors/renpySaveDetector.js, src/main/saveProfileStrategies.js, src/core/library/LibrarySaveSyncPanel.jsx, src/renderer.js, src/web-preview-api.js
**Тесты:** test/saveTransfer.test.js, test/saveProfileDetector.test.js, test/saveVault.test.js; `node --test test/saveTransfer.test.js test/saveProfileDetector.test.js test/saveVault.test.js`

## Назначение
Сохранения можно было только выгрузить в облако (Supabase) и вернуть оттуда. Бесплатный проект Supabase ставится на паузу после недели без трафика, и вся работа с сохранениями упиралась в недоступное облако. Теперь облако — необязательная надстройка: сохранения экспортируются в zip и импортируются из файла на любой машине, без аккаунта. Параллельно расширен список движков и мест, где ищутся сохранения.

## Для пользователя
Панель игры → блок **Saves**:
- **Find save files** — заново найти места сохранений.
- **Export to file** — упаковать все найденные сохранения игры в один zip (по умолчанию в «Документы», имя вида `Название (автор) saves 2026-09-29.zip`). В архиве лежит `manifest.json` и файлы по местам (папка игры, AppData, Documents…).
- **Import from file** — выбрать zip/7z/rar. Понимает и архивы F95Launcher, и «чужие»: zip, сделанный руками из папки `saves`, архив из другого лаунчера, набор файлов сохранений. Перед записью текущие сохранения копируются в локальное хранилище (vault), так что импорт можно откатить переустановкой из хранилища. Если архив с паролем — появится поле для пароля.
- **Open** у каждого найденного места — открыть папку в проводнике.
- **Back up to <хранилище> / Restore from <хранилище>** — при подключённом хранилище сохранений (см. save-storage.md); без него одна кнопка «Connect your cloud».

Окно аккаунта (кнопка облака в шапке) → **Export all saves to folder…** — по одному zip на каждую игру, у которой есть сохранения; аккаунт не нужен.

Где ищутся сохранения (автоматически, по движку и по файлам):
- в папке игры: `game/saves`, `saves`, `save`, `www/save`, `www/saves`, `userdata/save(s)`, `savedata`, `savegames`, `data/save`, `www/savedata`; файлы RPG Maker в корне (`Save*.rvdata2|rvdata|rxdata|lsd`, `*.rpgsave`, `*.rmmzsave`); `Saved/SaveGames` (Unreal);
- Ren'Py: `%APPDATA%\RenPy\<игра>`;
- Unity: `%USERPROFILE%\AppData\LocalLow\<студия>\<игра>`;
- Unreal: `%LOCALAPPDATA%\<игра>\Saved\SaveGames`;
- Godot: `%APPDATA%\Godot\app_userdata\<игра>` и `%APPDATA%\<игра>`;
- HTML/NW.js/Electron/TyranoBuilder: `Local Storage`/`IndexedDB` приложения в `%LOCALAPPDATA%`/`%APPDATA%`;
- Flash: `%APPDATA%\Macromedia\Flash Player\#SharedObjects\<id>\localhost\<путь к игре>` (путь зеркалит папку игры, поэтому находится точно);
- GameMaker: `%LOCALAPPDATA%\<игра>` с файлами сохранений;
- любой движок: `Documents\My Games\<игра>`, `Documents\<игра>`, `Saved Games\<игра>` — только при сильном совпадении имени (короткие и общие слова вроде `Game` не считаются; в корне `Documents` засчитывается только точное имя папки, иначе автор «Studio» совпал бы с `Visual Studio 2022`). Полное удаление игры умеет стирать такие папки, но никогда не трогает сами `Documents`, `Documents\My Games` и `Saved Games`.

## Как это работает
1. **Экспорт** (`exportGameSavesToFile`): для каждого профиля берётся тот же `archiveRoot`, что использует локальное хранилище и облако (`profiles/local/<путь>`, `profiles/roaming/RenPy/<папка>`, `profiles/local-low/...`, `profiles/documents/...`), файлы кладутся в zip (adm-zip), `manifest.json` = общий `buildSaveManifest` (identity, profiles, entries с sha256/mtime) + `format: "f95launcher-saves"`, `formatVersion`, `app`, `game { title, creator, engine, threadUrl, atlasId }`. Пустой набор → ошибка `no_save_files`, файл не создаётся.
2. **Импорт** (`importGameSavesFromFile`): архив распаковывается во временную папку через `extractArchiveSafely` (все форматы и пароли — см. install-recovery.md).
   - С манифестом: каждый профиль манифеста сопоставляется с локальным (`matchManifestProfile`): та же стратегия и payload → тот же провайдер → иначе путь вычисляется из стратегии манифеста на этой машине (`resolveSaveProfileDestinationPath`). Файлы копируются с перезаписью.
   - Без манифеста (`planForeignSaveImport`): общий префикс папок срезается, если заканчивается на `saves|save|savedata|savegames|saved` (`MyGame/Saved/SaveGames/…` → `…`), иначе срезается единственная обёртка верхнего уровня; остаются файлы, похожие на сохранения (`isLikelySaveFile`: расширения `.save .sav .rpgsave .rmmzsave .rvdata2 .lsd .dat .json .sol …`, файлы `persistent`, `global`); мусор (`Thumbs.db`, `readme`) пропускается. Назначение: файлы RPG Maker в корень (профиль `install-file-patterns`) → лучший профиль в папке игры → лучший профиль вне папки (AppData/Documents) → папка по умолчанию для движка (`game/saves` Ren'Py, `save` RPGM, `Saved/SaveGames` Unreal, `Save` Wolf, `savedata` KiriKiri, иначе `saves`).
   - Перед записью IPC делает `backupGameSaves` в vault; после — `refreshSaveProfiles`.
3. **Массовый экспорт** (`export-all-game-saves`): диалог папки, затем для каждой игры библиотеки — обновление профилей и экспорт; игры без сохранений попадают в `skipped`.
4. **Новые стратегии**: `windows-known-folder` получил `baseFolder: "documents" | "savedGames"` (`getKnownFolderRoot`, токены vault `documents`, `saved-games`; переменные `F95LAUNCHER_DOCUMENTS_DIR`/`F95LAUNCHER_SAVED_GAMES_DIR` для тестов). Новые провайдеры: `documents`, `saved_games`, `flash_sharedobjects`, `gamemaker_localappdata`. Семейства движков в детекторе: `wolf`, `kirikiri`, `flash`, `gamemaker`, а `tyrano`/`construct`/`twine` относятся к `html`.
5. **Облако при паузе**: `getCloudSyncErrorDetails` распознаёт `project is paused`, `503/502`, `service unavailable` → код `cloud_paused` с объяснением, что локальные функции работают. Окно аккаунта при недоступном облаке показывает то же и всё равно даёт экспортировать файлы.

## Контракт
- IPC `export-game-saves({ recordId })` → `{ success: true, archivePath, fileCount, totalBytes, profiles: [{ rootPath, files }] }` | `{ success: false, cancelled: true }` | `{ success: false, error, code }`.
- IPC `import-game-saves({ recordId, password?, archivePath? })` → `{ success: true, archivePath, importedFiles, skippedFiles, destinations: [{ rootPath, files, how }], foreign, warnings, backupIdentity, backedUpPaths }` | `{ success: false, cancelled: true }` | `{ success: false, error, code, needsPassword }`. Коды: `no_save_files`, `no_destination`, коды архива.
- IPC `export-all-game-saves()` → `{ success: true, folder, exported: [{ recordId, title, archivePath, fileCount }], skipped: [{ recordId, title, reason }] }`.
- IPC `open-save-location({ recordId, rootPath })` → `{ success }`; путь должен принадлежать профилям игры.
- Preload: `exportGameSaves(recordId)`, `importGameSaves(recordId, { password })`, `exportAllGameSaves()`, `openSaveLocation(recordId, rootPath)`.
- Модуль `saveTransfer.js`: `exportGameSavesToFile`, `importGameSavesFromFile`, `inspectSaveArchive`, `planForeignSaveImport`, `matchManifestProfile`, `isLikelySaveFile`, `buildSaveExportFileName`, `getArchiveRoot`, `ENGINE_DEFAULT_SAVE_PATHS`.

## Граничные случаи и ошибки
- Игра без папки установки на этой машине: профили из манифеста с путями AppData всё равно импортируются; «чужой» архив без назначения → `no_destination`.
- Архив без единого файла, похожего на сохранение → `no_save_files`, ничего не записано.
- Разные имена папок Ren'Py в AppData на двух машинах: профиль сопоставляется по провайдеру `renpy_appdata`, файлы идут в локальную папку.
- Импорт всегда перезаписывает одноимённые файлы; откат — через vault (`backups/save_vault/<identity>`).
- Экспорт из панели предварительно обновляет профили, чтобы захватить папку, появившуюся после последнего сканирования.

## Проверка
1. Автотесты: цикл экспорт → импорт на «другой машине» (другая папка установки и другая папка AppData), отказ пустого экспорта, zip папки `saves` с мусором, план для RPG Maker/Unreal/вложенных обёрток, отказ архива без сохранений, сопоставление профилей; детектор — Documents/My Games, Saved Games, GameMaker, Flash SharedObjects, KiriKiri `savedata`, Wolf `save`.
2. Вручную: игра Ren'Py → **Export to file** → zip в Документах с `manifest.json` и `profiles/local/game/saves/...` → удалить сохранения → **Import from file** → сохранения на месте, в vault появилась копия. Заархивировать папку `saves` WinRAR → импорт → файлы в `game/saves`. Окно аккаунта при выключенном облаке → **Export all saves to folder…** → по zip на игру.

## История изменений
- 2026-09-29 — первая версия: экспорт/импорт через файл, массовый экспорт, новые места сохранений (Documents, Saved Games, Flash, GameMaker, KiriKiri, Wolf RPG, RPG Maker 2000/2003), сообщение о паузе облака.
