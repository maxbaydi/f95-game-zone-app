# F95‑браузер: компактный тулбар, бейджи в адресной строке, плавающие уведомления

**Статус:** active
**Модули:** src/core/search/F95BrowserWorkspace.jsx (`ToolbarIconButton`, `WorkspaceNotice`, `TRANSFER_PHASE_META`, `CHIP_TONES`), src/App.jsx (пропсы `onOpenDownloads`, `onOpenLibraryRecord`), src/web-preview-api.js (`?demo=1&f95=thread`, `__f95LauncherDemo.f95Page`), scripts/screenshots.js (`09-f95-browser`), src/assets/css/main.css (классы `atlas-toast*` переиспользуются)
**Тесты:** `npm run check:jsx`; визуально — `SCREENSHOT_ONLY=09-f95-browser npm run screenshots`

## Назначение
Под шапкой встроенного браузера копились полосы: «в библиотеке», прогресс загрузки, статус, капча, ошибка установки, ошибка страницы — до шести одновременно, каждая на всю ширину. Тулбар был рядом текстовых кнопок. Теперь один ряд иконок, одна адресная строка, а всё, что раньше было полосами, стало либо чипом в тулбаре, либо компактной карточкой поверх страницы.

## Для пользователя
- **Тулбар (одна строка):** назад / вперёд / обновить (во время загрузки — стоп) / «Latest Updates» (домой) — иконки с подсказками; адресная строка с иконкой типа страницы, заголовком и путём; справа **Install** (accent) и **Add to Library** (иконка, подпись на широких окнах); за разделителем — «открыть в системном браузере» и «выйти». Полоска загрузки — 2 px по нижнему краю тулбара.
- **Бейдж в адресной строке** на странице темы: **Installed** (зелёный), **In library** (accent), **Files missing** (красный). Подсказка объясняет состояние; клик открывает игру в библиотеке.
- **Чип передачи** появляется в тулбаре, пока идёт загрузка/установка: спиннер, «Downloading 62%» с мини‑прогрессом или «Installing»; после завершения 6 с показывает «Installed» / «Failed» и исчезает; клик открывает панель загрузок.
- **Уведомления** — карточки в правом верхнем углу страницы, в стиле общих тостов: «Quick check on the page» / «Captcha on the page» (с кнопками «Open check page» и «Retry install», держится до решения), «Page did not load» (с «Reload page»), ошибка установки (до закрытия или перехода на другую страницу), проходящие статусы («Queued … installs in the background», «… was added to your library») — гаснут через 7 с, «ждём вашего шага» — пока передача не отчитается.
- **Кнопка Install** подписана по состоянию: Install / Install Again (файлы отсутствуют) / Installed / Checking… / Preparing…
- Экран входа: тот же смысл, обновлённые тексты и иконки.

## Как это работает
1. Полосы заменены массивом `notices`, вычисляемым из прежних состояний (`browserError`, `pendingCaptchaAction`, `installError`, `statusNotice`); закрытие карточки сбрасывает соответствующее состояние. `statusNotice = { text, tone, sticky, nonce }`; `sticky` → без таймера и со спиннером.
2. `WorkspaceNotice` рендерит разметку с классами `atlas-toast`, `atlas-toast__*` (анимация появления и полоска таймера — из общего CSS), но живёт внутри контейнера страницы, а не в глобальном `atlas-toast-viewport`.
3. Капча: сообщение в `statusMessage` больше не дублируется — инструкции только в карточке капчи.
4. `installError` очищается при смене `currentUrl`.
5. `threadInstallState.installState` теперь сохраняется (раньше терялось, и бейдж «Files missing» никогда не показывался).
6. Чип: `downloadState` из `f95-download-progress`; `transferChipVisible` гасится через `TRANSFER_CHIP_LINGER` для терминальных фаз.
7. Демо‑режим: `?demo=1&f95=thread` — вместо `<webview>` рендерится `<iframe srcdoc>` с вымышленной темой, `getF95ThreadInstallState` отвечает «в библиотеке», `installF95Thread` — `captcha_required`, `onF95DownloadProgress` присылает один прогресс, чтобы снимок показывал чип и карточку.

## Контракт
- `window.F95BrowserWorkspace` принимает `onOpenDownloads?: () => void`, `onOpenLibraryRecord?: (recordId) => void`.
- `data-notice="captcha|browser-error|install-error|status-<nonce>"` на карточках (для скриншотов/тестов), `role="toolbar" aria-label="F95 browser"`.

## Граничные случаи и ошибки
- Нет пропсов (старый вызов без App) → бейдж не кликабелен, чип без действия.
- Несколько уведомлений → стек сверху вниз по важности: ошибка страницы, капча, ошибка установки, статус.
- Узкое окно → путь адреса и подпись «Add to Library» скрываются, иконки остаются.

## Проверка
`SCREENSHOT_ONLY=09-f95-browser npm run screenshots` → `docs/screenshots/09-f95-browser.png`: тулбар, бейдж «In library», чип «Downloading 62%», карточка «Quick check on the page».

## История изменений
- 2026-09-29 — первая версия (релиз 1.7.0).
