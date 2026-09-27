# Ремонт версий: Locate, выбор .exe, удаление версии

**Статус:** active
**Модули:** src/main/libraryVersionRepair.js, src/main/install/findExecutables.js, src/main/libraryMaintenanceIpc.js, src/database.js (updateVersionLocation, updateVersionExecutable), src/main.js (delete-version, контекстное меню), src/core/library/LibraryDetailsPanel.jsx, src/core/GameBanner.js, src/App.jsx (handleLocateVersion)
**Тесты:** test/libraryVersionRepair.test.js, test/databaseVersionLocation.test.js; `node --test test/libraryVersionRepair.test.js test/databaseVersionLocation.test.js`

## Назначение
Игра, папку которой перенесли или переименовали, раньше становилась «Files missing» навсегда: оставалось только переустановить её или удалить из библиотеки. Игра без выбранного файла запуска показывала неактивную кнопку Play без объяснения. Теперь версию можно указать на новую папку (Locate…), выбрать файл запуска прямо в панели деталей и удалить лишнюю версию, не удаляя игру.

## Для пользователя
**Locate… (папка перенесена):**
1. На карточке с бейджем «Files missing» — правый клик → **Locate Folder…**, или в панели деталей кнопка **Locate…** у версии с пометкой «Folder missing».
2. В окне выбора укажите папку, где игра лежит теперь.
3. Приложение само находит файл запуска. Сообщение «Folder found» — игру можно запускать. Если файла запуска не нашлось — появится подсказка **Choose .exe**.

**Choose .exe (не выбран файл запуска):**
- На карточке установленной игры без файла запуска вместо Play кнопка **Choose .exe** — она открывает панель деталей. То же в правом клике: **Choose Executable…**.
- В панели у версии нажмите **Choose .exe**: появится список найденных в папке файлов; нажмите нужный. **Browse…** — выбрать любой файл внутри папки игры.

**Удаление версии:** кнопка с корзиной у версии → подтверждение «Remove version». Удаляется только запись в библиотеке, папка на диске остаётся. Если версия единственная, открывается обычное окно удаления игры.

Типичные ошибки:
- «That folder already belongs to another game in your library» — эта папка уже записана за другой игрой; выберите другую папку или удалите дубль.
- «That folder doesn't exist…» — папка пропала между выбором и сохранением; повторите.
- «Pick a file inside this game's folder» — выбран файл вне папки игры.

## Как это работает
1. Рендерер вызывает `relocateGameVersion({ recordId, version, oldPath })`. Main берёт путь версии из БД (не доверяет рендереру), открывает диалог папки с начальной папкой = ближайший существующий родитель старого пути, иначе папка библиотеки.
2. `relocateGameVersion` (чистая логика с инъекцией FS/DB): папка должна существовать; папки других записей (`otherGamePaths`, без учёта регистра на Windows) запрещены; `findExecutables` ищет файлы с расширениями из настроек «Game launchers», `selectPreferredExecutable` выбирает лучший по названию/автору; `updateVersionLocation` обновляет `game_path` и `exec_path` одной строки `versions`, остальные поля (время игры, размер, дата) сохраняются.
3. После успеха main обновляет профили сохранений (`refreshSaveProfiles`), шлёт `game-updated` и возвращает аннотированную игру (`loadLibraryGame`).
4. Выбор файла: `listGameExecutables` (кандидаты относительно папки), `pickGameExecutable` (диалог файла с проверкой `resolveExecutableWithinFolder`, в БД не пишет), `setGameExecutable` (проверка «внутри папки» и существования, `updateVersionExecutable`).
5. `findExecutables` вынесен из `main.js` в `src/main/install/findExecutables.js`: пути относительны через `path.relative`, расширения нормализуются к нижнему регистру, нечитаемые подпапки пропускаются (корень по-прежнему бросает ошибку).
6. `delete-version` валидирует вход, не бросает исключений в рендерер и шлёт `game-updated`.

Решение: путь к папке всегда берётся из БД, а файл запуска проверяется на принадлежность папке — рендерер не может записать произвольный путь.

## Контракт
| IPC | Вход | Результат |
|-----|------|-----------|
| `relocate-game-version` | `{ recordId, version, oldPath }` | `{ success, game, gamePath, execPath, executable, executables }` / `{ success:false, cancelled:true }` / `{ success:false, code, error }` |
| `list-game-executables` | `{ gamePath }` (папка версии из библиотеки) | `{ success, executables: string[] }` |
| `pick-game-executable` | `{ gamePath }` | `{ success, executable }` (относительный путь) / `{ cancelled:true }` |
| `set-game-executable` | `{ recordId, version, gamePath, executable }` | `{ success, game, execPath, executable }` |
| `delete-version` | `{ recordId, version }` | `{ success, wasLastVersion, error? }` |

Коды: `INVALID_INPUT`, `FOLDER_MISSING`, `FOLDER_UNREADABLE`, `FOLDER_IN_USE`, `VERSION_NOT_FOUND`, `UPDATE_FAILED`, `EXECUTABLE_OUTSIDE_FOLDER`, `EXECUTABLE_MISSING`. Лог-префикс `[library.repair]`.

## Граничные случаи и ошибки
- Отмена диалога → `{ cancelled: true }`, ничего не меняется.
- В новой папке нет файлов запуска → версия переносится с пустым `exec_path`, пользователь выбирает файл вручную.
- Папка не читается (доступ запрещён) → `FOLDER_UNREADABLE`, БД не меняется.
- Ошибка записи в БД → `UPDATE_FAILED`, исключение не уходит в рендерер.
- Версия удалена из другой вкладки/окна → `VERSION_NOT_FOUND`.
- Абсолютный путь на другом диске, `..`, сама папка игры → «вне папки».

## Проверка
Вручную: переименуйте папку установленной игры → Re-check → «Files missing» → Locate… → выберите новую папку → карточка снова «Installed», Play работает. Удалите `exec_path` (или добавьте игру, где файл не распознан) → Choose .exe → выберите файл → Play.

Тесты: `libraryVersionRepair.test.js` — относительные/абсолютные пути, обход `..`, чужие папки, отсутствие исполняемых, сбой БД, проверки выбора файла; `databaseVersionLocation.test.js` — обновление одной строки `versions` без потери остальных полей. Браузерный смоук (web-превью с моками): Choose .exe → список → выбор, Locate с `FOLDER_IN_USE` и успехом, удаление версии с подтверждением.

## История изменений
- 2026-09-27 — добавлены Locate…, Choose .exe, удаление версии из панели; `findExecutables` вынесен в отдельный модуль.
