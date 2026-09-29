# Распаковка пакетов и восстановление неудачной установки

**Статус:** active
**Модули:** src/main/archive/extractArchive.js, src/main/archive/archiveErrors.js, src/main/archive/rarTask.js, src/main/archive/rarWorker.js, src/main/install/detectEngine.js, src/main/install/selectExecutable.js, src/main/f95/downloadsStore.js, src/main.js (`importDownloadedF95Package`, `finalizeF95DownloadedPackage`, `installF95RetainedPackage`, `installF95PackageFromFolder`, IPC `retry-f95-install`, `install-f95-download-from-folder`), src/core/downloads/DownloadsPanel.jsx
**Тесты:** test/extractArchive.test.js, test/detectEngine.test.js, test/selectExecutable.test.js, test/downloadsStore.test.js; `node --test test/extractArchive.test.js test/detectEngine.test.js test/selectExecutable.test.js test/downloadsStore.test.js`

## Назначение
Раньше любая ошибка распаковки заканчивалась одинаково: «Install failed for …», а скачанный архив тут же удалялся из папки загрузок, и файл приходилось качать заново. Причины ошибок при этом были типовыми и часто устранимыми: RAR-архивы распаковывались внешней утилитой `unrar`, которой на Windows нет; архив с паролем, битая докачка, нет места на диске, файл занят антивирусом, вложенный архив, «архив в архиве» — всё выглядело одинаково. Движок определялся только по имени выбранного exe, поэтому Unity, Unreal, Wolf RPG, KiriKiri и другие движки записывались как «Unknown», а лаунчером могли стать `UnityCrashHandler64.exe` или `CrashReportClient.exe`.

Теперь распаковка идёт через цепочку инструментов с понятными кодами ошибок, пакет после неудачи остаётся на диске, а установку можно повторить (в том числе с паролем) или завершить руками.

## Для пользователя
1. Карточка загрузки в панели **Downloads** после неудачной установки показывает причину и подсказку (что сделать), а внизу — блок «The downloaded file is still here».
2. **Retry install** — повторить установку из уже скачанного файла. Ничего не скачивается заново. Помогает, когда освободили место на диске, антивирус закончил проверку, или просто хочется попробовать другим архиватором (цепочка пробует их по очереди сама).
3. **Архив с паролем** — вместо кнопки появляется поле «Archive password» и кнопка **Unpack with password**. Пароль обычно указан в теме игры рядом со ссылками.
4. **Install from folder** — если распаковали архив сами (WinRAR, 7-Zip): выбираете папку игры, приложение копирует её в библиотеку (или регистрирует на месте, если папка уже внутри папки библиотеки), определяет движок и лаунчер, восстанавливает сохранения из локального хранилища. Скачанная копия архива после этого удаляется.
5. **Install from file** — выбрать другой архив/установщик (например, скачанный в браузере), как и раньше.
6. **Re-download** — скачать заново с зеркала (старая кнопка Retry); нужна только когда файл действительно повреждён.
7. **Folder** открывает папку, где лежит сохранённый пакет.
8. Список загрузок теперь переживает перезапуск приложения: прерванная установка становится «Failed» с сохранённым файлом, и **Retry install** доступен и после перезапуска. Пакеты удаляются при **Clear history** и при новой попытке установки той же игры.
9. Если в пакете не нашлось ни одного файла запуска, игра всё равно ставится, а карточка показывает предупреждение — лаунчер выбирается в панели игры («Choose executable»).

Типичные подсказки:
- «The archive is password-protected…» — введите пароль из темы.
- «The password did not open the archive…» — пароль неверный (или архив повреждён).
- «The archive is damaged or was not downloaded completely…» — перекачать с другого зеркала или распаковать вручную с восстановлением.
- «This is a multi-part archive and not all parts are present…» — докачать все части (`.part2.rar`, `.7z.002`…) в ту же папку.
- «There is not enough free disk space…» — освободить место и **Retry install**.
- «A file is locked by another program…» — подождать (антивирус) и **Retry install**; приложение уже само делает три попытки с паузой.
- «Some file paths in the archive are too long…» — переместить папку библиотеки ближе к корню диска или распаковать вручную.

