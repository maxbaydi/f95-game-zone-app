# Шаг в браузере с автопродолжением загрузки

**Статус:** active
**Модули:** src/main/f95/mirrorActionFlow.js, src/main/f95/electronSession.js, src/main.js (`startF95MirrorActionFlow`, `openF95MirrorActionWindow`, `adoptF95ActionContext`, IPC `open-f95-download-action`), src/main/f95/downloadsStore.js (статус `action`), src/core/downloads/DownloadsPanel.jsx
**Тесты:** test/mirrorActionFlow.test.js, test/downloadsStoreAction.test.js, test/electronSession.test.js, test/resolverTargetProbe.test.js; `npm test`

## Назначение
Часть зеркал требует человека один раз: капча, проверка Cloudflare, страница-прокладка. Раньше загрузка падала в «Failed», пользователь открывал зеркало, проходил проверку и вручную жал «Retry». Теперь приложение само открывает страницу в встроенном окне, а после прохождения проверки продолжает загрузку без участия пользователя.

## Для пользователя
1. Запускаете установку или обновление игры как обычно.
2. Если зеркало просит проверку, открывается окно браузера с этой страницей, а в панели загрузок запись получает статус **Your turn** с подсказкой.
3. Пройдите капчу или проверку в окне. Ничего нажимать в приложении не нужно: как только зеркало пропустит, окно закроется и начнётся загрузка.
4. Если вы на странице зеркала нажали «Download» сами — эта загрузка тоже подхватывается приложением и устанавливается как обычно.
5. Закрыли окно, не пройдя проверку, — запись перейдёт в «Failed» с кнопкой **Finish in browser**, которая откроет окно заново. Кнопка **Cancel** доступна всё время ожидания. Через 15 минут без результата ожидание прекращается с той же кнопкой.

## Как это работает
- `createMirrorActionFlow` (чистый модуль, окно и таймеры инжектируются) открывает `actionUrl` в окне, подписывается на навигацию и закрытие, и «тихо» перерезолвливает зеркало: через 1,2 с после каждой навигации и каждые 5 с по таймеру. Попытки не пересекаются: навигация во время попытки ставит одну дополнительную в очередь.
- Успешный резолв → `stop()` (окно закрывается, таймеры сняты) → `onResolved(prepared)`; main.js стартует передачу (`startDirectF95Download` или сессионную).
- `MirrorActionRequiredError` во время ожидания — продолжаем ждать; если у ошибки другой `actionUrl`, окно переводится на него. Транзиентные ошибки (сеть, таймаут) — продолжаем. Прочие (`not_found`, `access_denied`) — `onGaveUp(error)`.
- Окно живёт в партиции `persist:f95-auth`, как и загрузчик. Но `session.fetch`/`net.request` из main-процесса **не прикладывают cookies** (проверено на Electron 37, даже с `credentials: "include"`), а `cookies.get({url})` не видит доменные cookies вроде `.bzzhr.to`/`cf_clearance`. Поэтому все HTTP-запросы загрузчика идут через обёртку `createElectronResolverSession` (src/main/f95/electronSession.js): она сама подбирает cookies партиции под URL (правила из cookieJar.js) и кладёт их в заголовок `Cookie`, а `redirect: "manual"` обслуживает через `net.request` (у `session.fetch` это «Redirect was cancelled»). Передача использует `session.getUserAgent()` (см. `buildDirectTransferOptions({userAgent})`): Cloudflare привязывает clearance к UA.
- Перерезолв в потоке идёт с `probeTarget`: после резолва целевой URL запрашивается одним байтом, и шаг завершается только когда файл реально отдаётся — иначе окно закрывалось бы раньше, чем Cloudflare выдаст clearance.
- `will-download` в main.js: если загрузку начал webContents окна шага, контекст ожидания усыновляет её (`adoptDownload()` завершает поток, не закрывая окно) и дальше работает обычный сессионный путь.
- Точки входа: отказ резолвера с `captcha_required` в `runF95DownloadContext`, `MirrorActionRequiredError` при передаче в `startDirectF95Download`, IPC `open-f95-download-action` (кнопка в панели). Отмена и повтор останавливают поток (`stopF95MirrorActionFlow`).

## Контракт
- IPC `install-f95-thread` / `retry-f95-download`: при необходимости шага возвращают `{success: true, queued: true, awaitingAction: true, id, actionUrl, hostLabel}` вместо прежнего `{success: false, code: "captcha_required"}`.
- IPC `open-f95-download-action(id)` → тот же результат; ошибки: «This download can no longer be resumed…», «This download is still running.».
- Запись стора: `status: "action"`, `actionUrl`, `canCancel: true`, `canRetry: false`, `error: ""`.
- Модуль: `createMirrorActionFlow({actionUrl, openWindow, resolveMirror, onResolved, onGaveUp, onStatus?, hostLabel?, pollIntervalMs=5000, navigationDebounceMs=1200, timeoutMs=900000, timers?})` → `{start, stop, adoptDownload, isActive, matchesWebContents, actionUrl}`. Коды ошибок `onGaveUp`: `captcha_required` (окно закрыто), `action_timeout`, коды резолвера.

## Граничные случаи и ошибки
- Пользователь закрыл окно — `error` с `actionUrl`, повтор через кнопку.
- Cancel во время ожидания — окно закрывается, запись `cancelled`, ретрая нет.
- Retry во время ожидания — старый поток останавливается, идёт свежий резолв; если капча снова нужна, окно откроется заново (окно переиспользуется по `reuseKey`).
- Зеркало пропустило, но ссылка ведёт на CDN с отдельной проверкой — передача бросит `MirrorActionRequiredError`, и поток запустится повторно с новым `actionUrl`.
- Ожидание не бесконечно: 15 минут.

## Проверка
1. Вручную: установить игру через Buzzheavier или DataNodes (Cloudflare). Ожидается окно, статус «Your turn», после проверки — «Downloading» без нажатий.
2. Закрыть окно до прохождения — «Failed» + «Finish in browser»; нажать — окно снова открылось.
3. Cancel во время «Your turn» — окно закрылось, запись «Cancelled», `.part` нет.
4. Автотесты: test/mirrorActionFlow.test.js (навигация, опрос, таймаут, закрытие окна, сериализация попыток, adopt, stop), test/downloadsStoreAction.test.js.

## История изменений
- 2026-09-26 — первая версия по запросу: непроходимые автоматически капчи показываются в окне, загрузка продолжается сама.
- 2026-09-26 — обёртка сессии (cookies в заголовке, ручные редиректы через net.request) и зонд цели: без них clearance из окна не доходил до загрузчика (Buzzheavier, Files.fm).
