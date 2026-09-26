# Результаты живой проверки зеркал

**Дата проверки:** 2026-09-26
**Инструменты:** `npm run check:mirrors` (Node) и `npm run check:mirrors:app` (Electron, сессия приложения, окно шага) — см. [check-mirrors.md](check-mirrors.md)
**Источник ссылок:** ~450 тредов F95 (свежие + поиск по хостам под логином пользователя), публичные файлы, собственные тестовые загрузки (`mirror-test.zip`, 1 499 865 байт, SHA-256 `712600fe…f841c`)

Легенда: **PASS** — файл скачан, SHA-256 посчитан, размер сверен с `Content-Length`/заявлением хоста, архив проверен `7z t` (для RAR — системным 7-Zip; `(pw)` — архив с паролем, заголовки целы); **PASS (browser)** — то же после шага в окне; **RESOLVED** — резолвер дал прямой URL, файл не качался (размер/лимит); **ACTION_REQUIRED** — нужен человек в окне (капча/Turnstile) — для «браузерных» хостов это норма; **FAIL** — ошибка.

## Автоматические хосты

| Хост | Форма URL | Node | Electron (приложение) | Файл / размер / SHA-256 | Примечание |
| --- | --- | --- | --- | --- | --- |
| F95 masked → Gofile | `f95zone.to/masked/gofile.io/…` | ACTION_REQUIRED (капча F95) | RESOLVED (browser) | TakeTheCrown-v0.5-pc.zip, 2.1 GB | капча F95 на masked-ссылке пройдена в окне автоматически (с cookies логина); файл пропущен по `--max-size` |
| F95 masked → MEGA | `f95zone.to/masked/mega.nz/…` | RESOLVED / ACTION_REQUIRED | RESOLVED | girl by accident 0.8.7.zip, 629 MB | после серии masked-запросов F95 требует капчу — окно шага |
| F95 masked → Google Drive | `f95zone.to/masked/drive.google.com/…` | RESOLVED | — | `drive.usercontent.google.com/download?id=…` | |
| F95 masked → Pixeldrain / Workupload | masked | ACTION_REQUIRED (капча F95) | — | | то же окно шага |
| Google Drive | `drive.google.com/file/d/<id>/view`, `uc?id=` | PASS (передача) | — | diminishing_returns.rar, 154 MB, `6a0fedd4…` | RAR с паролем — теперь `PASS (pw)`; файл, требующий входа → ACTION_REQUIRED |
| MEGA | `mega.nz/folder/<id>#<key>` | PASS | — | 2BigToDateDemo-1.0-pc.7z, 125 MB, `a58bc0f7…` | расшифровка + докачка по `/offset-end` |
| Gofile | `gofile.io/d/<code>` | PASS | — | mirror-test.zip, 1.4 MB, `712600fe…` (эталон) | новый website-token; докачка 206 |
| Pixeldrain | `pixeldrain.com/u/<id>` | PASS | — | HaremGacha-0.1.0-pc.zip, 413 MB, `0c7c8d0d…` | докачка 206 |
| MediaFire | `mediafire.com/file/<key>/<name>` | PASS ×2 | — | 3ddbrowser.zip 25 MB `c2d3fb75…`; LostParadise_v0.1.1_DEMO.zip 649 MB `9d446bc9…` | |
| Dropbox | `/s/<id>/<name>?dl=0`, `/scl/fi/…` | PASS; удалённый → not_found | PASS | Rampage.zip, 5.3 MB, `2a40171e…` | зонд `?dl=1`; страница «File Deleted» распознаётся |
| Яндекс.Диск | `disk.yandex.ru/d/<id>` | PASS | — | TFG - Giantess Girlfriend(demo) PC.zip, 202 MB, `fc7239c4…` | докачка 206 |
| Buzzheavier | `bzzhr.to/<id>` | ACTION_REQUIRED (Cloudflare, TLS-отпечаток Node) | **PASS (browser)** | Open_Rooms-0.5.0_Public.rar, 413 MB, `e741d35a…` — совпадает с SHA-256 на странице хоста | Cloudflare пройден в окне без клика; докачка 206; RAR цел (190 файлов) |
| DataNodes | `datanodes.to/<id>/<name>` | ACTION_REQUIRED (Turnstile в countdown) | ACTION_REQUIRED | | форма `download1` теперь POST-ится правильно; в приложении был 404 «file no longer exists» — cookies промежуточного редиректа терялись в net.request (исправлено); Turnstile на шаге 2 в окне Electron даёт ошибку 600010 → путь «в своём браузере → выбрать файл» |
| DailyUploads (XFS) | `dailyuploads.net/<id>` | RESOLVED | PASS (pw) | ESR-11985-v1.2.20.rar, 39 MB, `4a1f16fd…` | XFS: countdown 60 с, POST-редирект вручную, CDN с Referer; архив с паролем |
| Files.fm | `files.fm/u/<id>` | ACTION_REQUIRED (Cloudflare) | PASS (передача) | видео 58 MB, `3bbf98c2…` | резолвер и передача работают; файл не игровой → `unsupported_payload` (корректно) |
| Litterbox / Catbox | `litter.catbox.moe/<id>.zip`, `files.catbox.moe/…` | PASS | — | ov0f8v.zip, 1.4 MB, `712600fe…` | прямые файлы |
| pomf (qu.ax) | `qu.ax/<id>` (страница) | PASS | — | AI98m.zip, 1.4 MB, `712600fe…` | лендинг → `/x/<id>.zip` + Referer; докачка 206 |
| Прямой файл (generic) | любой URL файла | PASS | — | 7za920.zip, 376 KB, `2a3afe19…` | докачка 206 |
| Mixdrop | `mixdrop.ag/f/<id>`, `mixdrop.top`, `mxdrop.top` | ACTION_REQUIRED | ACTION_REQUIRED | | кнопка DOWNLOAD за Cloudflare Turnstile (`data-cf-key`); в окне Electron клик по DOWNLOAD открывает только рекламный попап, Adscore помечает окно как бота → путь «в своём браузере → выбрать файл» |
| Krakenfiles | `krakenfiles.com/view/<hash>/file.html` | ACTION_REQUIRED | ACTION_REQUIRED | | Turnstile в `#dl-form`, POST без токена → «captcha not valid» |
| Uploadhaven | `uploadhaven.com/download/<id>` | ACTION_REQUIRED | ACTION_REQUIRED | | hCaptcha по дизайну хоста |
| Workupload | `workupload.com/file/<id>` | ACTION_REQUIRED | — | | «Are you a human?» — пазл/капча |
| Send.cm | `send.cm/<id>` | ACTION_REQUIRED | ACTION_REQUIRED (таймаут без человека) | | Turnstile |
| UsersDrive, HexUpload, AnonFiles-клон, Uploady | XFS-ссылки | ACTION_REQUIRED | — | | Turnstile / hCaptcha / картиночная капча |
| Up-load.io | `up-load.io/<id>` | FAIL (HTTP 526) | — | | SSL-ошибка Cloudflare на стороне хоста |
| UploadRAR, Racaty, FileRio, Drop.download | | FAIL (404 / хост недоступен) | — | | ссылки мертвы или домены не отвечают на сетевом уровне |
| OneDrive | `1drv.ms/u/s!…` | FAIL (not_found) / ACTION_REQUIRED | — | | все найденные ссылки удалены; анонимная загрузка Microsoft закрыта — окно |
| Sendspace, FuckingFast, Qiwi, FileDitch, Nopy, File-Upload, UserUpload, Uploadev | — | — | — | | живых ссылок в тредах F95 не нашлось (упоминания без ссылок или удалённые файлы) |

