# Статистика: сколько скачали и сколько пользуются

**Статус:** active (счётчик пользователей включается после развёртывания `stats-worker/` и заполнения `usageStats.endpoint`)
**Модули:** src/main/usageStats.js, src/main.js (`usageStatsReporter`, `usageStatsJob`, секция `UsageStats` в `defaultConfig`), src/main/settingsPatch.js (`UsageStats.enabled`), src/core/settings/GeneralSettings.jsx (`UsageStatsSettingsCard`), src/core/onboarding/OnboardingWizard.jsx (переключатель на шаге «You're all set»), stats-worker/ (Cloudflare Worker + D1: `src/index.js`, `src/stats.js`, `src/dashboard.js`, `schema.sql`, `wrangler.toml`), .github/workflows/stats-worker.yml (деплой), scripts/usage-stats.js (`npm run stats`), package.json (`usageStats.endpoint`)
**Тесты:** test/usageStats.test.js, test/usageStatsWorker.test.js, test/usageStatsReport.test.js; `node --test test/usageStats.test.js test/usageStatsWorker.test.js test/usageStatsReport.test.js`

## Назначение
Две цифры для аналитики: сколько раз приложение скачали и сколько людей реально им пользуется (за день, неделю, месяц). Скачивания уже считает GitHub, их нужно только собрать. Для пользователей нужен анонимный счётчик: раз в сутки приложение сообщает «эта установка жива», без данных о человеке, играх и библиотеке.

## Для пользователя
**Settings → General → Usage statistics → Send anonymous usage statistics** (по умолчанию включено). Тот же переключатель есть на последнем шаге мастера первого запуска. Выключили — больше ничего не отправляется, перезапуск не нужен.

Что уходит раз в сутки (UTC), и больше ничего:

| Поле | Пример | Откуда |
|---|---|---|
| `id` | `0f8fad5b-d9cb-469f-a165-70867728950e` | случайный UUID v4, создаётся на этом ПК при первом пинге, хранится в `usage-stats.json` в папке данных приложения |
| `version` | `1.9.0` | версия приложения |
| `platform` | `win32` / `linux` | ОС |
| `arch` | `x64` / `arm64` / `ia32` | архитектура процессора |

Сервер дополнительно записывает страну, которую Cloudflare определяет по IP; сам IP не сохраняется. Ничего об играх, файлах, путях, аккаунте F95 и хранилище сохранений не отправляется.

## Для разработчика: где смотреть цифры
- **Дашборд** — адрес worker'а в браузере (`https://f95launcher-stats.<аккаунт>.workers.dev`). Скачивания по релизам видны сразу (публичный GitHub API из браузера), пользователи — после ввода `STATS_TOKEN`. Периоды 7/30/90 дней и год; плитки «Скачивания», «Установок всего», «Сегодня», «За 7 дней», «За 30 дней», «Новых за 30 дней»; графики активных и новых по дням с таблицей; версии, системы и страны за 30 дней.
- **Терминал** — `npm run stats` (скачивания всегда; пользователи, если заданы `F95LAUNCHER_STATS_URL` и `F95LAUNCHER_STATS_TOKEN`). `npm run stats -- --days 90 --json` для выгрузки.

Как читать скачивания GitHub: «Установщики» — сумма скачиваний `.exe`, `.AppImage`, `.deb` (сюда же попадают полные загрузки при автообновлении); «Проверки обновлений» — запросы `latest.yml`/`latest-linux.yml`, их делает каждое запущенное приложение при проверке, поэтому это счётчик запусков, а не людей. `.blockmap` не считается.

## Развёртывание счётчика
Пошагово — в `stats-worker/README.md`. База D1 уже создана; worker разворачивает workflow `.github/workflows/stats-worker.yml` (при изменениях `stats-worker/` в `main` и вручную), ему нужны секреты репозитория `CLOUDFLARE_API_TOKEN` и `STATS_TOKEN`. После первого деплоя адрес worker'а вписывается в `package.json` → `usageStats.endpoint`, и выходит новый релиз. Пока поле пустое, приложение ничего не отправляет.

## Как это работает
1. `createUsageStatsReporter` (main) читает `usage-stats.json` (`installId`, `lastReportDay`). Если сегодняшний UTC‑день уже отмечен — ничего не делает. Иначе создаёт id (сразу пишет его на диск, чтобы сбой посреди запроса не породил второй), шлёт `POST <endpoint>/v1/ping` с четырьмя полями, таймаут 10 с; при ответе 2xx отмечает день. Ошибка сети или не‑2xx → день не отмечен, следующий прогон повторит с тем же id.
2. `usageStatsJob` (`createPeriodicJob`): первый прогон через 90 с после старта, далее каждый час (сеть трогается только при смене дня, поэтому лаунчер, живущий в трее неделями, засчитывается каждый день), плюс прогон через 60 с после выхода ПК из сна. `isEnabled` = есть endpoint и `UsageStats.enabled !== false`.
3. `resolveUsageStatsEndpoint`: переменная `F95LAUNCHER_USAGE_STATS_URL` важнее всего (для `npm run dev` против `wrangler dev`); без неё отправляет только упакованная сборка и только на `package.json → usageStats.endpoint`. Допускается только `https://` и `http://localhost`/`127.0.0.1`.
4. Worker (`stats-worker/src/stats.js`, вход `src/index.js`): `POST /v1/ping` проверяет размер (≤ 2 КБ), JSON и каждое поле по белому списку (UUID v4 в нижнем регистре, semver, `win32|linux|darwin`, `x64|arm64|ia32`), остальное отбрасывает; в одной транзакции upsert в `installs` (первый/последний день, первая/текущая версия, страна) и `daily_active` (день + id). `GET /v1/stats?days=N` (1…366, по умолчанию 30) только с `Authorization: Bearer <STATS_TOKEN>`, сравнение без раннего выхода. `GET /` — дашборд без данных, с жёстким CSP (`connect-src 'self' https://api.github.com`). Cron раз в сутки удаляет строки `daily_active` старше 400 дней.
5. Активные за 7/30 дней — число различных id в `daily_active` за окно; «новые» — по `installs.first_seen`; версии/системы/страны — по установкам с `last_seen` в последние 30 дней.

## Контракт
- Конфиг (`config.ini`): `UsageStats.enabled` (true), через `update-settings`; renderer не может записать ничего, кроме `enabled`.
- Файл состояния: `<data>/usage-stats.json` = `{ "installId": "<uuid v4>", "lastReportDay": "YYYY-MM-DD" }`.
- `package.json`: `usageStats.endpoint` — базовый URL worker'а без завершающего `/`.
- API: `POST /v1/ping` → 204 / 400 / 405 / 413; `GET /v1/stats` → 200 / 401 / 503 (нет `STATS_TOKEN`). Ответ статистики: `{ generatedAt, today, days, totals: { installs, active1d, active7d, active30d, new30d }, daily: [{ day, active, new }], versions|platforms|countries: [{ name, users }] }`.
- Лог‑префикс: `[job:usage-stats]` (только при ошибке прогона).

## Граничные случаи и ошибки
- Нет сети / worker недоступен → предупреждение в лог, повтор через час и после сна.
- Повреждённый `usage-stats.json` → считается пустым, создаётся новый id (одна установка может посчитаться дважды — приемлемо).
- Несколько ПК с одним профилем (копия папки данных) → один id, считаются как одна установка.
- Переустановка с удалением данных приложения → новый id, «Установок всего» вырастет на один.
- Часы ПК сбиты → влияет только на то, когда приложение решит слать; день на сервере берётся по часам сервера.
- Подделка пингов возможна (эндпоинт публичный): каждая поддельная запись — это лишний id, данные пользователей не затрагиваются. При необходимости — правило Rate Limiting в Cloudflare на `/v1/ping`.
- Dev‑запуск без переменной окружения ничего не отправляет и не создаёт файл.
