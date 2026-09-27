# Массовые действия для игр с отсутствующими файлами

**Статус:** active
**Модули:** src/shared/missingGamesActions.js, src/App.jsx (панель над сеткой, startReinstallMissingGames, pumpReinstallQueue, removeAllMissingGames), src/main/f95/downloadsStore.js (updatedAt записей)
**Тесты:** test/missingGamesActions.test.js; `node --test test/missingGamesActions.test.js`

## Назначение
После переноса библиотеки или отключения диска в фильтре «Files missing» может оказаться много игр. Переустанавливать или удалять их по одной долго. Панель массовых действий позволяет переустановить все игры, у которых есть тема F95, по очереди, или убрать все такие записи из библиотеки одним действием.

## Для пользователя
1. В строке над сеткой выберите **Show → Files missing**.
2. Над карточками появится полоса «N games have missing files» с кнопками:
   - **Reinstall all** — игры скачиваются заново по одной с их тем F95 и ставятся в папку библиотеки. Перед стартом приложение спрашивает подтверждение и сообщает, сколько игр без темы будет пропущено. Ход виден в полосе и во всплывающем сообщении («Reinstalling 2 of 5: Title»); кнопка **Stop** останавливает очередь (уже начатая загрузка продолжится в Downloads).
   - **Remove all from library** — после подтверждения записи удаляются из библиотеки. Файлы на ПК и сохранения не трогаются; при включённых облачных сохранениях игры уходят и из библиотеки аккаунта (как при обычном «Just remove it from my library»).
3. По окончании переустановки — итог: сколько установлено, сколько с ошибкой, сколько ждут вашего действия в браузере (капча), для скольких не нашлось зеркала и какие игры нельзя переустановить автоматически. Кнопка **Details** показывает список по играм.

Если вы не вошли в F95, вместо запуска появится сообщение с кнопкой **Sign in to F95**. Если игра была просто перенесена — используйте **Locate…** в её деталях (см. library-version-repair.md).

## Как это работает
1. `selectMissingGames` берёт игры с `installState = missing` (через `getLibraryInstallState`), `partitionReinstallableGames` делит их на имеющие `siteUrl` и без темы.
2. Очередь — чистые функции без мутаций: `createReinstallQueue` → `{ pending, active, activeStartedAt, done, isFinished }`. `advanceReinstallQueue(queue, downloads, now)`:
   - если активная игра есть, ищется её загрузка (`findDownloadForGame`: совпадение `threadUrl` через `normalizeThreadKey`, самая свежая по `updatedAt`), учитываются только записи с `updatedAt >= activeStartedAt` — старая история не завершает новый шаг;
   - терминальные статусы (`completed`, `error`, `cancelled`, `action`) переносят игру в `done` как `{ game, status }`;
   - затем следующая игра из `pending` становится активной и возвращается как `next`; когда ничего не осталось — `isFinished`.
3. `App.jsx` на каждый `next`: `inspectF95Thread({ threadUrl })` → если есть `recommendation.linkUrl` — `installF95Thread` с тем же набором полей, что у диалога обновления (`buildF95UpdateInstallPayload`), включая `fallbackLinks`; `threadUrl` = ссылка из библиотеки, чтобы запись загрузки гарантированно совпала с игрой даже при редиректе темы. Нет рекомендации → `markReinstallStepFailed(queue, "no_mirror")`; ошибка темы или запуска → `"error"`.
4. Очередь продвигается из эффекта на `f95Downloads.items` (события `f95-downloads-changed`); состояние очереди и списка загрузок хранится в ref, чтобы шаг и эффект не гонялись. Пока шаг запускается (`inspect`/`install`), эффект ничего не делает.
5. Удаление — последовательные вызовы `removeLibraryGame({ recordId, mode: "library_only" })`; список обновляется событиями `game-deleted`.

Решение: шаги строго по одному — параллельные загрузки нескольких больших игр перегружают зеркала и чаще упираются в капчу.

## Контракт
Модуль `shared/missingGamesActions.js` (UMD: `module.exports` + `window.missingGamesActions`): `REINSTALL_TERMINAL_STATUSES`, `selectMissingGames`, `partitionReinstallableGames`, `normalizeThreadKey`, `isTerminalDownloadStatus`, `createReinstallQueue`, `findDownloadForGame(downloads, game, notBefore?)`, `advanceReinstallQueue(queue, downloads, now) → { queue, next, finished }`, `markReinstallStepFailed(queue, status)`, `summarizeReinstallQueue(queue) → { completed, failed, needsAction, noMirror }`.

Статусы шага: `completed`, `error`, `cancelled`, `action`, `no_mirror`. Записи загрузок содержат `threadUrl`, `status`, `updatedAt` (ставится хранилищем при каждом изменении).

## Граничные случаи и ошибки
- Нет сессии F95 → очередь не запускается, показывается вход.
- Нет ни одной игры с темой → предупреждение «Nothing to reinstall».
- Капча/Cloudflare у зеркала → загрузка в статусе `action`, игра попадает в «need your action», очередь идёт дальше.
- **Stop** → очередь очищается, текущая загрузка не отменяется.
- Приложение закрыто во время очереди → очередь не восстанавливается (незавершённые игры остаются «Files missing»).
- Удаление одной игры не удалось → остальные продолжаются, итог перечисляет неудачные.

## Проверка
Вручную: переименуйте папки 2–3 игр с темами → Re-check → Show: Files missing → Reinstall all → подтверждение → в Downloads игры появляются по одной, итог после последней. Remove all from library → подтверждение → список пуст, «No games match this filter» с кнопкой «Show all games».

Тесты: `missingGamesActions.test.js` — отбор и разбиение, нормализация ссылок, выбор самой свежей загрузки, пошаговое продвижение, игнорирование устаревших записей, пропуск шага без зеркала. Браузерный смоук: запрос входа, подтверждение, вызов `installF95Thread` с верными полями, прогресс, Stop, итог «without a mirror / cannot be reinstalled automatically», массовое удаление.

## История изменений
- 2026-09-27 — добавлены Reinstall all и Remove all from library для фильтра «Files missing».
