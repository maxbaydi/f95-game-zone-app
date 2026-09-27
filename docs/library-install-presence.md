# Состояние установки: установлена, файлы отсутствуют, не установлена

**Статус:** active
**Модули:** src/main/libraryPresence.js, src/shared/libraryInstallState.js, src/main/install/installTarget.js, src/main.js (loadLibraryGames, resolveF95InstallTarget, retireStaleVersionRows), src/core/GameBanner.js, src/core/library/LibraryDetailsPanel.jsx, src/core/updates/F95UpdateModal.jsx
**Тесты:** test/libraryPresence.test.js, test/libraryInstallState.test.js, test/installTarget.test.js; `node --test test/libraryPresence.test.js test/libraryInstallState.test.js test/installTarget.test.js`

## Назначение
Библиотека хранит записи об играх независимо от того, лежат ли их файлы на диске: папку могли удалить, перенести, отключить внешний диск, а запись из облачной библиотеки вообще никогда не устанавливалась на этом ПК. Раньше все такие записи выглядели «установленными»: кнопка Play не работала, а «Обновить» скачивало архив и падало при распаковке в несуществующую папку. Теперь приложение различает три состояния и предлагает правильное действие.

## Для пользователя
На карточке игры и в панели деталей видно одно из состояний:

- **Installed** — папка на месте, доступны Play и (если вышла новая версия) Update.
- **Files missing** — игра устанавливалась здесь, но её папки больше нет. Бейдж «Files missing» на карточке, в деталях блок «Installed files are missing» с последней известной версией. Кнопка — **Install** (даже если на сайте есть новая версия): игра ставится заново в папку библиотеки. Play и «Open folder» отключены.
- **Not installed** — запись из облачной библиотеки или добавленная со страницы темы; кнопка **Install**.

Фильтр **Show** над сеткой: All games / Installed on this PC / Files missing / Not installed (с количеством). В строке состояния внизу: `N in library · I installed · M missing files · K not installed`.

Если папку просто перенесли — **Locate…** у версии в деталях или **Locate Folder…** в меню карточки (library-version-repair.md). В фильтре «Files missing» над сеткой есть **Reinstall all** и **Remove all from library** (library-missing-bulk-actions.md).

Если внешний диск временно отключён, игра показывается как «Files missing», а после подключения и перезагрузки списка (кнопка ⟳ рядом с фильтром, возврат в окно больше чем через минуту, пересканирование или перезапуск) снова становится «Installed». Сетевой диск, который не отвечает, не считается отсутствующим: такие папки помечаются как «неизвестно» и показываются установленными.

Типичные ошибки:
- «The folder of this game no longer exists on this PC» при Play — используйте Locate… (если папку перенесли), Install или удалите игру из библиотеки.
- После переустановки в новую папку старая «мёртвая» версия исчезает из списка версий автоматически.

## Как это работает
1. `getGames`/`getGame` (SQLite) отдают записи как раньше. В `main.js` все чтения для рендерера идут через `loadLibraryGames()`/`loadLibraryGame()`, которые вызывают `annotateLibraryPresence()`.
2. `annotateLibraryPresence` проверяет каждую `versions[].game_path` через `createPathPresenceProbe()`: `fs.promises.stat` с таймаутом 1,5 с, кэш результатов на один вызов, на Windows сначала проверяется корень диска/шары — если корня нет, все пути на нём сразу «missing», если корень не отвечает — все «unknown» без дополнительных ожиданий.
3. Игре добавляются поля `installState`, `presentVersionCount`, `missingVersionCount`, `presenceUnknownCount`, `lastKnownVersion`; `newestInstalledVersion` и `isUpdateAvailable` пересчитываются только по присутствующим версиям (`buildVersionUpdateState`). У «missing» и «not_installed» обновление никогда не доступно.
4. `shared/libraryInstallState.js` (main + renderer) даёт единые константы, `getLibraryInstallState`, фильтр и подписи. Рендерер не обращается к диску.
5. Установка из темы (`importDownloadedF95Package` → `resolveF95InstallTarget` → `chooseInstallDirectory`): существующая папка записи переиспользуется только если она есть на диске; иначе выбирается новая папка в библиотеке (`<Library>/<Title>`, с суффиксом `(n)` при занятости), а пропавшие пути возвращаются как `staleInstallPaths`. После успешной записи новой версии `retireStaleVersionRows` удаляет строки `versions` с отсутствующими путями (только при установке в новую папку).
6. `moveDirectoryIntoPlace` создаёт родительскую папку перед `rename`, чтобы установка не падала, если удалили всю папку библиотеки.
7. `getF95ThreadInstallState` (кнопки в F95-браузере) считает `installed` только при `installState === "installed"` и отдаёт `installState`.
8. Уведомления «доступны обновления» строятся по аннотированным играм, поэтому отсутствующие на диске игры их не вызывают.

