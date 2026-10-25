# Ссылки F95 через страницу загрузки (`/dl/`)

**Статус:** active
**Модули:** src/main/f95/hosts/f95.js (`resolveF95DownloadPage`, `parseF95DownloadPageLink`, `decodeF95DownloadCode`), src/main/f95/hosts/index.js (хост `f95-dl`, `getMirrorHostInfo(url, {hostHint})`), src/main/f95/threadInspector.js, src/main/f95/threadLinks.js, src/main/f95/downloadLinkRefresh.js, src/main/f95/mirrorFallback.js, src/main.js (`runF95DownloadContext`), scripts/check-mirrors.js (`--thread`)
**Тесты:** test/f95DownloadPageLinks.test.js; `node --test test/f95DownloadPageLinks.test.js` (весь набор — `npm test`)

## Назначение
В октябре 2026 F95zone убрал из стартовых постов ссылки `f95zone.to/masked/<хост>/…` и заменил их ссылками на собственную страницу загрузки `f95zone.to/dl/<пост>/?u=…&k=…&r=…&t=…`. Страница показывает игру, выбранное зеркало и кнопку «Continue to <хост>», и только после неё отправляет на файлообменник. Приложение перестало находить зеркала в теме («ссылок нет»), установка и обновление игр не начинались. Фича возвращает установку: приложение снова видит зеркала, проходит страницу загрузки само и не трогает скрытую ссылку-ловушку, которую F95 ставит для ботов.

## Для пользователя
- Ничего включать не нужно: установка и обновление из F95 работают как раньше — выбираете сборку и зеркало (Pixeldrain, MEGA, Gofile, Buzzheavier…), загрузка начинается сама.
- Нужен вход в аккаунт F95 в приложении: без него F95 не показывает ссылки на скачивание.
- Ссылки F95 действуют несколько часов после открытия страницы игры. Если вы нажали **Retry** позже или загрузка долго стояла в очереди, приложение само перечитает страницу игры и возьмёт свежую ссылку того же зеркала.
- Если F95 попросит пройти проверку (капчу) на странице загрузки, откроется окно с этой страницей — пройдите проверку и нажмите **Continue**, загрузка продолжится сама (см. [mirror-browser-step.md](mirror-browser-step.md)).
- Если появилось «This F95 download link has expired…» и повтор не помог — откройте игру в приложении заново: автор мог изменить пост, и старого зеркала в нём больше нет.

## Как это работает
1. **Разбор темы** (`threadInspector.js`, скрипт в скрытом окне с сессией `persist:f95-auth`). Ссылки `/dl/<цифры>/` теперь считаются кандидатами наравне с `/masked/` и `/attachments/`. Для каждой ссылки собираются:
   - `faviconHost` — хост из фавиконки, которую F95 рисует в `style` ссылки (`…/ip3/<хост>.ico`): это единственное место, где виден реальный хост;
   - `isHidden` — ссылка спрятана от людей: `tabindex="-1"` или сама ссылка/предок внутри поста имеет `hidden`, `aria-hidden="true"`, класс `u-hidden`, inline `display:none`/`visibility:hidden`. Такой текст не попадает и в подпись строки.
2. **Классификация** (`threadLinks.js`). `isHidden` → ссылка отбрасывается сразу. Подсказка хоста: подпись ссылки → подпись строки → `faviconHost` (подписи первыми — так совпадают сохранённые предпочтения зеркал из эпохи masked). Подпись и уровень поддержки (`hostLabel`, `support`) берутся по `faviconHost`, как раньше по хосту из пути masked-ссылки. Фавиконка самого F95 подсказкой не считается; строки разделов вроде «Extras:» по-прежнему отсекаются.
3. **Резолв** (`resolveF95DownloadPage`, хост `f95-dl` в реестре, `internal`):
   - GET страницы `/dl/…` (шаблон `f95dl_check`); форма с классом `f95dl-box` (формы в HTML-комментариях игнорируются);
   - в форме есть капча → `MirrorActionRequiredError` `captcha_required` с `actionUrl` = ссылка `/dl/`;
   - поле с классом `js-f95dlCode` (`w`) заполняется из `data-code` корня `f95dl-page`: «c» + base64 перевёрнутой строки — так же, как делает скрипт страницы `downloadlinks/page.js`;
   - пауза до 2,1 с от открытия страницы: сервер требует больше одной полной секунды;
   - POST формы (`_xfToken`, `had_check`, `w`) с `Referer`/`Origin`, без автоследования редиректов;
   - ответ: 3xx на внешний хост, либо страница `f95dl_go` — `data-url`, затем `meta refresh`, затем ссылка «Nothing happening?». Полученный URL идёт дальше по цепочке хостов (Pixeldrain, MEGA, …).
