# f95launcher-stats

Анонимный счётчик установок и активных пользователей F95Launcher: Cloudflare Worker + база D1. Укладывается в бесплатный тариф Cloudflare (Workers Free: 100 000 запросов в сутки; D1 Free: 5 ГБ и 5 млн чтений строк в сутки), сам не «засыпает». Что именно собирается и как устроено — `docs/usage-stats.md`.

## Текущее состояние

Worker развёрнут: **https://f95launcher-stats.maxbayqoor.workers.dev** (аккаунт `account_id` из `wrangler.toml`, поддомен `maxbayqoor.workers.dev`). База D1 `f95launcher-stats` создана там же (id в `wrangler.toml`), таблицы из `schema.sql` применены, секрет `STATS_TOKEN` загружен, адрес вписан в корневой `package.json`. Ниже — как развернуть заново или обновить.

## Развёртывание через GitHub Actions

Workflow **Stats worker** (`.github/workflows/stats-worker.yml`) деплоит сам при каждом изменении `stats-worker/` в `main` и по кнопке Run workflow. Каждый прогон заново применяет `schema.sql` (безопасно: только `CREATE ... IF NOT EXISTS`), деплоит worker и загружает `STATS_TOKEN`. Пока в репозитории нет секрета `CLOUDFLARE_API_TOKEN`, прогон только пишет notice и ничего не меняет.

Чтобы включить:

1. Cloudflare → My Profile → API Tokens → Create Token → шаблон **Edit Cloudflare Workers** → в Permissions добавить строку **Account · D1 · Edit** → Continue to summary → Create Token. Скопировать токен.
2. Если в аккаунте ещё не было ни одного worker'а: открыть в панели Cloudflare раздел Workers & Pages и выбрать поддомен `workers.dev`. Без этого первый деплой остановится с просьбой зарегистрировать поддомен.
3. GitHub → репозиторий → Settings → Secrets and variables → Actions → New repository secret:
   - `CLOUDFLARE_API_TOKEN` — токен из шага 1;
   - `STATS_TOKEN` — длинный пароль от статистики, его же вводить на дашборде. Можно взять уже загруженный в worker или сгенерировать новый: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` (каждый прогон перезаписывает секрет worker'а этим значением);
   - `CLOUDFLARE_ACCOUNT_ID` не нужен: Account ID уже записан в `wrangler.toml`.
4. Actions → Stats worker → Run workflow. В логе шага Deploy будет адрес `https://f95launcher-stats.<поддомен>.workers.dev`.

## Развёртывание вручную

Нужны Node.js 18+ и вход в тот же аккаунт Cloudflare.

```powershell
cd stats-worker
npm install
npx wrangler login                          # откроется браузер, войти в Cloudflare
npm run db:init                             # таблицы в D1 (повторный запуск ничего не ломает)
npm run deploy                              # выведет адрес https://f95launcher-stats.<поддомен>.workers.dev
npx wrangler secret put STATS_TOKEN         # ввести пароль от статистики
```

Вместо `wrangler login` подойдёт API-токен аккаунта с правами Workers Scripts Edit и D1 Edit: `$env:CLOUDFLARE_API_TOKEN = "<токен>"` в том же окне.

Для другого аккаунта Cloudflare сначала `npx wrangler d1 create f95launcher-stats`, новые `database_id` и `account_id` в `wrangler.toml`, затем новый адрес в `package.json`.

## Подключение приложения

1. Адрес worker'а (без `/` в конце) уже записан в корневой `package.json`:
   ```json
   "usageStats": {
     "endpoint": "https://f95launcher-stats.maxbayqoor.workers.dev"
   }
   ```
   Тест `test/usageStats.test.js` следит, чтобы адрес не потерялся.
2. Выпустить новую версию приложения. Счётчик пойдёт с установок, обновившихся до неё.

## Где смотреть

- Личная ссылка без ввода токена: `https://f95launcher-stats.maxbayqoor.workers.dev/#key=<STATS_TOKEN>`. Ключ во фрагменте `#` не уходит на сервер; страница сохраняет его в этом браузере и убирает из адреса, дальше хватает обычного адреса. Ссылку для другого устройства даёт кнопка «Скопировать ссылку для входа». Ссылка равна паролю — не публиковать.
- Или открыть адрес worker'а и ввести `STATS_TOKEN` вручную.
- Блок «Что используют» — какие функции приложения используют (с версии 1.8.3), см. `docs/feature-usage-stats.md`.
- Или в корне репозитория:
  ```powershell
  $env:F95LAUNCHER_STATS_URL = "https://f95launcher-stats.maxbayqoor.workers.dev"
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
- Сменить токен: `npx wrangler secret put STATS_TOKEN` ещё раз. Старая ссылка `#key=` перестанет работать, страница попросит новый токен.
- Выгрузить всё: `npx wrangler d1 export f95launcher-stats --remote --output=stats.sql`.
- Защита от накрутки (необязательно): в панели Cloudflare → Security → WAF → Rate limiting rules ограничить `POST /v1/ping`, например 20 запросов в минуту с одного IP.
