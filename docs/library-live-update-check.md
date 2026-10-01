# Проверка обновлений по живым темам F95

**Статус:** active
**Модули:** src/main/liveUpdateCheck.js, src/main/db/liveVersionsStore.js, src/main/db/migrations/011_library_live_versions.js, src/shared/versionUpdate.js (pickNewerVersion), src/database.js (GAME_METADATA_JOINS, getGame/getGames), src/main.js (createLibraryLiveUpdateChecker, noteF95AuthStateForLiveChecks), src/main/libraryMaintenanceIpc.js, src/App.jsx (Updates), src/core/library/LibraryDetailsPanel.jsx
**Тесты:** test/liveUpdateCheck.test.js, test/databaseVersionLocation.test.js, test/migrations.test.js; `node --test test/liveUpdateCheck.test.js test/databaseVersionLocation.test.js test/migrations.test.js`

## Назначение
Каталог метаданных обновляется пакетами и отстаёт от сайта на дни, поэтому «Update available» появлялся поздно. Название темы F95 всегда содержит текущую версию. Приложение само читает темы установленных игр и показывает обновление, как только оно вышло.

## Для пользователя
- При входе в F95 избранные установленные игры проверяются автоматически: через полторы минуты после запуска, сразу после входа в F95 и затем каждые шесть часов. Проверка идёт в фоне по одной теме с паузами.
- Раздел **Updates**: кнопка **Check threads now** проверяет все установленные игры с темой (избранные первыми, до 40 за раз). Рядом — «Threads checked 2 h ago». Итог: сколько проверено, найдено новых версий и неудачных проверок. Без входа — «Sign in to F95 first» с кнопкой входа.
- В деталях игры «Site latest: 1.2 (from the F95 thread, checked 2 h ago)», если версия взята из темы.
- Новые версии попадают в раздел Updates и в уведомление об обновлениях (если оно включено в настройках).

## Как это работает
1. `createLiveUpdateChecker` (main) получает `listGames = loadLibraryGames`, `inspectThread = inspectF95Thread` (скрытое окно с сессией F95), `saveResult = upsertLiveVersion`, `isAuthenticated` по cookie `xf_user`.
2. `selectLiveUpdateTargets`: установленные игры (`installState = installed`; без поля — есть версии) с `siteUrl`; избранные первыми (только избранные при `favoritesOnly`); пропуск проверенных меньше `staleAfterMs` назад, если не `force`; затем `limit`.
3. `runNow({ reason, force, favoritesOnly })`: второй вызов во время прогона возвращает тот же промис; без сессии → `skippedReason: "not_authenticated"`; темы по одной с `sleep(delayBetweenMs)`; успех → версия и заголовок, `updated`, если версия непустая и отличается от сохранённой; ошибка или `success:false` → запись с пустой версией и текстом ошибки. `start()` планирует прогон через `intervalMs` и после каждого прогона — следующий; `stop()` снимает таймер.
4. После прогона с `checked > 0` main шлёт `game-updated` по каждой проверенной записи и вызывает `libraryUpdateNotificationController.syncFromAllGames` (уведомления по настройке `Notifications.libraryUpdates`). Рендерер собирает `game-updated` пачками по 100 мс и обновляет каждую запись (раньше debounce терял все, кроме последней).
5. Хранение: таблица `library_live_versions` (миграция 011). Неудачная проверка той же темы сохраняет последнюю успешно прочитанную версию, обновляя время и текст ошибки; для другой темы версия сбрасывается. Привязка к каталогу удаляет запись (тема могла смениться).
6. `getGame`/`getGames` присоединяют `library_live_versions`, отдают `atlasLatestVersion`, `liveVersion`, `liveCheckedAt` и `latestVersion = pickNewerVersion(atlas, live)` до `buildVersionUpdateState` — более старая версия темы никогда не понижает версию каталога.
7. Вход в F95: `broadcastF95AuthState` отмечает переход «не вошёл → вошёл» и запускает прогон через 10 с (серия изменений cookie не запускает его повторно); состояние при запуске прогон не вызывает.

Решение и альтернативы — ADR 0009.

## Контракт
- `check-live-updates` `{ force?, favoritesOnly? }` → `{ success, checked, updated, failed, skippedReason ("" | "not_authenticated" | "error"), finishedAt, error? }`.
- `get-live-update-state` → `{ running, nextRunAt (мс | null), lastRun: { reason, finishedAt, checked, updated, failed, skippedReason } | null }`.
- `LIVE_UPDATE_DEFAULTS = { favoritesOnly: true, intervalMs: 6 ч, staleAfterMs: 6 ч, delayBetweenMs: 1500, limit: 40 }`; первый прогон через 90 с после запуска.
- Таблица: `library_live_versions(record_id PK → games, thread_url, version, title, checked_at, last_error)`; удаляется вместе с игрой (`deleteGameCompletely`), очищается сбросом библиотеки, восстанавливается из копии.
- Store: `upsertLiveVersion(db, { recordId, threadUrl, version, title, checkedAt, error })`, `getLiveVersion(db, id)`, `deleteLiveVersion(db, id)`.
- Лог-префикс `[library.live]`.

## Граничные случаи и ошибки
- Нет входа в F95 → прогон пропускается, ничего не открывается.
- Тема без ссылок на скачивание / недоступна / таймаут → ошибка сохраняется, известная версия остаётся.
- Версия в заголовке «Final» → считается новее числовой.
- Игра «Files missing» или «Not installed» → не проверяется, «Update» для неё не показывается.
- Ручная проверка во время фоновой → ждёт тот же прогон.
- Закрытие приложения → таймеры снимаются.

## Проверка
Вручную: войдите в F95, в Updates нажмите Check threads now → итог; у игры с отставшим каталогом появится «Update available» и подсказка «from the F95 thread». Выйдите из F95 → кнопка сообщает о необходимости входа.

Тесты: `liveUpdateCheck.test.js` — отбор целей, `pickNewerVersion`, запись версий и ошибок, пропуск без сессии, общий промис, таймер; `databaseVersionLocation.test.js` — `latestVersion` из темы, отсутствие понижения, удаление с игрой; `migrations.test.js` — миграция 11. Браузерный смоук: кнопка, спиннер, итог, сообщение о входе, подпись «Threads checked …».

## История изменений
- 2026-09-27 — фоновая и ручная проверка тем, таблица `library_live_versions`, `latestVersion` = новее из каталога и темы.
