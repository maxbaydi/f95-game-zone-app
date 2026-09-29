# Хранилище сохранений: своё облако пользователя

**Статус:** active
**Модули:** src/main/saveStorage/providers.js, src/main/saveStorage/cloudFolderDetector.js, src/main/saveStorage/storageConfig.js, src/main/saveStorage/saveStorageSync.js, src/main/saveStorage/saveStorageIpc.js, src/shared/saveManifest.js (`contentHash`), src/shared/saveSyncPlan.js, src/main.js (создание контроллера, `scheduleCloudSaveReconcile`, `launch-game`), src/core/settings/SaveStorageSettings.jsx, src/core/settings/SettingsPanel.jsx, src/core/onboarding/OnboardingWizard.jsx, src/core/library/LibrarySaveSyncPanel.jsx, src/core/cloud/CloudAuthPanel.jsx, src/renderer.js, src/web-preview-api.js
**Тесты:** test/saveStorageProviders.test.js, test/saveStorageSync.test.js, test/saveSyncPlan.test.js, test/saveManifest.test.js; `node --test test/saveStorageProviders.test.js test/saveStorageSync.test.js test/saveSyncPlan.test.js test/saveManifest.test.js`

## Назначение
Облако сохранений жило на Supabase-проекте автора. Бесплатный проект ставится на паузу без трафика, а платить за него в бесплатном приложении нельзя. Теперь у приложения нет своего облака: пользователь подключает место, которым уже владеет, а приложение делает всё остальное автоматически. Цель — минимум действий для обычного человека (один клик по «OneDrive») и полный набор инструментов для тех, кому нужно больше (WebDAV, S3, шифрование, карточка подключения). Старый вход через Supabase остаётся как «продвинутый» вариант для тех, кто хостит свой проект.

## Для пользователя
**Первый запуск.** В мастере появился шаг «Saves»: приложение само находит клиенты облаков на ПК (OneDrive, Dropbox, Google Drive, Яндекс.Диск, iCloud, MEGA, pCloud, Nextcloud, ownCloud, Box, Proton Drive, Sync.com, Mail.ru Cloud) и показывает карточки «Use this cloud». Один клик — папка `<облако>\F95Launcher Saves` создана, подключена, первая синхронизация запущена. Кнопки «Choose another folder…» (любая папка, которую синхронизирует клиент) и «I have a connection card…» (восстановление на новом ПК). «Keep saves on this PC» — пропустить.

**Settings → Save storage.** То же самое плюс:
- **WebDAV server** — адрес, логин, пароль приложения (Nextcloud, ownCloud, Яндекс.Диск `https://webdav.yandex.ru`, Box, pCloud, Koofr, NAS). **Test connection** показывает, найдено ли в этом месте хранилище с другого ПК и зашифровано ли оно.
- **S3 bucket** — endpoint, bucket, region, папка, ключи (Backblaze B2, Cloudflare R2, Wasabi, MinIO, AWS).
- **Protect saves with a passphrase** — шифрование каждого объекта (AES-256-GCM, ключ из scrypt). Фраза нужна на каждом ПК; восстановить её нельзя.
- После подключения: статус, последняя синхронизация, ошибки, **Sync now**, **Export connection card…** (файл `.f95card`, при желании запечатанный отдельной фразой — тогда его можно пересылать), **Disconnect…** (данные в хранилище остаются).
- **Backups in this storage** — каталог всех игр с бэкапами с любого ПК: что уже в библиотеке, что ещё не установлено; **Restore** для установленных.
- **Advanced: your own Supabase project** — старая панель аккаунта.

**Панель игры → Saves.** Если хранилище подключено: «Back up to OneDrive», «Restore from OneDrive»; иначе одна кнопка «Connect your cloud», которая ведёт в настройки. Локальные функции (экспорт/импорт файла, vault) не зависят от хранилища.

**Повторное подключение на другом ПК.** Три способа, от простого к полному: тот же клиент облака → та же карточка «Use this cloud» (папка уже синхронизирована, приложение находит `storage.json` и каталог); импорт карточки подключения (`.f95card`) для WebDAV/S3 — одно действие; ручной ввод. Если хранилище зашифровано, приложение просит фразу до любых изменений; неверная фраза ничего не трогает.

**Автоматика.** Сверка всех установленных игр через 20 с после запуска, после установки/обновления игры, после подключения/разблокировки, и после игры: при запуске игры папки сохранений берутся под наблюдение, изменение + 90 с тишины → сверка и выгрузка. Перед любым восстановлением текущие сохранения уходят в локальный vault.