Решение: присутствие проверяется при чтении, а не хранится в БД, чтобы состояние всегда соответствовало диску (внешние диски, ручное удаление) и не требовало миграций.

## Контракт
IPC `get-games`, `get-game`, `set-game-favorite` возвращают игры с полями:

| Поле | Значение |
|------|----------|
| `installState` | `installed` / `missing` / `not_installed` |
| `versions[].isPresent`, `versions[].presenceKnown` | папка существует / проверка дала ответ |
| `presentVersionCount`, `missingVersionCount`, `presenceUnknownCount` | счётчики |
| `newestInstalledVersion` | новейшая из присутствующих версий, `""` если нет |
| `lastKnownVersion` | новейшая из всех записанных версий |
| `isUpdateAvailable` | только для `installed` |

`get-f95-thread-install-state` дополнительно отдаёт `installState`. Таймаут проверки пути: 1500 мс (константа `DEFAULT_PROBE_TIMEOUT_MS`).

## Граничные случаи и ошибки
- Путь пустой → версия «missing».
- Путь указывает на файл, а не папку → «missing».
- `stat` завершился ошибкой кроме `ENOENT`/`ENOTDIR` (например `EPERM`) или таймаут → `presenceKnown=false`, версия считается присутствующей.
- Все версии игры отсутствуют, но на сайте есть новая версия → `isUpdateAvailable=false`, действие «Install»; в модальном окне установки показывается пояснение о свежей установке.
- При установке в новую папку старые пути, которые к моменту установки уже снова существуют, не удаляются.
- Обновление установленной игры, у которой есть вторая копия на отключённом диске: копия остаётся в списке версий как «Folder missing».

## Проверка
Вручную:
1. Установите игру, затем удалите или переименуйте её папку. Обновите список (любое пересканирование или перезапуск) — карточка получает бейдж «Files missing», Play отключён, в деталях «Installed files are missing».
2. Нажмите Install — игра скачивается и распаковывается в `<папка библиотеки>/<название>`, старая версия с мёртвым путём пропадает.
3. Отфильтруйте «Files missing» — видны только такие игры; строка состояния показывает их количество.
4. Игра, добавленная из облачной библиотеки без установки, показывает «Not installed» и кнопку Install.

Тесты: `libraryPresence.test.js` — аннотация состояний, обновление только по присутствующим версиям, кэш и короткое замыкание по корню диска, таймауты; `libraryInstallState.test.js` — фильтр и подписи; `installTarget.test.js` — выбор папки установки и список устаревших путей. Проверка в браузере (dev-превью с четырьмя образцами состояний): карточки, панель деталей, модальное окно установки, фильтр.

## История изменений
- 2026-09-27 — введены состояния установки, проверка присутствия папок, установка вместо обновления для отсутствующих игр, фильтр и бейджи.
- 2026-09-27 — перепроверка без сканирования (⟳ и возврат в окно), ссылки на Locate… и массовые действия для «Files missing».
