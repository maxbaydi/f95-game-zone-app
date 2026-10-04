// Feature usage counts sent with the daily ping (docs/feature-usage-stats.md).
// The worker accepts any well-formed name so a new app version can report a
// new feature before the dashboard learns its label; the labels below are
// what the dashboard shows. A test keeps them in step with the app's list
// in src/main/featureUsage.js.

export const FEATURE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_FEATURE_NAME_LENGTH = 64;
export const MAX_FEATURES_PER_PING = 64;
export const MAX_FEATURE_USES = 100000;

export const FEATURE_GROUPS = {
  app: "Приложение",
  section: "Разделы",
  library: "Библиотека",
  import: "Добавление игр",
  catalog: "Каталог F95",
  downloads: "Загрузки",
  updates: "Обновления",
  saves: "Сохранения",
  settings: "Настройки",
};

export const FEATURE_LABELS = {
  "app.launch": "Запуск приложения",
  "section.library": "Открыли «Библиотеку»",
  "section.updates": "Открыли «Обновления»",
  "section.search": "Открыли поиск по F95",
  "section.settings": "Открыли настройки",
  "library.launch": "Запуск игры",
  "library.favorite": "Избранное",
  "library.rescan": "Пересканировать библиотеку",
  "library.link-catalog": "Привязка игры к каталогу F95",
  "library.remove": "Удаление игры или версии",
  "library.relocate": "Указать новую папку версии",
  "library.executable": "Выбор exe для запуска",
  "library.open-folder": "Открыть папку в проводнике",
  "library.backup": "Резервная копия библиотеки",
  "library.restore-backup": "Восстановление из резервной копии",
  "import.open": "Мастер импорта",
  "import.scan": "Сканирование папок с играми",
  "import.import": "Импорт найденных игр",
  "import.steam": "Импорт из Steam",
  "import.add-source": "Добавление папки для сканирования",
  "import.detect-folders": "Автопоиск папок с играми",
  "catalog.search": "Поиск по каталогу",
  "catalog.add-to-library": "Добавить игру с F95 в библиотеку",
  "catalog.login": "Вход в аккаунт F95",
  "downloads.install": "Скачать и установить с F95",
  "downloads.manual-install": "Установка из своего файла или папки",
  "downloads.retry": "Повтор загрузки или установки",
  "downloads.cancel": "Отмена загрузки",
  "downloads.browser-step": "Ручной шаг в браузере (капча, зеркало)",
  "downloads.open-panel": "Открыли панель загрузок",
  "updates.check-now": "Проверить обновления игр сейчас",
  "updates.app-install": "Установка обновления приложения",
  "saves.connect": "Подключение хранилища сохранений",
  "saves.sync": "Ручная синхронизация сохранений",
  "saves.export": "Экспорт сохранений",
  "saves.import": "Импорт сохранений",
  "saves.open-folder": "Открыть папку сохранений",
  "saves.transfer-card": "Перенос хранилища на другой ПК",
  "settings.emulator": "Настройка эмулятора",
  "settings.banner-template": "Шаблон баннеров",
  "settings.page-general": "Настройки: Общие",
  "settings.page-library": "Настройки: Библиотека",
  "settings.page-saves": "Настройки: Сохранения",
  "settings.page-notifications": "Настройки: Уведомления",
  "settings.page-appearance": "Настройки: Внешний вид",
  "settings.page-emulators": "Настройки: Эмуляторы",
  "settings.page-about": "Настройки: О программе",
};

/**
 * Keeps well-formed names with whole counts from 1 to MAX_FEATURE_USES and
 * drops the rest without failing the ping.
 *
 * @param {unknown} value the ping's "features" field
 * @returns {Record<string, number>}
 */
export function parseFeatures(value) {
  /** @type {Record<string, number>} */
  const features = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return features;
  }
  let kept = 0;
  for (const [name, count] of Object.entries(value)) {
    if (kept >= MAX_FEATURES_PER_PING) {
      break;
    }
    if (
      name.length <= MAX_FEATURE_NAME_LENGTH &&
      FEATURE_PATTERN.test(name) &&
      Number.isInteger(count) &&
      count >= 1 &&
      count <= MAX_FEATURE_USES
    ) {
      features[name] = count;
      kept += 1;
    }
  }
  return features;
}
