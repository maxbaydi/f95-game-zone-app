# Живая проверка зеркал (`check:mirrors`)

**Статус:** active
**Модули:** scripts/check-mirrors.js, scripts/check-mirrors-electron.js, src/main/f95/transferOptions.js, src/main/f95/cookieJar.js, src/main/f95/hosts/common.js (`fetchWithCookieJar`, `detectBrowserChallenge`), src/main/f95/hosts/index.js (`probePreparedTarget`)
**Тесты:** test/f95TransferOptions.test.js, test/cookieJarSession.test.js, test/f95HostFixtures.test.js, test/resolverChallengeDetection.test.js, test/resolverTargetProbe.test.js, test/htmlFormsParsing.test.js, test/xfsRedirectAfterPost.test.js, test/dropboxDeletedShare.test.js; `npm test`

## Назначение
Резолверы файлообменников ломаются, когда хост меняет разметку, API или включает Cloudflare. Инструмент прогоняет реальные ссылки через тот же код, что и приложение (резолвер → конвейер передачи → проверка пакета), и даёт таблицу PASS / ACTION_REQUIRED / FAIL с SHA-256, сверкой размера и проверкой целостности архива. Нужен разработчику; пользователь его не видит.

## Для пользователя
н/п (инструмент разработчика).

## Как это работает
Два режима с одним ядром (`run()` в scripts/check-mirrors.js):

- **Node** (`npm run check:mirrors`): сессия-шим `createCookieJarSession` (cookie-jar в памяти, семантика Electron `session.cookies`, `fetch` через `fetchWithCookieJar` с редиректами по хопам). Быстро, без окон. Хосты за Cloudflare с проверкой TLS-отпечатка (Buzzheavier, DataNodes, Files.fm, Send.cm…) дают ACTION_REQUIRED — это ограничение Node-fetch, а не приложения.
- **Electron** (`npm run check:mirrors:app`): та же проверка через сессию приложения — партиция `persist:f95-auth` (логин F95, сделанный в приложении, переиспользуется; `--cookies` импортирует экспорт браузера в неё), Chromium-fetch, и настоящий поток «шаг в браузере» (`createMirrorActionFlow`): страница открывается в окне, зеркало перерезолвливается после навигаций и по таймеру, а загрузка, начатая в окне вручную, усыновляется и проверяется как обычная. Приложение при этом должно быть закрыто (общий профиль; раннер проверяет single-instance lock).

Общие шаги на ссылку: `prepareF95DownloadUrl` → `downloadToFile(buildDirectTransferOptions(...))` (тот же модуль, что использует `startDirectF95Download`) → `inspectDownloadedPackage` → SHA-256, сверка размера с `Content-Length` и заявлением хоста, `7za t` для zip/7z/rar. `--simulate-drop N` обрывает первую передачу после N байт и проверяет, что докачка пошла с `Range` (или `/offset-end` для MEGA) и получила 206.

В потоке шага в браузере резолв идёт с `probeTarget`: после резолва целевой URL запрашивается одним байтом, и шаг считается завершённым только когда файл реально отдаётся (иначе окно закрылось бы раньше, чем Cloudflare выдаст clearance).

## Контракт
```
npm run check:mirrors -- [опции] <url> [<url> ...]
npm run check:mirrors:app -- [те же опции] [--user-data <dir>] [--no-browser-step] [--action-timeout <ms>]
  --file <links.txt>       ссылки по одной в строке; "# комментарий"; "url  # заметка"; "url expect=ACTION_REQUIRED"
  --thread <url>           тред F95 (повторяемо; нужны --cookies — гостям ссылки не показываются); --all-variants — все платформы
  --cookies <cookies.txt>  Netscape-экспорт; --cookie-domains <list> — какие домены брать (по умолчанию f95zone.to,
                           чужие логины из полного экспорта браузера хостам не отдаются)
  --jar <file.json>        cookie-jar между запусками (гостевой аккаунт Gofile, cf_clearance) — только Node-режим
  --out <dir>              папка загрузок; --keep — не удалять файлы
  --only <hostId,...>      только эти хосты (см. --list-hosts)
  --resolve-only           только резолв (статус RESOLVED, имя/размер файла), без передачи
  --max-size <bytes>       не качать файлы крупнее (статус SKIPPED)
  --simulate-drop <bytes>  обрыв первой передачи и проверка докачки
  --platform <hint>        windows | linux | mac | android (по умолчанию windows)
  --capture <dir>          сохранить текстовые ответы резолверов (Node-режим) — из них делаются фикстуры
  --json <file>            машинный отчёт; --dry-run — только список ссылок; --accept-any — PASS для не-игровых файлов
  --timeout <ms>           таймаут запроса (30000); --user-agent <ua> — UA сессии (Node)
```
Статусы: `PASS` — файл скачан, SHA-256 посчитан, размер и архив верны; `ACTION_REQUIRED` — хост требует шаг в браузере (ожидаемо для хостов `support: "browser"`, для автоматических помечается `!`; в Electron-режиме к статусу добавляется `(browser)`, если шаг был пройден); `RESOLVED`/`SKIPPED` — нейтральные; `FAIL` — ошибка. Код выхода: 0 — нет FAIL и неожиданных ACTION_REQUIRED; 1 — есть; 2 — ошибка аргументов; 3 — профиль занят приложением (Electron).

## Граничные случаи и ошибки
- F95 после серии masked-запросов начинает требовать свою капчу на masked-ссылках — Node-режим даёт ACTION_REQUIRED, в приложении это окно шага.
- Gofile ограничивает создание гостевых аккаунтов по IP и после злоупотребления режет соединения на сетевом уровне; используйте `--jar`.
- Turnstile на кнопке скачивания (Mixdrop, Krakenfiles, DataNodes, UsersDrive, HexUpload, Send.cm) требует человека: в Electron-режиме окно ждёт до `--action-timeout`.
- MEGA-ссылки содержат `#` — заметкой в links.txt считается только ` #` с пробелом.
- Не-игровые файлы (mp4, jpg) дают `FAIL payload`, как и в приложении, если не указан `--accept-any`.

## Проверка
1. `npm run check:mirrors -- --simulate-drop 100000 https://www.7-zip.org/a/7za920.zip` — PASS, «resume: ranged request accepted».
2. `npm run check:mirrors -- --cookies cookies.txt --thread <тред F95> --dry-run --all-variants` — список зеркал стартового поста.
3. `npm run check:mirrors:app -- --max-size 300000000 <ссылка Files.fm>` — окно с Cloudflare-проверкой открывается и закрывается само, файл скачивается.
4. Офлайн: `npm test` (фикстурные тесты в test/f95HostFixtures.test.js и соседних файлах).

## История изменений
- 2026-09-26 — первая версия: Node-режим, общий модуль опций передачи, cookie-jar-сессия.
- 2026-09-26 — `--thread`, `--resolve-only`, `--max-size`, `--cookie-domains`, `--jar`; Electron-режим с окном шага; `probeTarget`; фикстуры Cloudflare/DataNodes/Mixdrop/Krakenfiles/Dropbox.