## Как это работает
1. **Формат** определяется по сигнатуре файла, затем по имени: zip (в том числе `.apk`, `.jar`), 7z, rar, tar, gz/tgz, bz2, xz, zst, cab. Составные `tar.gz`/`tgz`/`tar.xz` распаковываются в два прохода.
2. **Цепочка распаковщиков** (`buildExtractorChain`):
   - zip: встроенный 7-Zip (`7zip-bin`, поддерживает длинные пути и Unicode) → PowerShell `ZipFile` (Windows, без пароля) → adm-zip (файлы до 1 ГБ) → системный 7-Zip;
   - 7z/tar/gz/bz2/xz: встроенный 7-Zip → системный 7-Zip (`C:\Program Files\7-Zip\7z.exe`);
   - rar: `node-unrar-js` (официальный unrar, скомпилированный в WebAssembly, работает в worker-потоке, чтобы не морозить интерфейс) → системный 7-Zip → `UnRAR.exe`/`WinRAR.exe`. Многотомные RAR-архивы WebAssembly-версия не открывает — для них нужен системный архиватор (иначе код `archive_multipart_unsupported`).
   Перед распаковкой архив листится, имена записей проверяются на выход за пределы папки (`../`, абсолютные пути). Определённые («definitive») ошибки — неверный пароль, нет места, небезопасные пути, нет тома — останавливают цепочку сразу; остальные передают ход следующему инструменту, а в итоге выбрасывается самая информативная ошибка.
