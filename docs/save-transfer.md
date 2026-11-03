# Экспорт и импорт сохранений через файл

**Статус:** active
**Модули:** src/main/saveTransfer.js, src/main/saveTransferIpc.js, src/main/saveVault.js, src/main/archive/extractArchive.js, src/main/detectors/saveProfileDetector.js, src/main/detectors/renpySaveDetector.js, src/main/saveProfileStrategies.js, src/core/library/LibrarySaveSyncPanel.jsx, src/renderer.js, src/web-preview-api.js
**Тесты:** test/saveTransfer.test.js, test/saveTransferIpc.test.js, test/saveProfileDetector.test.js, test/saveVault.test.js, test/extractArchive.test.js; `node --test test/saveTransfer.test.js test/saveTransferIpc.test.js test/saveProfileDetector.test.js test/saveVault.test.js test/extractArchive.test.js`

## Назначение
Экспорт и импорт через файл работают независимо от подключённого хранилища и не требуют аккаунта. Архив можно перенести на другую машину; импорт сопоставляет сохранённые профили с путями на текущем ПК и делает локальную резервную копию до записи.

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
1. **Экспорт** (`exportGameSavesToFile`): для каждого профиля берётся тот же `archiveRoot`, что использует локальное хранилище и облако (`profiles/local/<путь>`, `profiles/roaming/RenPy/<папка>`, `profiles/local-low/...`, `profiles/documents/...`). Каждый файл читается один раз; те же байты попадают в ZIP и используются для размера и SHA-256 в `manifest.json`. Манифест содержит общий `buildSaveManifest` (identity, profiles, entries с sha256/mtime, `manifestHash`, `contentHash`) и `format: "f95launcher-saves"`, `formatVersion`, app и сведения об игре. Ошибка чтения файла прерывает экспорт; пустой набор даёт `no_save_files`.
2. **Импорт** (`importGameSavesFromFile`): архив распаковывается во временную папку через `extractArchiveSafely` (все форматы и пароли — см. install-recovery.md).
   - В архиве F95Launcher до записи проверяются формат и версия, хеш манифеста, профили и корни путей, полный состав архива, размер и SHA-256 каждого файла. Дополнительные, отсутствующие или изменённые файлы отклоняются как `invalid_save_manifest`; временная папка удаляется.
   - Каждый профиль манифеста сопоставляется с локальным (`matchManifestProfile`): та же стратегия и payload → тот же провайдер → иначе путь вычисляется из стратегии манифеста на этой машине (`resolveSaveProfileDestinationPath`). После полной проверки архивных файлов и назначения файлы копируются с перезаписью.
   - Без манифеста F95Launcher (`planForeignSaveImport`): общий префикс папок срезается, если заканчивается на `saves|save|savedata|savegames|saved` (`MyGame/Saved/SaveGames/…` → `…`), иначе срезается единственная обёртка верхнего уровня; остаются файлы, похожие на сохранения (`isLikelySaveFile`: расширения `.save .sav .rpgsave .rmmzsave .rvdata2 .lsd .dat .json .sol …`, файлы `persistent`, `global`); мусор (`Thumbs.db`, `readme`) пропускается. Назначение: файлы RPG Maker в корень (профиль `install-file-patterns`) → лучший профиль в папке игры → лучший профиль вне папки (AppData/Documents) → папка по умолчанию для движка (`game/saves` Ren'Py, `save` RPGM, `Saved/SaveGames` Unreal, `Save` Wolf, `savedata` KiriKiri, иначе `saves`).
   - IPC сначала делает `backupGameSaves` в vault. Ошибка резервирования прерывает импорт; после успешной записи вызывается `refreshSaveProfiles`.
3. **Массовый экспорт** (`export-all-game-saves`): диалог папки, затем для каждой игры библиотеки — обновление профилей и экспорт; игры без сохранений попадают в `skipped`.
4. **Новые стратегии**: `windows-known-folder` получил `baseFolder: "documents" | "savedGames"` (`getKnownFolderRoot`, токены vault `documents`, `saved-games`; переменные `F95LAUNCHER_DOCUMENTS_DIR`/`F95LAUNCHER_SAVED_GAMES_DIR` для тестов). Новые провайдеры: `documents`, `saved_games`, `flash_sharedobjects`, `gamemaker_localappdata`. Семейства движков в детекторе: `wolf`, `kirikiri`, `flash`, `gamemaker`, а `tyrano`/`construct`/`twine` относятся к `html`.
## Контракт
- IPC `export-game-saves({ recordId })` → `{ success: true, archivePath, fileCount, totalBytes, profiles: [{ rootPath, files }] }` | `{ success: false, cancelled: true }` | `{ success: false, error, code }`.
- IPC `import-game-saves({ recordId, password?, archivePath? })` → `{ success: true, archivePath, importedFiles, skippedFiles, destinations: [{ rootPath, files, how }], foreign, warnings, backupIdentity, backedUpPaths }` | `{ success: false, cancelled: true }` | `{ success: false, error, code, needsPassword }`. Коды включают `no_save_files`, `no_destination`, `invalid_save_manifest` и коды архива. Ошибка vault backup также завершает операцию без импорта.
- IPC `export-all-game-saves()` → `{ success: true, folder, exported: [{ recordId, title, archivePath, fileCount }], skipped: [{ recordId, title, reason }] }`.
- IPC `open-save-location({ recordId, rootPath })` → `{ success }`; путь должен принадлежать профилям игры.
- Preload: `exportGameSaves(recordId)`, `importGameSaves(recordId, { password })`, `exportAllGameSaves()`, `openSaveLocation(recordId, rootPath)`.
- Модуль `saveTransfer.js`: `exportGameSavesToFile`, `importGameSavesFromFile`, `inspectSaveArchive`, `planForeignSaveImport`, `matchManifestProfile`, `isLikelySaveFile`, `buildSaveExportFileName`, `getArchiveRoot`, `ENGINE_DEFAULT_SAVE_PATHS`.

## Граничные случаи и ошибки
- Игра без папки установки на этой машине: профили из манифеста с путями AppData всё равно импортируются; «чужой» архив без назначения → `no_destination`.
- Архив без единого файла, похожего на сохранение → `no_save_files`, ничего не записано.
- Разные имена папок Ren'Py в AppData на двух машинах: профиль сопоставляется по провайдеру `renpy_appdata`, файлы идут в локальную папку.
- Импорт перезаписывает одноимённые файлы только после успешного завершения резервной копии в vault (`backups/save_vault/<identity>`); при ошибке копии импорт прекращается.
- Vault собирает новую копию во временной staging-папке и публикует её после завершения копирования и manifest. Предыдущая полная копия сохраняется до успешной замены; если прерывание оставило основной каталог отсутствующим, следующая операция vault восстанавливает его из `.previous`.
- Экспорт из панели предварительно обновляет профили, чтобы захватить папку, появившуюся после последнего сканирования.

## Проверка
1. Автотесты покрывают цикл экспорт → импорт на «другой машине», пустой экспорт, foreign ZIP, проверку manifest и SHA-256, повреждённый архив, сбой резервной копии и сопоставление профилей.
2. Вручную (pending final verification): в изолированном профиле запретить запись в каталог vault и проверить, что file import и cloud restore останавливаются, а хеш исходных локальных сейвов не меняется; скопировать корректный ZIP и повредить manifest или один файл внутри, затем проверить отказ импорта и отсутствие изменений локальных файлов; выполнить обычный экспорт/импорт и импорт foreign ZIP, проверив сохранность исходного архива.

## История изменений
- 2026-09-29 — первая версия: экспорт/импорт через файл, массовый экспорт, новые места сохранений (Documents, Saved Games, Flash, GameMaker, KiriKiri, Wolf RPG, RPG Maker 2000/2003), сообщение о паузе облака.
