# Результаты живой проверки зеркал

**Дата проверки:** 2026-09-26 (промежуточная; продолжается)
**Инструмент:** `npm run check:mirrors` — см. [check-mirrors.md](check-mirrors.md)
**Тестовый файл:** `mirror-test.zip`, 1 499 865 байт, SHA-256 `712600fe5fce5a0139d97e22bb38fd17de34fdc03670b3dde1948aad739f841c` (случайные данные, загружен мной на хосты с анонимным API)

Легенда: **PASS** — файл скачан, SHA-256 и размер верны, архив цел; **ACTION_REQUIRED** — хост требует шаг в браузере (для хостов «через браузер» это ожидаемый результат); **FAIL** — ошибка; **—** — рабочей ссылки ещё нет.

## Автоматические хосты

| Хост | Форма URL | Результат | Файл / размер | Примечание |
| --- | --- | --- | --- | --- |
| Generic (прямой файл) | https://www.7-zip.org/a/7za920.zip | PASS | 7za920.zip, 376 KB | докачка после обрыва на 100 000 байт: Range → 206 |
| Litterbox | https://litter.catbox.moe/ov0f8v.zip | PASS | ov0f8v.zip, 1.4 MB | SHA совпал с исходником |
| Dropbox | https://www.dropbox.com/scl/fi/…/AnarchiaGG-dzien-dziecka.zip?rlkey=…&dl=0 | PASS | 1.1 MB, zip (722 файла) | публичный пример с GitHub |
| pomf (qu.ax) | https://qu.ax/AI98m (страница) | PASS | AI98m.zip, 1.4 MB | исправлено: разбор лендинга + Referer; докачка после обрыва на 300 000 байт: 206 |
| Google Drive | https://drive.google.com/uc?id=0B9P1L--7Wd2vU3VUVlFnbTgtS2c | PASS (резолв+передача) | spam.txt, 5 B | резолвер работает; файл не игровой, поэтому `payload` FAIL ожидаем |
| Google Drive | https://drive.google.com/file/d/0B9P1L--7Wd2vNm9zMTJWOGxobkU/view | ACTION_REQUIRED | — | Drive требует вход (HTTP 401) — верное поведение |
| Gofile | https://gofile.io/d/2cmlCIGh | FAIL (сеть) | — | исправлен handshake (wt-соль, ротация токенов, переиспользование аккаунта); после серии тестов Gofile временно блокирует IP — повтор позже |
| Buzzheavier | https://buzzheavier.com/2oi4sx9gseqg | ACTION_REQUIRED | — | Cloudflare-челлендж для Node-fetch; проверить в приложении (Chromium + шаг в окне) |
| Pixeldrain | https://pixeldrain.com/u/PftuLkE9 | FAIL (404) | — | файл удалён; анонимная загрузка на Pixeldrain отключена — нужна ссылка |
| MEGA | https://mega.nz/file/W0UAgJaK#… | FAIL (blocked) | — | ссылка заблокирована MEGA — нужна ссылка |
| MediaFire | https://www.mediafire.com/folder/1end54mgactqx/Test_File | FAIL (пустая папка) | — | нужна ссылка на файл |
| F95 masked / вложения | — | — | — | нужны cookies F95 |
| Mixdrop, Uploadhaven, FuckingFast, Workupload, Files.fm, Krakenfiles, Qiwi, OneDrive, Яндекс.Диск, Sendspace, Catbox, FileDitch, XFileSharing-семейство | — | — | — | нужны ссылки (анонимные загрузки: Workupload — «Are you a human?», Krakenfiles — таймаут сервера загрузки, Catbox — «Invalid uploader») |

## Хосты «через браузер»

| Хост | Результат | Примечание |
| --- | --- | --- |
| 1fichier, TeraBox, FileCrypt, Rapidgator, Nitroflare, Katfile, DDownload, Turbobit, Hitfile, VikingFile, MultiUp, Mirrored.to, сокращатели, WeTransfer | — | ссылок ещё не было; ожидается ACTION_REQUIRED с рабочим `actionUrl` |

## Что исправлено по итогам прогона
- Gofile: сайт перестал отдавать `/dist/js/config.js`; токен теперь считается по актуальной формуле (`/js/wt.obf.js` → `generateWT`), ротация «расчётный → статический → новый гостевой аккаунт», гостевой аккаунт хранится в cookie на 30 дней.
- Общий парсер лендингов: ссылка со страницы получает `Referer` страницы (qu.ax без него отвечает 302 на лендинг); pomf-клоны идут через парсер.
- `fetchWithCookieJar`: редиректы по хопам с куками, запись `Set-Cookie` в jar.

## История изменений
- 2026-09-26 — первый прогон на публичных файлах и собственных тестовых загрузках.