3. **Коды ошибок** (`ArchiveError.code`, см. archiveErrors.js): `unsupported_format`, `archive_not_found`, `archive_encrypted`, `archive_wrong_password`, `archive_corrupt`, `archive_incomplete`, `archive_missing_volume`, `archive_multipart_unsupported`, `archive_unsafe_paths`, `disk_full`, `path_too_long`, `file_locked`, `extract_tool_missing`, `extract_failed`. Вывод 7-Zip/unrar и ошибки файловой системы (`ENOSPC`, `EBUSY`, `ENAMETOOLONG`…) отображаются на эти коды. `file_locked` повторяется до трёх раз с паузой 1,5 с.
4. **Установка** (`importDownloadedF95Package`): архив распаковывается в `downloads/_staging/<title>-<ts>`, там определяется корень содержимого (`resolveArchiveContentRoot`), при отсутствии файлов запуска один вложенный архив распаковывается на месте (`unwrapNestedArchive`), и только потом содержимое переносится в папку установки. Скачанный файл удаляется **только после успешной** установки; при ошибке он остаётся, а путь к нему записывается в `packagePath` записи загрузки вместе с `errorCode` и `hint`.
5. **Движок** определяется по файлам папки (`detectGameEngine`): Ren'Py (`renpy/`, `game/*.rpa|rpyc`, `lib/py*`), RPG Maker MV/MZ (`js/rpg_core.js`, `js/rmmz_core.js`), VX Ace/VX/XP (`Game.rgss3a`, `Game.ini`, `Data/*.rvdata2|rvdata|rxdata`), 2000/2003 (`RPG_RT.exe`), Unity (`<name>_Data/`, `UnityPlayer.dll`, `MonoBleedingEdge/`), Unreal (`Engine/`, `*/Binaries/Win64/*-Shipping.exe`, `Content/Paks`, `.uproject`), Godot (`*.pck`), Wolf RPG (`Data.wolf`), KiriKiri (`*.xp3`), GameMaker (`data.win`), TyranoBuilder (`tyrano/`), HTML/Twine/SugarCube/Construct/NW.js/Electron (`index.html`, `nw.exe`, `resources/app.asar`), Flash (`.swf`, AIR), Java (`.jar`), QSP/RAGS/ADRIFT/TADS. Метки совпадают с вокабуляром F95 (`Ren'Py`, `RPGM`, `Unity`, `Unreal Engine`, `Wolf RPG`…). Детектор возвращает и подсказки для выбора лаунчера: `preferredExecutables` (плеер Unity рядом с `<name>_Data`, корневой exe Unreal, `Game.exe` RPG Maker, `index.html`) и `ignoredExecutables` (`UnityCrashHandler*`, `CrashReportClient`, `nw.exe`, `Config.exe` Wolf RPG). `selectPreferredExecutable` учитывает их и штрафует папки `redist/`, `_CommonRedist/`, `Engine/Binaries/`, `DirectX/`, `dotnet/`.
6. **Повтор и ручная установка**: `retry-f95-install` запускает `installF95RetainedPackage` для сохранённого пакета (с паролем, если передан); `install-f95-download-from-folder` — `installF95PackageFromFolder`. Обе работают и для записей, восстановленных после перезапуска: контекст пересобирается из записи (`createF95ContextFromEntry`), метаданные (название, автор, версия, движок, ссылка на тему) берутся из неё.
7. **Хранение списка**: стор загрузок пишет `data/f95-downloads.json` (атомарно, с задержкой 300 мс, сброс при выходе). При старте `hydrateF95DownloadsStore` читает список, активные записи переводит в `error` с кодом `install_interrupted`/`download_interrupted`, отбрасывает `packagePath` несуществующих файлов, удаляет `downloads/_staging` и файлы в папке загрузок, на которые не ссылается ни одна запись.

## Контракт
- `extractArchiveSafely({ archivePath, destinationPath, password?, retryDelayMs?, toolCandidates?, preferSystemTools? })` → `{ success: true, extractedEntries, format, tool, encrypted }`; ошибка — `ArchiveError { code, tool, detail, entry }`. `inspectArchive(path, { password? })` → `{ format, compound, entries: [{ name, size, directory, encrypted }], encrypted, multipart: { isMultipart, role, missingVolumes }, tool }`. `listArchiveEntries` сохранён для совместимости. `isSupportedArchiveName(name)`, `detectArchiveFormat(path)`, `inspectArchiveVolumes(path)`.
- `detectGameEngine(dir, { executables? })` → `{ id, engine, variant, confidence, reasons, preferredExecutables, ignoredExecutables }`; `engine === ""` при уверенности < 40.
- `selectPreferredExecutable(list, { title, creator, preferredExecutables, ignoredExecutables })`.
- Запись стора (публичные поля добавлены): `packagePath`, `hint`, `warning` (`"no_executable"`), `engine`, `canInstallFromPackage` (error + пакет на диске), `canInstallManually` (error | cancelled | action), `needsPassword` (`archive_encrypted` | `archive_wrong_password`). `fail(id, { packagePath, hint })` сохраняет пакет; `complete`/`start`/`resolving`/`queue` сбрасывают; `clearPackage(id)`, `hydrate(entries, packageExists)`, `packagePaths()`, `createDownloadsStore({ onChange })`.
- IPC `retry-f95-install({ id, password? })` → `{ success: true, queued: true, id, fileName }` | `{ success: false, error }`. `install-f95-download-from-folder(id)` → `{ success: true, queued: true, id, folderName }` | `{ success: false, cancelled: true }` | `{ success: false, error }`. `install-f95-download-from-file` теперь допускает статусы `error`, `action`, `cancelled` и записи без живого контекста.
- Результат установки: `importResults[0].warning === "no_executable"`, если файл запуска не найден.

## Граничные случаи и ошибки
- Пакет с расширением не по содержимому (например `.bin`, а внутри 7z) переименовывается; в `packagePath` попадает актуальное имя.
- HTML-страница вместо архива и пустой файл (`DownloadValidationError.cleanupFile`) по-прежнему удаляются — их нечего повторять.
- Зашифрованные заголовки 7z/RAR: листинг невозможен без пароля → `archive_encrypted` до записи чего-либо на диск. RAR4 не отличает неверный пароль от повреждения: при заданном пароле ошибка данных считается неверным паролем.
- Архив, у которого во всём содержимом только другой архив, распаковывается на один уровень вглубь; глубже — нет.
- «Install from folder» с корнем папки библиотеки отклоняется («Pick the folder of this game…»). Папка внутри библиотеки регистрируется на месте без копирования.
- Worker-поток для RAR не запустился (особенности упаковки) — распаковка выполняется в основном потоке, поддержка RAR не теряется.
- В `build.files` добавлен `node_modules/node-unrar-js/**/*`, пакет `unrar` удалён из зависимостей.

## Проверка
1. Автотесты: zip/7z/tar.gz/rar (в том числе RAR с паролем и с зашифрованными заголовками, фикстуры в `test/fixtures/archives`), обрезанный zip → `archive_corrupt`, отсутствующие тома, небезопасные пути (zip собран вручную, так как adm-zip и 7-Zip сами убирают `../`), классификация вывода инструментов, определение движков и выбор лаунчера для Ren'Py/Unity/Unreal/RPGM/Godot/Wolf/KiriKiri/GameMaker/Tyrano/HTML/Flash/Java, стор загрузок с пакетами и гидрацией.
2. Вручную (Windows): установить игру из RAR с зеркала → «Installed» без системного WinRAR. Установить архив с паролем → карточка с полем пароля → ввести → «Installed». Отключить диск/заполнить место → «disk_full» с подсказкой, освободить, **Retry install**. Закрыть приложение во время установки → после запуска запись «Failed» с **Retry install**. Распаковать архив руками → **Install from folder** → игра в библиотеке, копия архива удалена. Unity-игра: движок «Unity», лаунчер `<name>.exe`, а не `UnityCrashHandler64.exe`; Unreal: корневой exe.

## История изменений
- 2026-09-29 — первая версия: цепочка распаковщиков с кодами ошибок, RAR без внешних утилит, пароли, сохранение пакета после ошибки, Retry install / Install from folder, определение движка по файлам, список загрузок между запусками.
