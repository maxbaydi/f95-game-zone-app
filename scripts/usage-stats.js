#!/usr/bin/env node
// @ts-check

// Prints how many people downloaded and use F95Launcher:
//   - downloads per release from the public GitHub API (always available);
//   - installs and daily/weekly/monthly users from the stats worker
//     (stats-worker/, docs/usage-stats.md) when its URL and token are given.
//
//   npm run stats
//   npm run stats -- --days 90 --json
//
// Environment: F95LAUNCHER_STATS_URL, F95LAUNCHER_STATS_TOKEN, and optionally
// GITHUB_TOKEN to lift the GitHub API rate limit.

const DEFAULT_REPO = "maxbaydi/f95-game-zone-app";
const INSTALLER_PATTERN = /\.(exe|appimage|deb|rpm|dmg|zip)$/i;
const UPDATE_FEED_PATTERN = /^latest.*\.ya?ml$/i;

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
function parseArgs(argv, env) {
  const options = {
    repo: env.F95LAUNCHER_STATS_REPO || DEFAULT_REPO,
    url: env.F95LAUNCHER_STATS_URL || "",
    token: env.F95LAUNCHER_STATS_TOKEN || "",
    githubToken: env.GITHUB_TOKEN || "",
    days: 30,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => String(argv[++index] ?? "");
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--url") {
      options.url = next();
    } else if (arg === "--token") {
      options.token = next();
    } else if (arg === "--repo") {
      options.repo = next();
    } else if (arg === "--days") {
      const days = Number.parseInt(next(), 10);
      options.days = Number.isFinite(days) ? Math.min(366, Math.max(1, days)) : 30;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  options.url = options.url.trim().replace(/\/+$/, "");
  return options;
}

/**
 * Splits GitHub asset download counts into installer downloads and update
 * checks (electron-updater fetches latest*.yml on every check). Blockmaps
 * are parts of differential updates and count as neither.
 *
 * @param {Array<{ tag_name?: string, published_at?: string | null, draft?: boolean, assets?: Array<{ name?: string, download_count?: number }> }>} releases
 */
function summarizeReleases(releases) {
  const rows = releases
    .filter((release) => !release.draft)
    .map((release) => {
      let installers = 0;
      let updateChecks = 0;
      for (const asset of release.assets || []) {
        const name = String(asset.name || "");
        const count = Number(asset.download_count) || 0;
        if (/\.blockmap$/i.test(name)) {
          continue;
        }
        if (UPDATE_FEED_PATTERN.test(name)) {
          updateChecks += count;
        } else if (INSTALLER_PATTERN.test(name)) {
          installers += count;
        }
      }
      return {
        tag: String(release.tag_name || ""),
        date: String(release.published_at || "").slice(0, 10),
        installers,
        updateChecks,
      };
    });
  return {
    releases: rows,
    installers: rows.reduce((sum, row) => sum + row.installers, 0),
    updateChecks: rows.reduce((sum, row) => sum + row.updateChecks, 0),
  };
}

/**
 * @param {string | number} text
 * @param {number} width
 */
const padStart = (text, width) => String(text).padStart(width);
/**
 * @param {string | number} text
 * @param {number} width
 */
const padEnd = (text, width) => String(text).padEnd(width);

/**
 * @param {{
 *   downloads: ReturnType<typeof summarizeReleases> | null,
 *   downloadsError?: string,
 *   usage: any,
 *   usageError?: string,
 *   usageConfigured: boolean,
 * }} report
 */
function formatReport(report) {
  const lines = [];
  lines.push("Скачивания с GitHub");
  if (report.downloads) {
    const { downloads } = report;
    lines.push(`  Установщики всего:     ${downloads.installers}`);
    lines.push(`  Проверки обновлений:   ${downloads.updateChecks}`);
    lines.push("");
    lines.push(`  ${padEnd("Релиз", 10)}${padEnd("Дата", 12)}${padStart("Установщики", 12)}${padStart("Проверки", 10)}`);
    for (const row of downloads.releases) {
      lines.push(
        `  ${padEnd(row.tag, 10)}${padEnd(row.date, 12)}${padStart(row.installers, 12)}${padStart(row.updateChecks, 10)}`,
      );
    }
  } else {
    lines.push(`  Не удалось получить релизы: ${report.downloadsError || "нет данных"}`);
  }

  lines.push("");
  lines.push("Пользователи (счётчик в приложении)");
  if (!report.usageConfigured) {
    lines.push("  Не настроен: задайте F95LAUNCHER_STATS_URL и F95LAUNCHER_STATS_TOKEN (docs/usage-stats.md).");
  } else if (!report.usage) {
    lines.push(`  Не удалось получить: ${report.usageError || "нет данных"}`);
  } else {
    const { usage } = report;
    const totals = usage.totals || {};
    lines.push(`  Установок всего:       ${totals.installs ?? 0}`);
    lines.push(`  Сегодня (UTC):         ${totals.active1d ?? 0}`);
    lines.push(`  За 7 дней:             ${totals.active7d ?? 0}`);
    lines.push(`  За 30 дней:            ${totals.active30d ?? 0}`);
    lines.push(`  Новых за 30 дней:      ${totals.new30d ?? 0}`);
    const list = (title, items) => {
      const text = (items || []).map((item) => `${item.name} — ${item.users}`).join(", ");
      lines.push(`  ${padEnd(title, 23)}${text || "нет данных"}`);
    };
    list("Версии (30 дней):", usage.versions);
    list("Системы (30 дней):", usage.platforms);
    list("Страны (30 дней):", usage.countries);
    const daily = (usage.daily || []).slice(-14);
    if (daily.length) {
      lines.push("");
      lines.push(`  ${padEnd("День", 12)}${padStart("Активные", 10)}${padStart("Новые", 8)}`);
      for (const point of daily) {
        lines.push(`  ${padEnd(point.day, 12)}${padStart(point.active, 10)}${padStart(point.new, 8)}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * @param {string} repo
 * @param {string} githubToken
 */
async function fetchReleases(repo, githubToken) {
  /** @type {any[]} */
  const all = [];
  for (let page = 1; page <= 5; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "f95launcher-stats-script",
          ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}),
        },
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub answered HTTP ${response.status}`);
    }
    const list = await response.json();
    all.push(...list);
    if (list.length < 100) {
      break;
    }
  }
  return all;
}

/**
 * @param {string} url
 * @param {string} token
 * @param {number} days
 */
async function fetchUsage(url, token, days) {
  const response = await fetch(`${url}/v1/stats?days=${days}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response.json();
}

async function main() {
  const options = parseArgs(process.argv.slice(2), process.env);
  const usageConfigured = Boolean(options.url && options.token);
  const [downloadsResult, usageResult] = await Promise.allSettled([
    fetchReleases(options.repo, options.githubToken).then(summarizeReleases),
    usageConfigured ? fetchUsage(options.url, options.token, options.days) : Promise.resolve(null),
  ]);
  const report = {
    downloads: downloadsResult.status === "fulfilled" ? downloadsResult.value : null,
    downloadsError:
      downloadsResult.status === "rejected" ? String(downloadsResult.reason?.message || downloadsResult.reason) : "",
    usage: usageResult.status === "fulfilled" ? usageResult.value : null,
    usageError:
      usageResult.status === "rejected" ? String(usageResult.reason?.message || usageResult.reason) : "",
    usageConfigured,
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReport(report)}\n`);
  }
  if (!report.downloads && (!usageConfigured || !report.usage)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  formatReport,
  parseArgs,
  summarizeReleases,
};
