# Собственный каталог игр (`f95_catalog`)

**Статус:** active
**Модули:** src/main/catalog/f95CatalogParser.js, src/main/f95/threadDetails.js, src/main/db/migrations/013_f95_catalog_thread_details.js, src/main/catalog/f95CatalogSync.js, src/main/db/f95CatalogStore.js, src/main/db/migrations/012_f95_catalog.js, src/database.js (`searchCatalog`, `getCatalogEntry`, `searchSiteCatalog`, `getCatalogFilterOptions`), src/main/scanCatalogMatcher.js, src/main.js (`runLibraryUpdateRefresh`, `catalogSyncJob`, `downloadImages`), src/core/settings/GeneralSettings.jsx
**Тесты:** test/f95CatalogParser.test.js, test/threadDetails.test.js, test/f95CatalogStore.test.js, test/f95CatalogSync.test.js, test/scanCatalogMatcher.test.js, test/catalogLink.test.js, test/migrations.test.js; фикстуры test/fixtures/f95/catalog (см. [пробник](catalog-probe.md))

## Назначение
Каталог метаданных (названия, авторы, версии, движки, статусы, теги, обложки, скриншоты) раньше приходил готовым пакетом с сервера проекта Atlas (`atlas-gamesdb.com`): чужая зависимость, задержка в дни и схема, которую приложение не контролировало. Теперь приложение собирает каталог само из списка «Latest Updates» на F95, куда сайт сам отдаёт все игры постранично в JSON.

## Для пользователя
- Каталог обновляется сам: при старте (как только открыта библиотека), каждые 6 часов и через полторы минуты после пробуждения ПК. Переключатель «Keep the game catalog up to date» в Settings → General → Background work; пункт трея «Refresh Game Catalog» и ручной запуск работают и при выключенном переключателе.
- Нужен вход в F95: без сессии синхронизация пропускается с сообщением в строке статуса.
- Первый запуск читает весь список (около 300 страниц по 90 игр, несколько минут в фоне). Прерванный обход продолжается с той же страницы. Дальше читаются только страницы с новыми обновлениями, обычно одна–две.
- В библиотеке по каталогу работают: сопоставление папок при сканировании, «Link to catalog», название и автор с сайта, обложка и скриншоты, «Site latest» для уведомлений об обновлениях, поиск по сайту с фильтрами по движку, статусу и тегам.

## Как это работает
1. **Источник.** `latest_data.php?cmd=list&cat=games&page=N&rows=90&sort=date` отвечает `{ status, msg: { data[], pagination { page, total }, count } }`; запись содержит `thread_id, title, creator, version, prefixes[], tags[], cover, screens[], rating, likes, views, ts`. Имена префиксов (группы Engine / Status / Other) и тегов лежат в HTML страницы `sam/latest_alpha/` в объекте `latestUpdates`; парсер вырезает его по балансу скобок. Если страница недоступна, используются встроенные определения `DEFAULT_DEFINITIONS` (снимок на 2026-10-01).
2. **Парсер** (`f95CatalogParser`): запись без числового `thread_id` или без названия отбрасывается и считается в `invalid`; движок = первый префикс группы Engine, статус = первый префикс группы Status или `Ongoing`; HTML-сущности декодируются; `cover`/`screens` принимаются только как http(s)-URL; `site_url` всегда каноническая `https://f95zone.to/threads/<id>/`. Ответ-страница входа, `status != ok` и не-JSON распознаются отдельно.
3. **Хранилище** (`f95CatalogStore`): таблица `f95_catalog` с ключом `f95_id`; `upsertCatalogEntries` пишет батч в одной транзакции через `INSERT … ON CONFLICT DO UPDATE … WHERE` (неизменившиеся строки не трогаются, поэтому `changed` и `versionChanged` считают реальные изменения); состояние синхронизации в `f95_catalog_sync` (курсор полного обхода, `newestTs`, определения префиксов/тегов, последняя ошибка).
4. **Синхронизация** (`f95CatalogSync`): режим выбирается сам: `full`, пока полный обход не завершён (курсор `fullNextPage` сохраняется после каждой страницы), затем `incremental` сверху списка до первой записи с `ts <= newestTs`. Если за `maxIncrementalPages` (40) известные записи не встретились, прогон продолжается как полный с текущей страницы. Между страницами пауза 1,2 с; сетевые ошибки, 429 и 5xx повторяются с задержкой 2/4/8 с (4 попытки); 401/403 и страница входа останавливают прогон с кодом `session`; два прогона не пересекаются; `cancel()` останавливает после текущей страницы. Уже записанные страницы при любой ошибке остаются.
5. **Миграция 012**: старые привязки `atlas_mappings` переносятся в `f95_zone_mappings` по `f95_id`; записи старого каталога с темой заливаются в `f95_catalog` с `updated_ts = 0` (первый полный обход их перезапишет); таблицы Atlas и журнал `updates` удаляются. Игры, у которых в старом каталоге не было темы F95, теряют привязку и показываются как «Not matched» до «Link to catalog».
6. **Детали из темы.** `inspectF95Thread` отдаёт `threadDetails` (разбор текста стартового поста по меткам `Overview`, `Thread Updated`, `Release Date`, `Developer`, `Censored`, `Version`, `OS`, `Language`; обзор идёт до следующей метки или секции `Genre`/`Installation`/`Changelog`/`Download`, спойлеры и zero-width символы вырезаются, лимит 4000 символов). `main.js` (`rememberThreadDetails`) пишет их в запись каталога через `setCatalogThreadDetails` на обоих путях: открытие темы в браузере и фоновая проверка версий.
7. **Потребители.** Запрос игр (`GAME_METADATA_SELECT`) соединяет `f95_zone_mappings` с `f95_catalog`: `latestVersion`, `status`, `rating`, `views`, `likes`, `f95_tags`, `remote_banner_url`, `catalog_title/creator/engine`, `catalog_updated_ts`. Сопоставитель сканера индексирует `title`/`creator` всех записей; для двух записей с одинаковым точным названием решает версия (`versionAnchoredSameTitleAutoMatch`). `downloadImages(recordId, f95Id)` берёт обложку и скриншоты из записи каталога.

