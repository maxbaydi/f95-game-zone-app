# Установка из файла, скачанного в своём браузере

**Статус:** active
**Модули:** src/main/f95/manualInstall.js, src/main.js (`installF95PackageFromFile`, IPC `open-f95-download-in-browser`, `install-f95-download-from-file`), src/main/f95/downloadsStore.js (`actionMode`), src/renderer.js, src/core/downloads/DownloadsPanel.jsx
**Тесты:** test/manualInstall.test.js, test/downloadsStoreAction.test.js; `node --test test/manualInstall.test.js test/downloadsStoreAction.test.js`

## Назначение
Часть зеркал защищена от ботов так, что шаг «пройди проверку в окне» ([mirror-browser-step.md](mirror-browser-step.md)) внутри приложения не завершить: Cloudflare Turnstile в окне Electron отвечает ошибкой 600010 (DataNodes, Krakenfiles, Send.cm, UsersDrive), а Mixdrop блокирует окно детектором Adscore. Чтобы игру всё равно можно было поставить или обновить из интерфейса, приложение предлагает скачать файл в обычном браузере пользователя и подхватывает его: копирует в свою папку загрузок и проводит через тот же путь установки, что и собственные загрузки.

## Для пользователя
1. Если зеркало не пускает во встроенном окне, в карточке загрузки (панель **Downloads**) появляется блок **Stuck on this page?** с двумя кнопками. При статусе **Failed** с ссылкой на зеркало блок тот же.
2. **Open in my browser** — ссылка зеркала открывается в вашем обычном браузере. Карточка переходит в режим **Waiting for your file**: скачайте файл там как обычно.
3. **Pick downloaded file** — выберите скачанный архив или установщик (zip, 7z, rar, exe, apk …). Дальше всё автоматически: статус **Installing**, затем **Installed** и кнопка **Show in library**.
4. Ваш файл остаётся на месте (в папке загрузок браузера): приложение работает с копией.
5. Кнопка **Install from file** есть и у любой неудавшейся загрузки — например, если файл уже лежит на диске.
6. Типичные подсказки:
   - «…is not an archive or installer…» — выбран не архив/установщик или недокачанный файл (`.crdownload`, `.part`). Дождитесь конца загрузки в браузере.
   - «…is empty…» — файл ещё пустой, загрузка в браузере не закончилась.
   - «This download is still running.» — карточка уже скачивает или устанавливает; дождитесь или нажмите **Cancel**.

## Как это работает
- `open-f95-download-in-browser`: останавливает поток встроенного окна (`stopF95MirrorActionFlow`), открывает `actionUrl` (или исходную ссылку зеркала) через `shell.openExternal` — только `http(s)` — и переводит запись в `status: "action"` с `actionMode: "file"`. В этом режиме кнопка «Show browser window» скрыта, а блок подсказки становится основным.
- `install-f95-download-from-file`: показывает системный диалог выбора файла (стартовая папка — загрузки пользователя, фильтр по расширениям пакетов), затем `inspectManualPackage` проверяет файл **до** любых изменений состояния: расширение пакета, не временное имя браузера, обычный непустой файл. Ошибка возвращается в UI тостом, карточка остаётся как была.
- Дальше `installF95PackageFromFile` (main.js) выполняется в фоне: запись переводится в `installing` («Preparing <file>»), `stageManualPackage` копирует файл в `appPaths.downloads` под уникальным именем (`reserveF95DownloadPath`), после чего вызывается обычный `finalizeF95DownloadedPackage` → `importDownloadedF95Package` (распаковка, определение движка, запись в библиотеку, бэкап сейвов при обновлении). Успех — `completed`, сбой — `error` с текстом «Install failed for …».
- Копия, а не перенос: файл выбирал пользователь, и после **успешной** установки приложение удаляет обработанный пакет (как и свои загрузки); после неудачной копия сохраняется для повторной попытки. Перенос уничтожил бы пользовательскую копию. Неполная копия (кончилось место) удаляется, чтобы не оставить усечённый архив.
- Все FS-операции и диалог — в main; renderer только вызывает IPC и показывает статусы.

