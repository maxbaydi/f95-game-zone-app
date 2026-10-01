# Промпт для продолжения на локальной машине

Скопируйте текст ниже целиком в Claude Code, запущенный в корне локального клона репозитория `maxbaydi/f95-game-zone-app` (Windows, с доступом в интернет и возможностью запустить Electron).

---

Ты работаешь в моём локальном репозитории F95Launcher (Electron + React через Babel в рантайме). Отвечай по-русски. Экономь токены: не запускай больше одного субагента одновременно, не перечитывай большие файлы целиком без необходимости.

## Контекст

Работа ведётся в ветке `claude/dazzling-bardeen-4gwbcw`. Уже сделано в облачной сессии (без доступа к файлообменникам):

- UI: анимации 400–700 мс, тосты/диалоги вместо alert, error boundaries, сплэш загрузки, локальные React/Babel/шрифты (`src/assets/vendor`), настройка «Interface animations». Ядро: `src/core/ui/app-ui.js`, `src/core/ui/app-react.js`, стили в `src/assets/css/main.css`.
- Main-процесс: `src/main/windowResilience.js` (перезагрузка упавшего рендерера, диалог при зависании), атомарная запись `config.ini` (`src/main/atomicFile.js`), single-instance lock.
- Загрузки: реестр хостов `src/main/f95/hosts/index.js` (MIRROR_HOSTS, `prepareMirrorDownload`), резолвер на каждый хост в `src/main/f95/hosts/*.js`, конвейер передачи `src/main/f95/directDownload.js` (`downloadToFile`: ретраи, докачка по Range, watchdog зависаний, распознавание HTML вместо файла, проверка места на диске, расшифровка MEGA), фасад `src/main/f95/downloadSupport.js`, состояние `src/main/f95/downloadsStore.js`, оркестрация в `src/main.js` (`runF95DownloadContext` → `prepareF95DownloadUrl` → `startDirectF95Download` → `finalizeF95DownloadedPackage`; IPC `install-f95-thread`, `cancel-f95-download`, `retry-f95-download`, `clear-f95-download-history`, `show-f95-download-in-folder`). UI загрузок: `src/core/downloads/DownloadsPanel.jsx`, выбор зеркала `src/core/f95/F95MirrorColumns.jsx`.
- Все резолверы проверены только юнит-тестами с моками. **С реальными серверами ни один хост ещё не проверялся** — в облаке сеть к ним была закрыта. Это главная задача.

Хосты с автоматической загрузкой: F95 masked links и вложения, Google Drive, MEGA (файлы и папки), Gofile, Pixeldrain (файлы и списки), Mixdrop (все зеркальные домены), Uploadhaven, Buzzheavier (+ flashbang/trashbytes), FuckingFast, MediaFire, Workupload, Files.fm, Krakenfiles, Qiwi, Dropbox, OneDrive, Яндекс.Диск, Sendspace, Catbox/Litterbox, FileDitch, pomf-клоны, семейство XFileSharing (DataNodes, Racaty, Nopy, Send.cm, HexUpload, UsersDrive, Drop.download, File-Upload, UploadRAR, Uploady, DailyUploads, Up-load, UserUpload, Uploadev, FileRio, AnonFiles-клоны) и общий парсер лендингов. Хосты «через браузер» (1fichier, TeraBox, FileCrypt, Rapidgator, Nitroflare, Katfile, DDownload, Turbobit, Hitfile, VikingFile, MultiUp, Mirrored.to, сокращатели ссылок, WeTransfer) должны давать понятное действие «открыть во встроенном браузере». Если какой-то из них реально можно качать автоматически — сделай это.

## Подготовка

1. `git fetch origin && git checkout claude/dazzling-bardeen-4gwbcw && git pull`
2. `npm ci`, `npm run build:css`
3. Базовая проверка: `npm run lint`, `npm run typecheck`, `npm test` — зафиксируй исходное состояние.

## Задача: довести все загрузчики до 100% на реальных серверах

1. **Инструмент живой проверки.** Создай `scripts/check-mirrors.js` (Node ≥ 18, без Electron) и npm-скрипт `check:mirrors`. Скрипт должен идти тем же кодом, что и приложение: `prepareF95DownloadUrl` с сессией-шимом на `fetchWithCookieJar`, затем `downloadToFile` с теми же опциями, что в `startDirectF95Download` (вынеси их построение в общий модуль, чтобы не было расхождений), затем `inspectDownloadedPackage`. Входные данные: URL в аргументах или `--file links.txt`; опции `--cookies` (Netscape cookies.txt для masked-ссылок F95), `--out`, `--keep`, `--only <hostId>`, `--simulate-drop <bytes>` (оборвать передачу на N байтах и проверить докачку). На выходе таблица: хост | URL | PASS / ACTION_REQUIRED / FAIL | имя файла | размер | SHA-256 | тип архива | ошибка. Код выхода ненулевой при любом FAIL.
2. **Реальные ссылки.** Спроси меня, какие ссылки проверять. Я дам ссылки на зеркала из тредов F95 или на треды, где они есть. Если по какому-то хосту ссылок нет, найди публичный тестовый файл сам. Нужно минимум по одной рабочей ссылке на каждый хост и на каждую форму URL (домен-зеркало, папка/список, masked-ссылка F95 на этот хост).
3. **Прогон и исправления.** Прогони все ссылки. Для каждого FAIL выясни причину по реальным ответам сервера (сохрани обезличенные HTML/JSON-ответы в `test/fixtures/hosts/<host>/`) и исправь резолвер. Добавь регрессионный тест на этих фикстурах, чтобы поломку ловили офлайн-тесты. Проверь целостность каждого скачанного архива (`7z t` или разбор zip) и совпадение размера с заявленным хостом. Проверь докачку через `--simulate-drop` на хостах с Range.
4. **Проверка в приложении.** Запусти `npm run dev` и под моим логином F95 установи по одной игре через каждый хост. Проверь по очереди:
   - статусы в панели загрузок: resolving → downloading → installing → completed;
   - отмену и повтор загрузки;
   - хост с капчей: ACTION_REQUIRED → решение во встроенном браузере → повтор проходит;
   - отсутствие мусорных `.part` после отмены;
   - прогресс, скорость, ETA и тосты.
   Если нужно моё действие (логин, капча), остановись и попроси.
5. **Критерий готовности.** Каждый автоматический хост даёт PASS с верным SHA-256 и целым архивом. Каждый браузерный хост даёт ACTION_REQUIRED с рабочей ссылкой. `npm run lint`, `npm run typecheck` и `npm test` зелёные. Итоговую таблицу по хостам положи в `docs/mirror-verification.md` с датой проверки.

## Правила

- Не ослабляй и не удаляй существующие тесты.
- UI и анимации не ломай: проверяй правки JSX синтаксически (Babel, пресеты react + env).
- Коммить по ходу работы в `claude/dazzling-bardeen-4gwbcw` с понятными сообщениями и пушь.
- В конце дай короткий отчёт: таблица хостов (PASS / ACTION_REQUIRED / FAIL), что исправлено, что осталось.