## Как это работает
1. **Провайдеры** (`providers.js`): один интерфейс `list/read/write/remove/test` над плоскими posix-путями. `folder` — атомарная запись через временный файл и rename (клиент облака никогда не увидит полузаписанный архив). `webdav` — PROPFIND Depth 1 рекурсивно, MKCOL родителей при 404/409 на PUT, Basic auth, разбор multistatus без XML-зависимости, коды `auth_failed` (401/403), `disk_full` (507). `s3` — SigV4 без AWS SDK: ListObjectsV2 с пагинацией, Get/Put/DeleteObject, path-style по умолчанию (R2, B2, MinIO).
2. **Автоопределение** (`cloudFolderDetector.js`): переменные `OneDrive*`, `Dropbox\info.json`, буквы дисков с `My Drive` (Google Drive for desktop), `P:\pCloud Drive`, типовые папки в профиле. Каждому предлагается подпапка `F95Launcher Saves`.
3. **Настройки** (`storageConfig.js`): публичная часть в `config.ini` `[SaveStorage]` (все ключи всех типов всегда записываются, неиспользуемые — пустыми, чтобы не оставалось хвостов), секреты и фраза шифрования — в `data/save-storage-secrets.json`, зашифрованном `safeStorage` (DPAPI на Windows); без него — открытый JSON с пометкой в статусе. Одно подключение: `connect` заменяет, `disconnect` стирает обе части. Карточка подключения — JSON с `format: "f95launcher-save-storage"`, при фразе — AES-256-GCM + scrypt.
4. **Раскладка в хранилище** (`saveStorageSync.js`): `storage.json` (маркер: формат, шифрование, соль, контрольное значение, кто создал), `catalog.json` (все игры с бэкапами), `games/<identity>/latest.zip`, `latest.manifest.json`, `history/<ts>.zip` (последние 5). Для WebDAV всё лежит в подпапке `F95Launcher Saves`, для S3 — под `prefix`. `identity` = `f95-<id темы>` (тот же, что у vault и старого облака).
5. **Архив** — формат файлового экспорта (см. save-transfer.md): `exportGameSavesToFile` для выгрузки, `importGameSavesFromFile` для восстановления (сопоставление профилей по стратегии/провайдеру, поэтому разные папки AppData на двух ПК не мешают).
6. **Решение** — общий `decideSaveSyncPlan`. В манифест добавлен `contentHash` (пути и sha256 файлов без mtime и абсолютных путей): одинаковое содержимое на двух ПК считается синхронизированным, ping-pong «восстановили → сразу выгрузили» исключён. После восстановления запоминается локальный хеш.
7. **Шифрование**: объекты запечатываются заголовком `F95SAVE1` + IV + tag + шифртекст; маркер и каталог тоже. При подключении к существующему зашифрованному хранилищу без фразы состояние `locked`; UI показывает поле «Unlock».
8. **Интеграция в main.js**: контроллер создаётся при регистрации IPC, `start()` после инициализации базы; `scheduleCloudSaveReconcile`/`scheduleCloudInstalledSavesReconcile` уходят в хранилище, если оно готово, иначе — в старый Supabase-путь; `launch-game` вызывает `watchAfterLaunch(recordId)`.

## Контракт
IPC: `get-save-storage-state` → `{ state: { connected, type, label, description, encrypted, locked, busy, lastError, lastSyncAt, encryptionEnabled, secretsEncrypted, deviceName, legacyCloudConfigured } }`; `detect-save-storage-folders` → `{ folders: [{ id, label, path, suggestedPath, reason, recommended }] }`; `test-save-storage-connection({ type, fields })` → `{ success, message, existing, encrypted, createdBy }`; `connect-save-storage({ type, fields, passphrase?, encryptNew? })` → `{ success, existing, encrypted, state }` | `{ success: false, needsPassphrase: true }`; `unlock-save-storage({ passphrase })`; `disconnect-save-storage`; `sync-save-storage-all({ mode: "sync" | "upload" })` → `{ summary }`; `sync-save-storage-game({ recordId, action: "upload" | "restore" | "reconcile" })`; `get-save-storage-catalog` → `{ entries: [{ identity, title, creator, threadUrl, engine, updatedAt, fileCount, totalBytes, device, inLibrary, recordId, installed }] }`; `export-save-storage-card({ passphrase? })`; `import-save-storage-card({ filePath?, cardPassphrase? })` → `{ success }` | `{ needsCardPassphrase: true, filePath }`; `forget-save-storage-game({ recordId })`. События: `save-storage-changed` (state), `save-storage-progress` (`{ active, mode, completed, total, currentTitle, summary, source: "storage" }`).

Поля `fields` по типам: `folder { folderPath, label }`, `webdav { url, username, password }`, `s3 { endpoint, region, bucket, prefix, accessKeyId, secretAccessKey, forcePathStyle }`.

## Граничные случаи и ошибки
- Папка клиента облака недоступна (диск отключён) → ошибки `unavailable` в статусе, локальные функции не затронуты; следующая сверка по расписанию.
- Конфликтные копии клиентов (`latest (conflicted copy).zip`) не читаются приложением; побеждает `latest.zip`, а `history/` хранит предыдущие версии для ручного отката.
- Обе стороны изменились с одинаковым временем → статус `conflict` у игры с текстом «Choose Back up or Restore».
- Игра из каталога не в библиотеке → показывается как «not in this library yet»; после установки первая сверка её восстановит.
- `safeStorage` недоступен (Linux без keyring) → секреты в открытом JSON, статус предупреждает.
- Старый Supabase продолжает работать, если настроен и хранилище не подключено; при подключённом хранилище авто-сверка идёт только в хранилище.

## Проверка
Автотесты: провайдеры (папка, WebDAV с фейковым fetch включая MKCOL и 401, S3 SigV4 и листинг), автоопределение, конфиг/секреты/карточки, движок (выгрузка → каталог → восстановление на «втором ПК» → история → сверка «уже синхронизировано», шифрование и блокировка при неверной фразе, ошибки `no_backup`/`no_saves`). Вручную (Windows): мастер → «Use this cloud» на OneDrive → папка создана, через 20 с игры с сейвами появились в Backups; на втором ПК с тем же OneDrive — тот же клик → сейвы восстановлены после установки игры; WebDAV на Nextcloud с паролем приложения → Test connection → Connect; экспорт карточки → импорт на другом ПК.

## История изменений
- 2026-09-29 — первая версия: провайдеры папка/WebDAV/S3, автоопределение клиентов, шифрование, карточки подключения, шаг мастера, страница настроек, кнопки в панели игры, наблюдение за сейвами после запуска игры, `contentHash` в манифесте.
