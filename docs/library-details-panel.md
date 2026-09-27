# Панель деталей игры (вместо окна «Edit Game Details»)

**Статус:** active
**Модули:** src/core/library/LibraryDetailsPanel.jsx, src/core/library/CatalogLinkModal.jsx, src/App.jsx (props панели, handleImageAction, контекстное меню), src/main.js (handleContextAction, update-game, delete-version, update-banners/update-previews), src/renderer.js, src/web-preview-api.js, package.json (build.files)
**Тесты:** test/libraryVersionRepair.test.js, test/catalogLink.test.js (логика, которую вызывает панель); `node --test test/libraryVersionRepair.test.js test/catalogLink.test.js`

## Назначение
У игры было два места с деталями: боковая панель главного окна и отдельное окно «Edit Game Details», которое открывалось из контекстного меню «View Details». Окно дублировало панель, устарело визуально и жило своей жизнью (отдельные события прогресса, свой список версий). Всё полезное из него перенесено в панель, окно удалено.

## Для пользователя
- **View Details** в контекстном меню карточки открывает боковую панель игры в главном окне.
- В панели:
  - шапка с названием и автором, баннер; при наведении на баннер — **обновить баннер** и **убрать сохранённый баннер**;
  - бейджи движка/статуса/рейтинга, **Not matched** и **Link to catalog…** для игр без записи каталога, **карандаш** — изменить название, автора, движок;
  - «Installations»: состояние, «Site latest» (с подсказкой, если версия взята из темы F95), кнопка установки/обновления;
  - у каждой версии: **Play**, либо **Choose .exe** (не выбран файл запуска), либо **Locate…** (папка пропала); **Open**; **удалить версию**;
  - избранное, страница игры, удаление игры;
  - сведения с сайта, облачные сохранения, скриншоты с кнопками **скачать заново** и **убрать сохранённые**.
- Панель закрывается по Esc или крестику, ширина меняется перетаскиванием левого края.

## Как это работает
Что куда переехало из `GameDetailsWindow.jsx`:

| Было в окне | Стало |
|-------------|-------|
| Поиск в Atlas + `add-atlas-mapping` | `CatalogLinkModal` + IPC `link-game-to-catalog` (плюс тема F95, метаданные, картинки) |
| Правка title/creator/engine (`update-game`) | `DetailsMetadataEditor` в панели; `update-game` теперь проверяет вход и возвращает `{ success, error }` |
| Правка пути и exec вручную (`update-version`) | Locate… и Choose .exe с проверкой путей в main (library-version-repair.md) |
| Удаление версии (`count-versions`, `delete-version`) | Кнопка у версии; последняя версия → окно удаления игры |
| Баннер/скриншоты: скачать, удалить (`update-banners`, `update-previews`, `delete-banner`, `delete-previews`) | `onImageAction` панели → `handleImageAction` в `App.jsx`, прогресс во всплывающем сообщении |
| Свой баннер из файла (`convert-and-save-banner`) | не перенесено (канал оставлен в main) |
| Удаление игры | Общее окно `DeleteGameModal` |

Удалено: `src/gamedetails.html`, `src/core/banner/GameDetailsWindow.jsx`, `createGameDetailsWindow`, события `send-game-data` и `game-details-import-progress` (в том числе из `downloadImages`, `update-banners`, `update-previews`), методы моста `onGameData`, `onGameDetailsImportProgress`, `removeGameDetailsImportProgressListener`, запись `src/gamedetails.html` в `build.files`. Отправки `import-progress` в главное окно сохранены.

`handleContextAction` теперь пересылает в рендерер `properties`, `locateGame`, `chooseExecutable` (и прежние `removeGame`, `updateGame`, избранное, пункты пересканирования); `App.jsx` открывает панель по `properties` через `getGame`.

Панель тонкая: IPC-вызовы и тексты ошибок, логика — в main и shared-модулях. Изменения из панели применяются через `onGameChanged` (= `applyUpdatedGameToState`), картинки — через `onImageAction`. При событии `game-updated` для открытой игры рендерер перечитывает и её скриншоты.

## Контракт
Props панели (добавлены): `onLocateVersion(version, game)`, `onGameChanged(updatedGame)`, `onLinkCatalog(game)`, `onImageAction(action, game)` c `action ∈ refreshBanner | removeBanner | refreshScreenshots | removeScreenshots`.

IPC:
- `update-game` `{ record_id, title, creator, engine }` → `{ success, error? }` (раньше ничего не возвращал и бросал исключение).
- `delete-version` `{ recordId, version }` → `{ success, wasLastVersion, error? }`, после успеха `game-updated`.
- `update-banners`, `update-previews`, `delete-banner`, `delete-previews` — без изменений контракта, без событий прогресса.
- `window.formatDetailRelativeTime(value)` — «5 min ago», «2 h ago», используется панелью и разделом Updates.

## Граничные случаи и ошибки
- Игра удалена, пока панель открыта → панель закрывается (событие `game-deleted`).
- Одинаковые title+creator+engine при правке → «Another game in your library already has this title, creator and engine».
- У игры нет записи каталога → кнопки скачивания картинок скрыты, есть Link to catalog….
- Нет сети при скачивании картинок → сообщение об ошибке, старые картинки остаются.

## Проверка
Вручную: правый клик по карточке → View Details → открывается панель (не новое окно); карандаш → правка → сохранение; удаление второй версии; наведение на баннер → обновить. Сборка `npm run build` не содержит `gamedetails.html`.

Покрытие: логика вызовов — тесты модулей выше; интерфейс — браузерный смоук в web-превью (Choose .exe, Locate, Link to catalog, Edit, удаление версии, подсказка «from the F95 thread»).

## История изменений
- 2026-09-27 — окно «Edit Game Details» удалено, его функции перенесены в боковую панель.
