# Живая проверка зеркал (`check:mirrors`)

**Статус:** active
**Модули:** scripts/check-mirrors.js, src/main/f95/transferOptions.js, src/main/f95/cookieJar.js, src/main/f95/hosts/common.js (`fetchWithCookieJar`)
**Тесты:** test/f95TransferOptions.test.js, test/cookieJarSession.test.js, test/f95HostFixtures.test.js; `npm test`

## Назначение
Резолверы файлообменников ломаются, когда хост меняет разметку или API. Скрипт прогоняет реальные ссылки через тот же код, что и приложение (резолвер → конвейер передачи → проверка пакета), и даёт таблицу PASS / ACTION_REQUIRED / FAIL с SHA-256 и проверкой целостности архива. Нужен разработчику; пользователь его не видит.

## Для пользователя
н/п (инструмент разработчика).

## Как это работает
1. `createCookieJarSession` (src/main/f95/cookieJar.js) — сессия-шим для Node: cookie-jar в памяти с семантикой Electron `session.cookies`, `fetch` через `fetchWithCookieJar`. Та же функция служит запасным путём в приложении, когда `session.fetch` падает.
2. `fetchWithCookieJar` следует редиректам по хопам (как Chromium): куки подставляются на каждом хопе, `Set-Cookie` сохраняется в jar, при смене origin убираются `cookie`/`authorization`, 303 и 301/302 после POST превращаются в GET.
3. `prepareF95DownloadUrl` → `downloadToFile(buildDirectTransferOptions(...))` → `inspectDownloadedPackage`. Опции передачи строятся в src/main/f95/transferOptions.js — единственное место, которое использует и `startDirectF95Download` в main.js, и скрипт, поэтому расхождений нет.
4. После загрузки: SHA-256, сравнение размера с заявленным хостом и `Content-Length`, `7za t` (7zip-bin) для zip/7z/rar.
5. `--simulate-drop N` подменяет тело первого ответа потоком, который обрывается после N байт ошибкой `ECONNRESET`; скрипт проверяет, что следующий запрос ушёл с `Range` и получил 206.
6. `--capture <dir>` пишет каждый текстовый ответ резолверов (HTML/JSON + метаданные) — из них делаются обезличенные фикстуры в `test/fixtures/hosts/<host>/`.
7. `--thread <url>` скачивает тред F95 и извлекает зеркала стартового поста тем же классификатором, что и приложение (`normalizeThreadDownloadLinks`). Гостям F95 ссылки не показывает — нужны `--cookies`.

## Контракт
```
npm run check:mirrors -- [опции] <url> [<url> ...]
  --file <links.txt>       ссылки по одной в строке; "# комментарий"; "url  # заметка"; "url expect=ACTION_REQUIRED"
  --thread <url>           тред F95 (повторяемо); --all-variants — все платформы, не только --platform
  --cookies <cookies.txt>  Netscape-экспорт cookies (логин F95 для masked-ссылок)
  --jar <file.json>        cookie-jar между запусками (гостевой аккаунт Gofile, cf_clearance)
  --out <dir>              папка загрузок (по умолчанию <tmp>/f95-check-mirrors); --keep — не удалять файлы
  --only <hostId,...>      только эти хосты (см. --list-hosts)
  --simulate-drop <bytes>  обрыв первой передачи и проверка докачки
  --platform <hint>        windows | linux | mac | android (по умолчанию windows)
  --capture <dir>          сохранить ответы резолверов
  --json <file>            машинный отчёт
  --timeout <ms>           таймаут запроса (30000)
  --user-agent <ua>        UA сессии (должен совпадать с браузером, выдавшим cf_clearance)
  --accept-any             PASS для не-игровых файлов (публичные тестовые файлы)
  --dry-run                показать список ссылок и выйти
```
Статусы: `PASS` — файл скачан, размер и архив верны; `ACTION_REQUIRED` — хост требует шаг в браузере (ожидаемо для хостов `support: "browser"`, для автоматических помечается `!`); `FAIL` — ошибка резолвера, передачи или проверки. Код выхода: 0 — нет FAIL и неожиданных ACTION_REQUIRED; 1 — есть; 2 — ошибка аргументов.

## Граничные случаи и ошибки
- Cloudflare-челлендж: Node-fetch не проходит проверку TLS-отпечатка (Buzzheavier, DataNodes, FuckingFast). В приложении запросы идут через Chromium (`session.fetch`), а после шага в окне cf_clearance попадает в общую сессию — итог по таким хостам нужно подтверждать в приложении.
- Gofile ограничивает создание гостевых аккаунтов по IP и при злоупотреблении режет соединение на уровне сети; используйте `--jar`, чтобы переиспользовать аккаунт.
- MEGA-ссылки содержат `#` — в links.txt заметкой считается только ` #` с пробелом перед решёткой.
- Файлы без сигнатуры архива и без игрового расширения дают `FAIL payload` (как и в приложении), если не указан `--accept-any`.

## Проверка
1. `npm run check:mirrors -- --simulate-drop 100000 https://www.7-zip.org/a/7za920.zip` — PASS, в логе «resume: Range request accepted with HTTP 206», «archive test (zip): ok».
2. `npm run check:mirrors -- --thread <тред F95> --cookies cookies.txt --dry-run` — список зеркал стартового поста.
3. Офлайн: `npm test` (фикстурные тесты в test/f95HostFixtures.test.js).

## История изменений
- 2026-09-26 — первая версия: скрипт, общий модуль опций передачи, cookie-jar-сессия, редиректы с куками в `fetchWithCookieJar`.