## Контракт
- IPC: `check-db-updates` → `{ success, total: changed, processed, added, versionChanged, pages, fullDone, entryCount, message, skippedReason, error }`; событие `db-update-progress` `{ text, progress, total }`. `get-catalog-sync-state` → `{ success, state: { fullDone, fullNextPage, totalPages, newestTs, lastRunAt, lastSuccessAt, lastError, entryCount, running, lastSummary } }`. `search-catalog` `{ title, creator, limit }` → записи каталога (camelCase). `get-catalog-entry` `f95Id` → запись | null. `search-site-catalog` без изменений, но поля `censored`, `language`, `replies` больше не заполняются.
- Настройка: `Library.catalogAutoSync` (по умолчанию `true`).
- `summary.skippedReason`: `no-session`, `session`, `network`, `http`, `bad-response`, `cancelled`, `disabled`.

## Граничные случаи и ошибки
- Страница за концом списка сайт отдаёт как последнюю (`pagination.page` меньше запрошенной): полный обход это замечает и завершается.
- Тема, переименованная на сайте, получает новый `title` при следующем обновлении; `site_url` не зависит от слага.
- Определения префиксов обновляются не чаще раза в неделю; новый движок без имени попадает в `prefix_ids`, а движок остаётся пустым до следующего чтения страницы.
- Обзор, дата релиза, цензура, платформы, языки и разработчик в списке отсутствуют: они читаются из стартового поста темы (`threadDetails.js`, миграция 013) каждый раз, когда приложение открывает тему: инспекция перед установкой, живая проверка версий установленных игр. Пустые значения не затирают сохранённые, `details_at` помечает время чтения. Игра без открытой темы показывает «No overview yet».

## Проверка
1. `npm test` — парсер, хранилище, синхронизация и сопоставитель на фикстурах.
2. В приложении с логином F95: Settings → General, строка статуса показывает «Reading the F95 catalog: page N of 306», после завершения «Link to catalog» находит игры, карточки получают обложки.
3. Закрыть приложение в середине первого обхода, открыть снова: обход продолжается со следующей страницы (лог `[catalog.sync]`).

## История изменений
- 2026-10-01 — первая версия: замена внешнего пакета Atlas собственной синхронизацией с F95, миграция 012.
- 2026-10-01 — обзор, дата релиза, цензура, платформы, языки и разработчик из стартового поста темы (миграция 013).
