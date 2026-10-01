# Игры без совпадения с каталогом: автодобавление и привязка

**Статус:** active
**Модули:** src/main/scanCandidateImportPolicy.js, src/main/catalogLink.js, src/shared/libraryInstallState.js (needsCatalogLink, buildCatalogSearchTitle), src/database.js (getCatalogEntry, searchCatalog), src/main/db/f95CatalogStore.js, src/main/libraryMaintenanceIpc.js, src/main.js (scan-library, update-game), src/core/library/CatalogLinkModal.jsx, src/core/library/LibraryDetailsPanel.jsx, src/core/GameBanner.js
**Тесты:** test/scanCandidateImportPolicy.test.js, test/catalogLink.test.js; `node --test test/scanCandidateImportPolicy.test.js test/catalogLink.test.js`

## Назначение
Сканер добавлял в библиотеку только папки с уверенным совпадением в каталоге метаданных; всё остальное (переводы, моды, редкие игры, непривычные имена папок) оседало в Scan Hub и не попадало в библиотеку без ручной проверки каждой папки. Теперь папки, которые явно являются играми, добавляются сразу с пометкой «Not matched», а привязать их к каталогу или поправить название можно прямо из панели деталей.

## Для пользователя
- После сканирования в итоге видно «N of them added without a catalog match». На карточках таких игр — бейдж **Not matched**: у них пока нет баннера, темы F95 и проверки обновлений.
- Откройте игру → **Link to catalog…** → в окне уже введено название без версии (например, `my-game-0.5 [PC]` → `my game`). Поиск идёт по мере ввода; в результатах название, автор, движок и номер темы F95. **Link** — игра получает название, баннер, скриншоты, тему и проверку обновлений.
- Карандаш **Edit** в панели — изменить название, автора и движок вручную. Пока игра связана с каталогом, в библиотеке показывается название из каталога.
- Папки, в которых признаков игры мало (или архивы), по-прежнему ждут проверки в **Scan Hub**; в итоге сканирования есть кнопка **Open Scan Hub**.

Типичные ошибки: «Another game in your library already has this title, creator and engine» при редактировании — такая запись уже есть; «This game could not be linked…» — повторите или выберите другую запись.

## Как это работает
1. `shouldAutoImportScanGame(game, { minUnmatchedDetectionScore = 40 })`: `matched` → да; иначе да, если это не архив и `detectionScore >= 40` (включая `ambiguous`). Оценка 40 — исполняемый файл (30) + единственный кандидат (10) или известный движок (25) и выше; одно имя папки или архив её не набирают, поэтому имя папки не становится единственным доказательством.
2. `splitAutoImportableScanGames` сохраняет прежнее правило для известных путей (`refreshExisting`), совпавшие импортирует как раньше, а новые несовпавшие помечает `importUnmatched: true`. `scan-library` считает `importedUnmatched` и добавляет его в текст итога.
3. `needsCatalogLink(game)` — нет `f95_id` и `siteUrl`; одна реализация в `shared/libraryInstallState.js`, `main/catalogLink.js` её реэкспортирует.
4. `CatalogLinkModal` вызывает `searchCatalog(title, creator)` по локальной таблице `f95_catalog` (автор передаётся, если он не «Unknown») с задержкой 350 мс, затем `linkGameToCatalog({ recordId, f95Id })`.
5. `linkGameToCatalog`: проверка id → `getCatalogEntry(f95Id)` (нет записи → `CATALOG_LINK_FAILED`) → `upsertF95ZoneMapping(recordId, String(f95Id), siteUrl)` → метаданные каталога (title/creator/engine, непустые значения каталога важнее) через `updateGame`. Ошибка на шагах связи → `CATALOG_LINK_FAILED`; ошибка только при записи названий связь не отменяет (`metadataUpdated: false`, предупреждение в логе), потому что повтор дал бы тот же результат.
6. IPC после успеха удаляет запись живой версии темы (тема могла смениться), шлёт `game-updated` и в фоне скачивает баннер и скриншоты (`downloadImages(…, true, true, DEFAULT_PREVIEW_LIMIT, false)`), затем снова `game-updated`.
7. `update-game` проверяет вход (id, непустое название, длины) и возвращает `{ success, error }` вместо исключения; пустые автор/движок сохраняются как «Unknown».

## Контракт
- `scan-library` → дополнительно `importedUnmatched: number`.
- `link-game-to-catalog` `{ recordId, f95Id }` → `{ success, f95Id, siteUrl, metadataUpdated, game }` / `{ success:false, code: INVALID_INPUT | CATALOG_LINK_FAILED, error }`. Лог `[library.catalog]`.
- `update-game` `{ record_id, title, creator, engine }` → `{ success, error? }`.
- `getCatalogEntry(f95Id) → запись f95_catalog | null`; `getCatalogEntryForRecord(recordId)`.
- Константа `MIN_UNMATCHED_DETECTION_SCORE = 40`.

## Граничные случаи и ошибки
- Запись каталога без темы F95 → связь создаётся, `f95Id = ""`, сообщение о том, что обновления проверить нельзя.
- Игра удалена во время поиска → `INVALID_INPUT` («This game is no longer in your library»).
- Каталог ещё не загружен (нет сети при первом запуске) → поиск пустой, «Nothing found…».
- Известная папка с плохим совпадением обновляется как раньше и не считается «added without a catalog match».

## Проверка
Вручную: папка с игрой, которой нет в каталоге → Find New Games → карточка с «Not matched» → Link to catalog… → Link → бейдж исчез, баннер появился. Edit → изменить автора → сохранено.

Тесты: `scanCandidateImportPolicy.test.js` — порог, архивы, флаг `importUnmatched`, известные пути; `catalogLink.test.js` — связь с темой и без, метаданные каталога, ошибки ввода и связи, `needsCatalogLink`. Браузерный смоук: бейдж, окно с предзаполненным поиском, привязка, редактирование.

## История изменений
- 2026-09-27 — автодобавление явных игр без совпадения, бейдж «Not matched», Link to catalog…, редактирование названий в панели.
