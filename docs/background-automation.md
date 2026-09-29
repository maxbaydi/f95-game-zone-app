# Фоновая автоматика: уведомления об установке, автообновление, автозапуск, бэкапы, пароли из темы

**Статус:** active
**Модули:** src/main/installNotificationController.js, src/main/periodicJob.js, src/main/libraryAutoBackup.js, src/main/libraryReset.js (`backupDatabaseFile.fileNamePrefix`), src/main/appUpdater.js (`getAutoDownload`), src/main/liveUpdateCheck.js (`favoritesOnly` как функция), src/main/f95/threadPassword.js, src/main/f95/threadInspector.js (`postText` → `archivePassword`), src/main/settingsPatch.js, src/main.js (`applyLoginItemSettings`, `shouldStartHidden`, `appUpdateRecheckJob`, `runStartupLibraryBackup`, `powerMonitor`, `rememberThreadArchivePassword`, повтор распаковки с паролем), src/core/settings/GeneralSettings.jsx (`AutomationSettingsCard`, строки автозапуска, уведомление об установке), src/App.jsx (`scheduleStartupLibraryScan`)
**Тесты:** test/installNotificationController.test.js, test/periodicJob.test.js, test/libraryAutoBackup.test.js, test/threadPassword.test.js, test/appUpdater.test.js, test/settingsPatch.test.js; `node --test test/installNotificationController.test.js test/periodicJob.test.js test/libraryAutoBackup.test.js test/threadPassword.test.js test/appUpdater.test.js`

## Назначение
Всё, что лаунчер раньше делал только по клику, теперь делает сам, а пользователь узнаёт о результате там, где находится: в трее, в Windows‑уведомлении, в панели загрузок. Каждая автоматика выключается одним переключателем и не требует перезапуска.

## Для пользователя
**Settings → General → Background work**
- **Look for new games at startup** — через 8 с после запуска идёт инкрементальный скан (только если библиотека не пустая и мастер первого запуска пройден). Сомнительные папки ждут в Scan Hub, как и при ручном скане.
- **Check every installed game for updates** — фоновая проверка тем читает не только избранные, но и остальную библиотеку (до 40 игр за прогон, каждые 6 ч).
- **Download app updates automatically** — новая версия скачивается в фоне и ставится при выходе; в статус‑баре остаётся кнопка «Restart to update». Выключено → как раньше, две кнопки.
- **Weekly library backup** — раз в 7 дней при запуске снимается копия базы библиотеки `library-auto-<дата>.db`; хранятся 4 последних автоматических, ручные не трогаются.

**Settings → General → Window**
- **Launch with Windows** — регистрирует launcher в автозагрузке (включает и «Keep running in the system tray»). Автозагрузка стартует скрыто.
- **Start in the tray** — обычный запуск тоже открывается скрытым в трее (нужен трей).

**Settings → Notifications → Finished and failed installs** — Windows показывает «Game installed» / «Install failed», только пока окно лаунчера не на переднем плане; клик по уведомлению открывает окно.

**Пароли архивов.** Если в стартовом посте темы есть «Password: …» (любые варианты: PW, Archive password, «пароль от архива», значение на следующей строке), пароль запоминается при инспекции темы и пробуется сам, когда архив оказался зашифрован. Карточка загрузки показывает «Unpacking … with the password from the thread». Не подошёл → прежняя карточка с полем для ручного ввода.

**Пробуждение ПК.** Через 60 с после выхода из сна: перепроверка релиза приложения, живые темы, синхронизация сохранений.