4. **Истёкшие ссылки** (`downloadLinkRefresh.js`). Параметры `r` (время открытия страницы) и `t` меняются при каждом открытии темы, а `k` и номер поста — нет. Ошибка `link_expired` → тема перечитывается один раз за запуск загрузки, ссылка с тем же `пост:k` подставляется вместо старой (в кандидатов и `context.request`), резолв повторяется.
5. **Перебор зеркал** (`mirrorFallback.js`): капча на `/dl/` закрывает все зеркала F95 сразу, поэтому цепочка останавливается и открывается окно шага, как было для masked.
6. **Подписи хоста** в main.js (`createF95DownloadContext`, `describeCandidate`, `adoptF95FallbackCandidate`, восстановление записей) передают `hostHint` — иначе вместо «Pixeldrain» было бы «F95zone download page».

Почему не открываем `/dl/` в окне и не кликаем: страница работает и без окна, а скрытый запрос дешевле и не мигает окнами; окно остаётся только для капчи.

## Контракт
- Формат ссылки: `https://f95zone.to/dl/<postId>/?u=<userId>&k=<12 hex>&r=<unix>&t=<token>`; `parseF95DownloadPageLink(url)` → `{postId, key, renderedAt}` или `null`.
- `resolveF95DownloadPage(ctx, url)` → строка URL хоста. Ошибки (`MirrorError.code`): `link_expired` (не retryable), `masked_link_failed` (сообщение форума; «не принял проверку» — retryable), `invalid_response` (retryable), HTTP-коды через `createHttpError`; `MirrorActionRequiredError` `captcha_required` для капчи и Cloudflare.
- `getMirrorHostInfo(url, {hostHint})`: для `/dl/` с подсказкой — описание хоста подсказки и `masked: true`; без подсказки — `hostId: "f95-dl"`, `label: "F95zone download page"`.
- Поля сырой ссылки из инспектора: `faviconHost`, `isHidden` (плюс прежние `url`, `label`, `lineText`, …).
- `createF95LinkRefresher({threadUrl, inspectThread})`, `prepareWithFreshF95Link(url, prepare, refresher, onRefreshed)`, `findFreshF95DownloadLink(staleUrl, links)`.
- Константа `F95_DOWNLOAD_CODE_DELAY_MS = 2100`. Настроек нет.

## Граничные случаи и ошибки
- Скрытая ссылка-ловушка (по одной в каждом проверенном посте, с настоящей подписью вроде «DATANODES») никогда не открывается: её нет ни в списке зеркал, ни в `check:mirrors --thread`.
- Не вошли в F95 — ссылок `/dl/` в теме нет, установка сообщает о необходимости входа (как раньше).
- Ссылка истекла, а тему перечитать не удалось (нет сети, автор убрал зеркало) — исходная ошибка `link_expired` с подсказкой открыть игру заново.
- F95 вернул страницу проверки повторно без капчи — повтор резолва (до 3 попыток); с капчей — окно шага.
- Cloudflare/DDoS-защита F95 на `/dl/` — окно шага на ссылке `/dl/`.
- Старые masked-ссылки (если где-то остались) обрабатываются прежним кодом.
- Хосты без отдельной поддержки (AkiraBox, UploadNow, Bunkr…) теперь видны по фавиконке и пробуются общим резолвером; в рекомендациях они ниже известных хостов.

## Проверка
1. Автотесты: test/f95DownloadPageLinks.test.js — классификация `/dl/` по подписи и фавиконке, отсев ловушки и раздела Extras, `getMirrorHostInfo` с подсказкой, разбор ссылки и кода, POST формы с паузой, редирект и `meta refresh`, цепочка `/dl/` → Pixeldrain, истёкшая ссылка, капча, повтор проверки, остановка перебора на капче, обновление истёкшей ссылки (одно чтение темы на запуск).
2. Живая проверка (2026-10-25, аккаунт пользователя): `npm run check:mirrors:app -- --thread https://f95zone.to/threads/211604/ --only pixeldrain --platform windows` — PASS, `NTR-Phone-0.48.0-windows.zip` 181 МБ, zip цел. MEGA резолвится в прямую ссылку хранилища. В 7 популярных темах (NTR Phone, Being a DIK, Summertime Saga, Eternum, Karryn's Prison, Wild Life, Sophia Parker) все зеркала найдены, ловушка отсеяна.
3. Вручную в приложении: войти в F95 → открыть игру → Install → выбрать Pixeldrain. Ожидается статус «Resolving F95zone download page link» → «Resolving Pixeldrain link» → загрузка → установка.

## История изменений
- 2026-10-25 — первая версия: F95 заменил masked-ссылки страницей загрузки `/dl/`; поддержка страницы, фавиконки как источника хоста, отсев скрытой ловушки, обновление истёкших ссылок.