## Контракт
- IPC `open-f95-download-in-browser(id)` → `{success: true, id, actionUrl, hostLabel}` или `{success: false, error}`. Допустимые статусы записи: `error`, `action`; иначе «This download is still running.». Запись без контекста — «This download can no longer be resumed…».
- IPC `install-f95-download-from-file(id)` → `{success: true, queued: true, id, fileName}`; `{success: false, cancelled: true}` при отмене диалога; `{success: false, error}` при непригодном файле. Установка продолжается в фоне, прогресс — через `f95-downloads-changed`.
- Запись стора: `actionMode: "" | "window" | "file"` (публичное поле). `awaitingAction(id, {mode: "file", actionUrl, hostLabel, text})`. `fail`, `resolving`, `start`, `cancel`, `complete` сбрасывают `actionMode`.
- Модуль `manualInstall.js`: `isLikelyInstallPackage(name)`, `inspectManualPackage(path)` → `{sourcePath, fileName, totalBytes}`, `stageManualPackage({sourcePath, downloadsDir, reservePath, keepOriginal})` → `{targetPath, fileName, totalBytes}`, `describeManualPackageError(error)`. Коды `MirrorError`: `unsupported_payload`, `empty_download`, `not_found`.
- Расширения пакетов: zip, 7z, rar, tar, gz, tgz, bz2, xz, zst, exe, apk, jar, swf, msi. Отвергаются `.crdownload`, `.part`, `.partial`, `.download`, `.tmp`, `.opdownload`.

## Граничные случаи и ошибки
- Пользователь отменил диалог — ничего не меняется.
- Файл выбран, пока запись уже ушла в другой статус (повтор из другого места) — повторная проверка после диалога возвращает «still running», ничего не запускается.
- Файл на другом диске — копирование может занять время; карточка показывает «Preparing <file>» в статусе Installing (отмена на этом этапе недоступна, как и для обычной установки).
- Архив с паролем или без игровых файлов — см. [install-recovery.md](install-recovery.md): карточка показывает причину и подсказку, копия остаётся в папке загрузок приложения, доступны **Retry install** (с паролем), **Install from folder**, **Folder**; оригинал пользователя не тронут.
- Ссылка зеркала не `http(s)` — «This mirror link cannot be opened in a browser.».
- Замаскированная ссылка F95 в системном браузере требует входа в F95 там; иначе браузер покажет форму логина F95.

## Проверка
1. Вручную: запустить установку через Mixdrop или DataNodes → окно шага → в карточке нажать **Open in my browser** → в системном браузере скачать файл → **Pick downloaded file** → выбрать файл → статус Installing → Installed, игра в библиотеке. Исходный файл на месте.
2. Выбрать `.txt` или `.crdownload` — тост с подсказкой, карточка не изменилась.
3. Отменить диалог — без изменений. **Cancel** в режиме «Waiting for your file» — запись Cancelled.
4. Автотесты: `test/manualInstall.test.js` (фильтр расширений, перенос/копия, уникальное имя, отказ по типу/пустому/отсутствующему файлу без побочных эффектов, тексты ошибок), `test/downloadsStoreAction.test.js` (режим `file`, сброс при `installing`/`fail`/`resolving`).
5. Прогон 2026-09-27 в приложении (`npm run dev`, логин пользователя): тред Shattered Grace → зеркало DataNodes → окно шага закрыто → Failed с блоком «Stuck on this page?» → **Open in my browser** (страница открылась в Chrome, карточка «Your turn / Waiting for your file») → **Pick downloaded file** с `notes.txt` — тост об ошибке, карточка без изменений → повторный выбор `ShatteredGrace-0.1.11.1-win.zip` (222 МБ, скачан заранее с MediaFire) → Installing → Installed, «Show in library», игра в библиотеке (63 → 64), оригинал архива на месте, папка загрузок приложения пуста (копия удалена после установки, `.part` нет).

## История изменений
- 2026-09-27 — первая версия: обход зеркал, которые нельзя пройти во встроенном окне (Turnstile 600010, Adscore). Сквозная проверка в приложении на DataNodes/Shattered Grace пройдена.