## Как это работает
1. `createInstallNotificationController` — `notifyCompleted` / `notifyFailed`; проверяет `Notifications.installs` и `mainWindow.isVisible() && isFocused()`; вызывается из обоих мест `f95DownloadsStore.complete` и из `markF95DownloadFailed`.
2. `createPeriodicJob` — таймер с `unref`, без наложений (повторный `kick` во время прогона игнорируется), интервал считается от конца прогона; `start({initialDelayMs})`, `kick(reason, delay)`, `stop()`. Один экземпляр `appUpdateRecheckJob` (6 ч) стартует после первой проверки при запуске.
3. `appUpdater`: `autoDownload` у electron‑updater остаётся `false` (контроллер сам вызывает `downloadUpdate()` по событию `update-available`, только в упакованной сборке и при `AppUpdates.autoDownload !== false`); `autoInstallOnAppQuit` синхронизируется с настройкой перед каждой проверкой.
4. `applyLoginItemSettings` — `app.setLoginItemSettings({ openAtLogin, args: ["--hidden"] })` при загрузке конфига и после каждого `update-settings`. `shouldStartHidden` → `BrowserWindow({ show: false })`, если включён трей и (`--hidden` в argv или `Interface.startMinimized`).
5. `runScheduledLibraryBackup` — фильтрует `library-auto-*`, сравнивает `createdAt` новейшей с `minIntervalMs` (7 дней), создаёт копию через `backupDatabaseFile({ fileNamePrefix: "library-auto" })`, удаляет лишние автоматические сверх `keep` (4). Вызов через 45 с после старта при `Library.autoBackup !== false`.
6. `createLiveUpdateChecker({ favoritesOnly: () => LiveUpdates.allGames !== true })` — функция читается на каждом прогоне.
7. `extractArchivePassword(postText)` — регулярка по меткам (password/passwd/pass/pw/pwd/пароль [от архива]) с разделителем `:`/`=`/`-`/`is`, значение в той же или следующей строке; отбрасывает служебные слова («protected», «required», ссылки, имена файлов). Скрипт инспекции отдаёт `postText` (до 40 000 символов), Node‑сторона превращает его в `archivePassword` и не пропускает текст дальше. main кэширует пароль по URL темы (`f95ThreadArchivePasswords`, до 200 записей), кладёт в `metadata.archivePassword` контекста; `finalizeF95DownloadedPackage` при `archive_encrypted`/`archive_wrong_password` без пароля повторяет распаковку с ним один раз.
8. `scheduleStartupLibraryScan` (renderer) — после начальной загрузки игр и решения о мастере: `rescanLibrary({ mode: "incremental", reason: "startup" })` через `STARTUP_SCAN_DELAY_MS` (8 с), если скан не идёт.

## Контракт
- Конфиг (`config.ini`), все через `update-settings`: `Interface.openAtLogin`, `Interface.startMinimized`, `Library.autoScanOnStartup` (по умолчанию true), `Library.autoBackup` (true), `Notifications.installs` (true), `AppUpdates.autoDownload` (true), `LiveUpdates.allGames` (false).
- `inspect-f95-thread` → поле `archivePassword: string` в успешном ответе; `install-f95-thread` принимает необязательный `archivePassword`.
- Имена автоматических копий: `library-auto-YYYYMMDD-HHmmss.db` в папке библиотечных бэкапов; в списке Settings они видны наравне с ручными.
- Лог‑префиксы: `[job:app-update]`, `[library.backups]`, `[startup]`, `[f95.download]`.

## Граничные случаи и ошибки
- Нет трея → «Start in the tray» отключён, `--hidden` игнорируется, окно показывается.
- Linux/не Windows/macOS → `setLoginItemSettings` не вызывается.
- Уведомление об установке при активном окне не показывается (тост в приложении уже есть).
- Пароль из темы неверный → обычная ошибка `archive_wrong_password` с полем ввода; повтор только один.
- Автобэкап при недоступной базе или ошибке `VACUUM INTO` → предупреждение в лог, следующий раз при следующем запуске.
- Периодическая проверка обновления при отсутствии сети → ошибка логируется, расписание сохраняется.

## Проверка
Автотесты перечислены выше (`npm test`: 543, из них 7 давних Windows‑path тестов падают только на Linux). Вручную на Windows: включить «Launch with Windows» → в «Автозагрузке» появляется F95Launcher; выйти и войти → лаунчер в трее; свернуть в трей и установить игру → Windows‑уведомление; тема с «Password:» и зашифрованным архивом → установка без запроса пароля.

## История изменений
- 2026-09-29 — первая версия (релиз 1.7.0).
