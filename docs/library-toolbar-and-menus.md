# Панель библиотеки: меню пересканирования, сохранение сортировки, перепроверка, итоги сканирования, вход в F95

**Статус:** active
**Модули:** src/App.jsx (LibraryRescanMenu, renderSectionControls, reloadLibraryGames, rescanLibrary, handleGameUpdate), src/shared/storedChoice.js, src/core/updates/F95UpdateModal.jsx, src/core/GameBanner.js, src/main.js (handleContextAction, summarizeDuplicateCleanup в scan-library), src/main/libraryDuplicates.js
**Тесты:** test/storedChoice.test.js, test/libraryDuplicates.test.js; `node --test test/storedChoice.test.js test/libraryDuplicates.test.js`

## Назначение
Набор мелких улучшений повседневной работы с библиотекой: меню пересканирования внутри окна вместо системного, запоминание сортировки и фильтра, перепроверка файлов без сканирования, понятные итоги сканирования (куда смотреть дальше, что объединено) и вход в F95 прямо из окна установки.

## Для пользователя
- **Rescan Library** внизу открывает меню над кнопкой: Find New Games, Refresh Installed Games, Refresh Cached Screenshots, Reset Scan Cache & Rescan, Rebuild Library From Scratch… — с короткими пояснениями. Закрывается по Esc, щелчку вне меню или выбору пункта; стрелки ↑/↓, Home/End перемещают по пунктам.
- Сортировка (**Sort**) и фильтр (**Show**) запоминаются между запусками. Если фильтр ничего не показывает — «No games match this filter» и кнопка **Show all games**.
- Кнопка **⟳** рядом с фильтром заново проверяет, какие игры есть на диске, без сканирования папок. То же происходит само, когда вы возвращаетесь в окно больше чем через минуту (например, после переименования папки в проводнике).
- Итог сканирования: если есть папки для проверки — сообщение с кнопкой **Open Scan Hub**; если есть игры без совпадения с каталогом — подсказка про Link to catalog…; если найдены игры без файлов — кнопка **Show them** (фильтр Files missing); если объединены дубликаты — «Merged N duplicate entries» с кнопкой **Details** (какая запись оставлена ← какие объединены).
- Окно установки/обновления без входа в F95 показывает «Sign in to F95 to see the mirrors for this game.» и кнопку **Sign in to F95**; после входа список зеркал появляется сам.

## Как это работает
1. `LibraryRescanMenu` — поповер `role="menu"` с `role="menuitem"`, закрытие через `AppMotion.useEscape`, `mousedown` вне меню и кнопки, выбор → `runRescanMenuAction` (те же действия, что раньше слал системный контекстный меню). Действия контекстного меню оставлены в `handleContextAction` для совместимости; `refreshLibrary`, `refreshLibraryPreviews`, `resetLibrary` теперь тоже пересылаются (раньше падали в «Unknown action»).
2. `storedChoice.readStoredChoice/writeStoredChoice` (UMD, `window.storedChoice`): ключи `f95launcher.librarySortMode` и `f95launcher.libraryInstallFilter`, допустимые значения — из `LIBRARY_SORT_OPTIONS` и `LIBRARY_INSTALL_FILTER_OPTIONS`; недопустимое значение удаляется, недоступное хранилище не ломает запуск.
3. `reloadLibraryGames` — полная перезагрузка `getGames` (main заново проверяет папки), отметка `lastLibraryLoadAtRef`; используется кнопкой ⟳, событием `focus` окна (если прошло > 60 с и сканирование не идёт) и `games-library-synced`. Во время сканирования ⟳ недоступна.
4. `scan-library` возвращает `duplicateMerges = summarizeDuplicateCleanup(cleanup)`: по каждой папке `{ gamePath, keptRecordId, keptTitle, mergedTitles, failedTitles }`; группы без изменений не попадают.
5. `handleGameUpdate` сначала читает `getF95AuthStatus()`; без сессии открывает диалог в состоянии `needsLogin`. Подписка `subscribeF95AuthChanged` при появлении сессии повторяет проверку темы для открытого диалога.
6. Карточка: для установленной игры без файла запуска главная кнопка — **Choose .exe** (открывает панель); меню — **Locate Folder…** и **Choose Executable…** (library-version-repair.md).

## Контракт
- localStorage: `f95launcher.librarySortMode`, `f95launcher.libraryInstallFilter` (только значения из списков опций).
- `scan-library` → `duplicateMerges: Array<{ gamePath, keptRecordId, keptTitle, mergedTitles: string[], failedTitles: string[] }>`, `importedUnmatched`.
- Контекстное меню → рендерер (`context-menu-command`): `properties`, `locateGame`, `chooseExecutable`, `removeGame`, `updateGame`, `addToFavorites`, `removeFromFavorites`, `rescanLibrary`, `refreshLibrary`, `refreshLibraryPreviews`, `resetCacheAndRescanLibrary`, `resetLibrary`.
- `F95UpdateModal` props: `needsLogin`, `onSignIn`.
- Порог перепроверки при фокусе: 60 000 мс.

## Граничные случаи и ошибки
- Во время сканирования меню не открывается («A library scan is already running»), открытое меню закрывается.
- Хранилище браузера заблокировано → значения по умолчанию, ошибок нет.
- Сохранённый фильтр «Files missing», а таких игр нет → пустое состояние с «Show all games».
- Сетевая папка не отвечает при перепроверке → игры показываются установленными (см. library-install-presence.md).
- Вход в F95 закрыт без входа → диалог остаётся в состоянии входа.

## Проверка
Вручную: Rescan Library → меню над кнопкой, Esc закрывает; выбрать сортировку и фильтр → перезапуск → значения сохранены; переименовать папку игры → вернуться в окно через минуту → «Files missing»; выйти из F95 → Install → «Sign in to F95».

Тесты: `storedChoice.test.js` — допустимые значения, сбойное/отсутствующее хранилище; `libraryDuplicates.test.js` — сводка объединений. Браузерный смоук: меню (стрелки, Esc, клик вне, пункт → окно сброса), сохранение сортировки после перезагрузки страницы, ⟳, окно установки без входа.

## История изменений
- 2026-09-27 — меню пересканирования в окне, запоминание сортировки/фильтра, перепроверка без сканирования, подробные итоги сканирования, вход в F95 из окна установки.