## Хосты «через браузер»

| Хост | Результат | Примечание |
| --- | --- | --- |
| 1fichier, DDownload, FileCrypt, Rapidgator, Nitroflare, Katfile, Turbobit, Hitfile, VikingFile, MultiUp, Mirrored.to, сокращатели (ouo.io), WeTransfer, TeraBox | ACTION_REQUIRED с рабочим `actionUrl` | ожидаемо: приложение открывает окно шага, загрузка из окна усыновляется |

## Проверка докачки
`--simulate-drop` (обрыв на 100 КБ–3 МБ): Range → 206 у generic, Gofile, Pixeldrain, Яндекс.Диска, qu.ax, Dropbox, Buzzheavier, DailyUploads, Files.fm; MEGA — докачка по пути `/offset-end`.

## Что исправлено по итогам
- **Сессия Electron** (главное): `session.fetch` из main-процесса не шлёт cookies, не сохраняет Set-Cookie, не даёт ручных редиректов и блокирует Referer. Все запросы загрузчика идут через `net.request` с явными cookies партиции (src/main/f95/electronSession.js). Без этого логин F95 и clearance Cloudflare из окна не доходили до загрузчика.
- Cloudflare-стены распознаются централизованно → `captcha_required` → окно шага; после шага цель зондируется одним байтом (`probeTarget`).
- Gofile (website-token, аккаунт в cookie), Dropbox («File Deleted», зонд `?dl=1`), qu.ax (Referer), формы в HTML-комментариях (DataNodes), Turnstile у Mixdrop/Krakenfiles/DataNodes, XFS POST-редиректы, Buzzheavier (hx-redirect на себя), «голые» домены в тредах.

## Зеркала, непроходимые во встроенном окне
Проверено в отдельном профиле Electron с реальными кликами (Orca): DataNodes доходит до шага 2, но чекбокс Turnstile отвечает `[Cloudflare Turnstile] Error: 600010` — одинаково с sandbox и без, со штатным UA и с UA Chrome. Mixdrop: клик по DOWNLOAD открывает рекламный попап, в консоли «Bot and proxy detection by Adscore.com», загрузка не начинается. Для таких зеркал карточка загрузки предлагает **Open in my browser** → **Pick downloaded file** ([mirror-manual-install.md](mirror-manual-install.md)); установка идёт обычным путём.

## Что осталось
- Хосты с Turnstile/капчей на кнопке скачивания (Mixdrop, Krakenfiles, DataNodes, Send.cm, UsersDrive, Uploadhaven, Workupload, HexUpload) — только через системный браузер пользователя и выбор файла; во встроенном окне не проходятся (см. выше).
- Полные загрузки masked-ссылок (2.1 ГБ Gofile, 629 МБ MEGA) не выполнялись из-за лимита размера в прогоне; резолверы и передача тех же хостов проверены на файлах меньшего размера.

## История изменений
- 2026-09-26 — первый прогон на публичных файлах и собственных тестовых загрузках.
- 2026-09-26 — прогон по ~450 тредам F95 (Node) и Electron-прогон с окном шага; таблица выше.
- 2026-09-27 — разбор жалоб из приложения: DataNodes 404 (cookies редиректов, исправлено), Mixdrop/DataNodes во встроенном окне не проходятся (Adscore, Turnstile 600010) → путь через системный браузер и выбор файла.
