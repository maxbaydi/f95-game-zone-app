# f95launcher-stats

Анонимный счётчик установок и активных пользователей F95Launcher: Cloudflare Worker + база D1. Укладывается в бесплатный тариф Cloudflare (Workers Free: 100 000 запросов в сутки; D1 Free: 5 ГБ и 5 млн чтений строк в сутки), сам не «засыпает». Что именно собирается и как устроено — `docs/usage-stats.md`.

## Развёртывание (один раз, ~10 минут)

Нужны Node.js 18+ и бесплатный аккаунт Cloudflare.

```powershell
cd stats-worker
npm install
npx wrangler login                          # откроется браузер, войти в Cloudflare
npx wrangler d1 create f95launcher-stats    # скопировать database_id из ответа
```

Вставить `database_id` в `wrangler.toml` вместо `REPLACE_WITH_DATABASE_ID`, затем:

```powershell
npm run db:init                             # создать таблицы в D1
npx wrangler secret put STATS_TOKEN         # ввести длинную случайную строку — пароль от статистики
npm run deploy                              # выведет адрес https://f95launcher-stats.<аккаунт>.workers.dev
```

Случайную строку для токена можно получить так: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.

## Подключение приложения

1. В корневом `package.json` заполнить адрес worker'а (без `/` в конце):
   ```json
   "usageStats": {
     "endpoint": "https://f95launcher-stats.<аккаунт>.workers.dev"
   }
   ```
2. Выпустить новую версию приложения. Счётчик пойдёт с установок, обновившихся до неё.

## Где смотреть

- Открыть адрес worker'а в браузере и ввести `STATS_TOKEN` (хранится только в этом браузере).
- Или в корне репозитория:
  ```powershell
  $env:F95LAUNCHER_STATS_URL = "https://f95launcher-stats.<аккаунт>.workers.dev"
  $env:F95LAUNCHER_STATS_TOKEN = "<токен>"
  npm run stats
  ```

## Локальная проверка

```powershell
cd stats-worker
npm run db:init:local
npm run dev                                 # http://localhost:8787
```

В другом окне, в корне репозитория:

```powershell
$env:F95LAUNCHER_USAGE_STATS_URL = "http://localhost:8787"
npm run dev
```

Первый пинг уходит через 90 секунд после запуска. Для локального дашборда токен задаётся в файле `stats-worker/.dev.vars` строкой `STATS_TOKEN=...` (файл не коммитить).

## Обслуживание

- Старые записи по дням (старше 400 дней) удаляются cron'ом раз в сутки; таблица установок хранит по одной строке на установку.
- Сменить токен: `npx wrangler secret put STATS_TOKEN` ещё раз.
- Выгрузить всё: `npx wrangler d1 export f95launcher-stats --remote --output=stats.sql`.
- Защита от накрутки (необязательно): в панели Cloudflare → Security → WAF → Rate limiting rules ограничить `POST /v1/ping`, например 20 запросов в минуту с одного IP.
