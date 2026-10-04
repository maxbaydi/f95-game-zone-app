// The stats page served at "/". It holds no data or secrets: download counts
// come straight from the public GitHub API in the browser, usage numbers from
// /v1/stats with the token the viewer types in or opens the page with as
// "/#key=<token>" (kept in this browser only; the fragment never reaches the
// server). The two exported helpers run inside the page as they are.

import { FEATURE_GROUPS, FEATURE_LABELS } from "./features.js";

/**
 * @param {unknown} hash location.hash, e.g. "#key=abc"
 * @returns {string} the token from the link, or ""
 */
export function readKeyFromHash(hash) {
  var parts = String(hash || "").replace(/^#/, "").split("&");
  for (var index = 0; index < parts.length; index += 1) {
    if (parts[index].indexOf("key=") !== 0) {
      continue;
    }
    try {
      return decodeURIComponent(parts[index].slice(4)).trim();
    } catch (error) {
      return "";
    }
  }
  return "";
}

/**
 * Rows for the "what people use" table, most users first, plus the known
 * features nobody used in the window.
 *
 * @param {{ reporting: number, items: Array<{ name: string, users: number, uses: number }> } | undefined} features
 * @param {Record<string, string>} labels
 * @param {Record<string, string>} groups
 */
export function buildFeatureRows(features, labels, groups) {
  var items = (features && features.items) || [];
  var reporting = (features && features.reporting) || 0;
  var seen = {};
  var groupOf = function (name) {
    var prefix = name.split(".")[0];
    return groups[prefix] || prefix;
  };
  var used = items.map(function (item) {
    seen[item.name] = true;
    return {
      name: item.name,
      label: labels[item.name] || item.name,
      group: groupOf(item.name),
      users: item.users,
      share: reporting ? Math.round((item.users / reporting) * 100) : 0,
      uses: item.uses,
      perUser: item.users ? Math.round((item.uses / item.users) * 10) / 10 : 0,
    };
  });
  var unused = Object.keys(labels)
    .filter(function (name) { return !seen[name]; })
    .map(function (name) { return { name: name, label: labels[name], group: groupOf(name) }; });
  return { used: used, unused: unused };
}

const PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>F95Launcher Stats</title>
<style>
:root {
  color-scheme: light;
  --page: #f9f9f7;
  --surface: #fcfcfb;
  --ink: #0b0b0b;
  --ink-2: #52514e;
  --muted: #898781;
  --grid: #e1e0d9;
  --axis: #c3c2b7;
  --border: rgba(11, 11, 11, 0.10);
  --series-1: #2a78d6;
  --series-2: #eb6834;
  --error: #d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --page: #0d0d0d;
    --surface: #1a1a19;
    --ink: #ffffff;
    --ink-2: #c3c2b7;
    --muted: #898781;
    --grid: #2c2c2a;
    --axis: #383835;
    --border: rgba(255, 255, 255, 0.10);
    --series-1: #3987e5;
    --series-2: #d95926;
    --error: #e66767;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--page);
  color: var(--ink);
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 15px; margin: 0 0 4px; }
.sub { color: var(--ink-2); margin: 0 0 12px; font-size: 13px; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: 0 0 20px; }
.bar .spacer { flex: 1; }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.seg button { border: 0; background: transparent; color: var(--ink-2); padding: 6px 12px; font: inherit; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--series-1); color: #fff; }
button.link { border: 0; background: none; color: var(--ink-2); font: inherit; cursor: pointer; text-decoration: underline; padding: 4px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin: 0 0 16px; min-width: 0; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 0 0 16px; }
.tile { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
.tile .label { color: var(--ink-2); font-size: 13px; }
.tile .value { font-size: 28px; font-weight: 650; margin: 2px 0; }
.tile .hint { color: var(--muted); font-size: 12px; }
.grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.chart { position: relative; width: 100%; }
.chart svg { display: block; width: 100%; height: 200px; overflow: visible; }
.chart .hit { fill: transparent; cursor: default; }
.chart .hit:hover + .mark, .chart .mark.hover { opacity: 0.8; }
.tip { position: absolute; pointer-events: none; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font-size: 12px; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.15); display: none; z-index: 2; }
.tip strong { display: block; font-size: 14px; }
.tip span { color: var(--ink-2); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; color: var(--ink-2); font-weight: 500; padding: 4px 6px; border-bottom: 1px solid var(--grid); }
td { padding: 5px 6px; border-bottom: 1px solid var(--grid); vertical-align: middle; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.meter { height: 6px; background: var(--grid); border-radius: 3px; min-width: 40px; }
.meter span { display: block; height: 100%; background: var(--series-1); border-radius: 3px; }
.empty { color: var(--muted); padding: 8px 0; }
form.login { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
form.login input { flex: 1; min-width: 200px; padding: 8px 10px; border: 1px solid var(--axis); border-radius: 8px; background: var(--page); color: var(--ink); font: inherit; }
form.login button { padding: 8px 14px; border: 0; border-radius: 8px; background: var(--series-1); color: #fff; font: inherit; cursor: pointer; }
.error { color: var(--error); margin: 8px 0 0; }
details summary { cursor: pointer; color: var(--ink-2); margin-top: 8px; font-size: 13px; }
.scroll { overflow-x: auto; }
.loading { opacity: 0.55; transition: opacity 0.2s; }
footer { color: var(--muted); font-size: 12px; margin-top: 24px; }
.unused { color: var(--ink-2); font-size: 13px; margin: 12px 0 0; }
.unused strong { color: var(--ink); font-weight: 600; }
@media (max-width: 560px) {
  #releases .meter-cell, #features .meter-cell, #features .wide-cell { display: none; }
}
</style>
</head>
<body>
<main>
  <div class="bar">
    <h1>F95Launcher — статистика</h1>
    <span class="spacer"></span>
    <div class="seg" role="group" aria-label="Период" id="range">
      <button type="button" data-days="7">7 дней</button>
      <button type="button" data-days="30">30 дней</button>
      <button type="button" data-days="90">90 дней</button>
      <button type="button" data-days="365">Год</button>
    </div>
    <button type="button" class="link" id="refresh">Обновить</button>
    <button type="button" class="link" id="copy-link" hidden>Скопировать ссылку для входа</button>
    <button type="button" class="link" id="logout" hidden>Выйти</button>
  </div>

  <section class="tiles" id="tiles"></section>

  <section class="card" id="login" hidden>
    <h2>Пользователи приложения</h2>
    <p class="sub">Откройте страницу по своей ссылке вида <code>…/#key=&lt;STATS_TOKEN&gt;</code> или введите STATS_TOKEN здесь. Токен хранится только в этом браузере.</p>
    <form class="login" id="login-form">
      <input type="password" id="token" autocomplete="current-password" placeholder="STATS_TOKEN" required>
      <button type="submit">Показать</button>
    </form>
    <p class="error" id="login-error" hidden></p>
  </section>

  <div id="usage" hidden>
    <section class="card">
      <h2>Активные пользователи по дням</h2>
      <p class="sub">Сколько установок открывали приложение в этот день (UTC).</p>
      <div class="chart" id="chart-active"></div>
    </section>
    <section class="card">
      <h2>Новые установки по дням</h2>
      <p class="sub">День, когда установка впервые прислала пинг.</p>
      <div class="chart" id="chart-new"></div>
      <details>
        <summary>Таблица по дням</summary>
        <div class="scroll"><table id="daily-table"></table></div>
      </details>
    </section>
    <section class="card">
      <h2>Что используют</h2>
      <p class="sub" id="features-sub"></p>
      <div class="scroll"><table id="features"></table></div>
      <p class="unused" id="features-unused" hidden></p>
    </section>
    <div class="grid3">
      <section class="card"><h2>Версии</h2><p class="sub">Активные за 30 дней</p><table id="versions"></table></section>
      <section class="card"><h2>Системы</h2><p class="sub">Активные за 30 дней</p><table id="platforms"></table></section>
      <section class="card"><h2>Страны</h2><p class="sub">Активные за 30 дней</p><table id="countries"></table></section>
    </div>
  </div>

  <section class="card">
    <h2>Скачивания с GitHub по релизам</h2>
    <p class="sub">Установщики — скачивания .exe, .AppImage и .deb (вместе с автообновлениями). Проверки обновлений — сколько раз приложения запрашивали latest.yml этой версии.</p>
    <div class="scroll"><table id="releases"></table></div>
    <p class="sub" id="releases-total"></p>
    <p class="error" id="releases-error" hidden></p>
  </section>

  <footer id="footer"></footer>
</main>
<script>
(function () {
  "use strict";
  var REPO = __REPO_JSON__;
  var FEATURE_LABELS = __FEATURE_LABELS_JSON__;
  var FEATURE_GROUPS = __FEATURE_GROUPS_JSON__;
  ${readKeyFromHash}
  ${buildFeatureRows}
  var TOKEN_KEY = "f95launcher-stats.token";
  var DAYS_KEY = "f95launcher-stats.days";
  var numberFormat = new Intl.NumberFormat("ru-RU");
  var dayFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
  var fullDayFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  var shortDateFormat = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  var state = { days: 30, usage: null, downloads: null };

  function store(key, value) {
    try {
      if (value === null) { localStorage.removeItem(key); } else { localStorage.setItem(key, value); }
    } catch (error) { /* storage blocked: the page still works for this visit */ }
  }
  function load(key) {
    try { return localStorage.getItem(key); } catch (error) { return null; }
  }
  var token = load(TOKEN_KEY) || "";
  // A personal link "/#key=<token>" signs in without typing; the key is then
  // kept in this browser and removed from the address bar.
  var linkKey = readKeyFromHash(location.hash);
  if (linkKey) {
    token = linkKey;
    store(TOKEN_KEY, token);
  }
  if (/(^#|&)key=/.test(location.hash)) {
    history.replaceState(null, "", location.pathname + location.search);
  }
  var savedDays = Number(load(DAYS_KEY));
  if ([7, 30, 90, 365].indexOf(savedDays) !== -1) { state.days = savedDays; }

  function $(id) { return document.getElementById(id); }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }
  function fmt(value) { return numberFormat.format(value || 0); }
  function parseDay(day) { return new Date(day + "T00:00:00Z"); }

  function renderTiles() {
    var tiles = $("tiles");
    tiles.textContent = "";
    var items = [];
    if (state.downloads) {
      items.push(["Скачивания", state.downloads.installers, "установщики всех версий с GitHub"]);
    }
    if (state.usage) {
      var t = state.usage.totals;
      items.push(["Установок всего", t.installs, "уникальных с момента включения счётчика"]);
      items.push(["Сегодня", t.active1d, "открывали приложение (UTC)"]);
      items.push(["За 7 дней", t.active7d, "активных пользователей"]);
      items.push(["За 30 дней", t.active30d, "активных пользователей"]);
      items.push(["Новых за 30 дней", t.new30d, "первый запуск"]);
    }
    items.forEach(function (item) {
      var tile = el("div", "tile");
      tile.appendChild(el("div", "label", item[0]));
      tile.appendChild(el("div", "value", fmt(item[1])));
      tile.appendChild(el("div", "hint", item[2]));
      tiles.appendChild(tile);
    });
  }

  // About four gridlines on whole-number steps of 1, 2 or 5 x 10^n, so every
  // tick label is exact.
  function niceScale(maxValue) {
    var target = Math.max(1, maxValue);
    var raw = target / 4;
    var power = Math.pow(10, Math.floor(Math.log10(raw)));
    var step = power * 10;
    [1, 2, 5].some(function (multiple) {
      if (multiple * power >= raw) { step = multiple * power; return true; }
      return false;
    });
    step = Math.max(1, step);
    var count = Math.max(1, Math.ceil(target / step));
    return { step: step, count: count, top: step * count };
  }

  var SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach(function (key) { node.setAttribute(key, String(attrs[key])); });
    return node;
  }

  // Bars with 4px rounded tops anchored to the baseline, a 2px gap between
  // bars, a hairline grid and a per-bar hover tooltip.
  function barChart(container, points, key, color, label) {
    container.textContent = "";
    var width = Math.max(280, container.clientWidth || 600);
    var height = 200;
    var margin = { top: 8, right: 4, bottom: 22, left: 40 };
    var plotW = width - margin.left - margin.right;
    var plotH = height - margin.top - margin.bottom;
    var scale = niceScale(points.reduce(function (m, p) { return Math.max(m, p[key]); }, 0));
    var max = scale.top;
    var svg = svgEl("svg", { viewBox: "0 0 " + width + " " + height, role: "img", "aria-label": label });
    var tip = el("div", "tip");

    for (var tickIndex = 0; tickIndex <= scale.count; tickIndex += 1) {
      var tickValue = scale.step * tickIndex;
      var tickY = margin.top + plotH - plotH * (tickValue / max);
      svg.appendChild(svgEl("line", { x1: margin.left, x2: width - margin.right, y1: tickY, y2: tickY, stroke: tickIndex === 0 ? "var(--axis)" : "var(--grid)", "stroke-width": 1 }));
      var tick = svgEl("text", { x: margin.left - 6, y: tickY + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)" });
      tick.textContent = fmt(tickValue);
      svg.appendChild(tick);
    }

    var slot = plotW / points.length;
    var gap = slot > 4 ? 2 : 0;
    var barW = Math.max(1, slot - gap);
    points.forEach(function (point, index) {
      var x = margin.left + index * slot + gap / 2;
      var value = point[key];
      var h = max ? (value / max) * plotH : 0;
      var y = margin.top + plotH - h;
      var hit = svgEl("rect", { x: margin.left + index * slot, y: margin.top, width: slot, height: plotH, class: "hit" });
      svg.appendChild(hit);
      var mark = null;
      if (h > 0) {
        var r = Math.min(4, barW / 2, h);
        var d = "M" + x + "," + (y + h) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y +
          "H" + (x + barW - r) + "Q" + (x + barW) + "," + y + " " + (x + barW) + "," + (y + r) + "V" + (y + h) + "Z";
        mark = svgEl("path", { d: d, fill: color, class: "mark" });
        mark.style.pointerEvents = "none";
        svg.appendChild(mark);
      }
      hit.addEventListener("pointermove", function (event) {
        tip.textContent = "";
        tip.appendChild(el("strong", "", fmt(value)));
        tip.appendChild(el("span", "", fullDayFormat.format(parseDay(point.day))));
        tip.style.display = "block";
        var box = container.getBoundingClientRect();
        var left = event.clientX - box.left + 12;
        if (left + tip.offsetWidth > box.width) { left = event.clientX - box.left - tip.offsetWidth - 12; }
        tip.style.left = left + "px";
        tip.style.top = Math.max(0, event.clientY - box.top - 40) + "px";
        if (mark) { mark.classList.add("hover"); }
      });
      hit.addEventListener("pointerleave", function () {
        tip.style.display = "none";
        if (mark) { mark.classList.remove("hover"); }
      });
    });

    var labelIndexes = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : points.map(function (_, i) { return i; });
    labelIndexes.forEach(function (index, position) {
      var anchor = position === 0 ? "start" : position === labelIndexes.length - 1 ? "end" : "middle";
      var x = anchor === "start" ? margin.left : anchor === "end" ? width - margin.right : margin.left + (index + 0.5) * slot;
      var text = svgEl("text", { x: x, y: height - 6, "text-anchor": anchor, "font-size": 11, fill: "var(--muted)" });
      text.textContent = dayFormat.format(parseDay(points[index].day));
      svg.appendChild(text);
    });

    container.appendChild(svg);
    container.appendChild(tip);
  }

  function fillTable(table, headers, rows, meterColumn) {
    table.textContent = "";
    if (!rows.length) {
      var emptyRow = el("tr");
      var cell = el("td", "empty", "Пока нет данных");
      cell.colSpan = headers.length;
      emptyRow.appendChild(cell);
      table.appendChild(emptyRow);
      return;
    }
    var cellClass = function (header) {
      return [header.num ? "num" : header.meter ? "meter-cell" : "", header.className || ""].join(" ").trim();
    };
    var head = el("tr");
    headers.forEach(function (header) { head.appendChild(el("th", cellClass(header), header.label)); });
    table.appendChild(head);
    var max = meterColumn === undefined ? 0 : rows.reduce(function (m, row) { return Math.max(m, row[meterColumn]); }, 0);
    rows.forEach(function (row) {
      var tr = el("tr");
      headers.forEach(function (header, index) {
        if (header.meter) {
          var td = el("td", "meter-cell");
          var meter = el("div", "meter");
          var fill = el("span");
          fill.style.width = (max ? Math.round((row[meterColumn] / max) * 100) : 0) + "%";
          meter.appendChild(fill);
          td.appendChild(meter);
          tr.appendChild(td);
          return;
        }
        var value = row[index];
        var text = header.format ? header.format(value) : header.num ? fmt(value) : String(value);
        tr.appendChild(el("td", cellClass(header), text));
      });
      table.appendChild(tr);
    });
  }

  function renderUsage() {
    var usage = state.usage;
    $("usage").hidden = !usage;
    $("login").hidden = Boolean(usage);
    $("logout").hidden = !token;
    $("copy-link").hidden = !usage;
    if (!usage) { return; }
    barChart($("chart-active"), usage.daily, "active", "var(--series-1)", "Активные пользователи по дням");
    barChart($("chart-new"), usage.daily, "new", "var(--series-2)", "Новые установки по дням");
    var dailyRows = usage.daily.slice().reverse().map(function (p) { return [fullDayFormat.format(parseDay(p.day)), p.active, p.new]; });
    fillTable($("daily-table"), [{ label: "День" }, { label: "Активные", num: true }, { label: "Новые", num: true }], dailyRows);
    var breakdownHeaders = function (title) { return [{ label: title }, { label: "", meter: true }, { label: "Польз.", num: true }]; };
    var toRows = function (list) { return list.map(function (item) { return [item.name, null, item.users]; }); };
    fillTable($("versions"), breakdownHeaders("Версия"), toRows(usage.versions), 2);
    fillTable($("platforms"), breakdownHeaders("Система"), toRows(usage.platforms), 2);
    fillTable($("countries"), breakdownHeaders("Страна"), toRows(usage.countries), 2);
    renderFeatures(usage.features);
    $("footer").textContent = "Данные пользователей обновлены " + new Date(usage.generatedAt).toLocaleString("ru-RU") + ".";
  }

  var decimalFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
  function renderFeatures(features) {
    var reporting = (features && features.reporting) || 0;
    var rows = buildFeatureRows(features, FEATURE_LABELS, FEATURE_GROUPS);
    $("features-sub").textContent = reporting
      ? "За выбранный период. Доля — от " + fmt(reporting) + " пользователей, приславших данные о функциях (версия 1.8.3 и новее). Сначала самое востребованное."
      : "Учёт функций есть в приложении с версии 1.8.3; цифры появятся, когда пользователи обновятся.";
    fillTable(
      $("features"),
      [
        { label: "Функция" },
        { label: "Раздел", className: "wide-cell" },
        { label: "", meter: true },
        { label: "Польз.", num: true },
        { label: "Доля", num: true, format: function (value) { return value + " %"; } },
        { label: "Раз", num: true },
        { label: "На польз.", num: true, className: "wide-cell", format: function (value) { return decimalFormat.format(value); } },
      ],
      rows.used.map(function (r) { return [r.label, r.group, null, r.users, r.share, r.uses, r.perUser]; }),
      3
    );
    var unused = $("features-unused");
    unused.textContent = "";
    unused.hidden = !reporting || !rows.unused.length;
    if (!unused.hidden) {
      unused.appendChild(el("strong", "", "Не использовали за период: "));
      unused.appendChild(document.createTextNode(rows.unused.map(function (r) { return r.label; }).join(", ") + "."));
    }
  }

  function summarizeReleases(releases) {
    var rows = releases.filter(function (release) { return !release.draft; }).map(function (release) {
      var installers = 0;
      var updateChecks = 0;
      (release.assets || []).forEach(function (asset) {
        var name = asset.name || "";
        var count = asset.download_count || 0;
        if (/\\.blockmap$/i.test(name)) { return; }
        if (/^latest.*\\.ya?ml$/i.test(name)) { updateChecks += count; return; }
        if (/\\.(exe|appimage|deb|rpm|dmg|zip)$/i.test(name)) { installers += count; }
      });
      return { tag: release.tag_name, date: (release.published_at || "").slice(0, 10), installers: installers, updateChecks: updateChecks };
    });
    return {
      releases: rows,
      installers: rows.reduce(function (sum, row) { return sum + row.installers; }, 0),
      updateChecks: rows.reduce(function (sum, row) { return sum + row.updateChecks; }, 0),
    };
  }

  function renderDownloads() {
    var downloads = state.downloads;
    if (!downloads) { return; }
    var rows = downloads.releases.map(function (r) { return [r.tag, r.date ? shortDateFormat.format(parseDay(r.date)) : "", r.installers, null, r.updateChecks]; });
    fillTable($("releases"), [{ label: "Релиз" }, { label: "Дата" }, { label: "Установщики", num: true }, { label: "", meter: true }, { label: "Проверки", num: true }], rows, 2);
    $("releases-total").textContent = "Всего: " + fmt(downloads.installers) + " скачиваний установщиков, " + fmt(downloads.updateChecks) + " проверок обновлений.";
  }

  function loadDownloads() {
    if (!REPO) { return Promise.resolve(); }
    var all = [];
    function page(n) {
      return fetch("https://api.github.com/repos/" + REPO + "/releases?per_page=100&page=" + n, { headers: { accept: "application/vnd.github+json" } })
        .then(function (response) {
          if (!response.ok) { throw new Error("GitHub ответил HTTP " + response.status); }
          return response.json();
        })
        .then(function (list) {
          all = all.concat(list);
          return list.length === 100 && n < 5 ? page(n + 1) : all;
        });
    }
    return page(1).then(function (releases) {
      state.downloads = summarizeReleases(releases);
      $("releases-error").hidden = true;
      renderDownloads();
      renderTiles();
    }).catch(function (error) {
      $("releases-error").textContent = "Не удалось получить релизы: " + error.message;
      $("releases-error").hidden = false;
    });
  }

  function loadUsage() {
    if (!token) {
      state.usage = null;
      renderUsage();
      renderTiles();
      return Promise.resolve();
    }
    document.body.classList.add("loading");
    return fetch("/v1/stats?days=" + state.days, { headers: { authorization: "Bearer " + token } })
      .then(function (response) {
        if (response.status === 401) {
          token = "";
          store(TOKEN_KEY, null);
          throw new Error("Неверный токен.");
        }
        if (!response.ok) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            throw new Error(body.error || "HTTP " + response.status);
          });
        }
        return response.json();
      })
      .then(function (usage) {
        state.usage = usage;
        $("login-error").hidden = true;
      })
      .catch(function (error) {
        state.usage = null;
        $("login-error").textContent = error.message;
        $("login-error").hidden = false;
      })
      .then(function () {
        document.body.classList.remove("loading");
        renderUsage();
        renderTiles();
      });
  }

  function syncRange() {
    Array.prototype.forEach.call($("range").querySelectorAll("button"), function (button) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.days) === state.days));
    });
  }

  $("range").addEventListener("click", function (event) {
    var button = event.target.closest("button");
    if (!button) { return; }
    state.days = Number(button.dataset.days);
    store(DAYS_KEY, String(state.days));
    syncRange();
    loadUsage();
  });
  $("refresh").addEventListener("click", function () { loadUsage(); loadDownloads(); });
  $("copy-link").addEventListener("click", function () {
    var link = location.origin + location.pathname + "#key=" + encodeURIComponent(token);
    var done = function () { $("copy-link").textContent = "Ссылка скопирована"; };
    var fallback = function () { window.prompt("Ссылка для входа (держите её в секрете):", link); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, fallback);
    } else {
      fallback();
    }
  });
  $("logout").addEventListener("click", function () {
    token = "";
    store(TOKEN_KEY, null);
    state.usage = null;
    renderUsage();
    renderTiles();
  });
  $("login-form").addEventListener("submit", function (event) {
    event.preventDefault();
    token = $("token").value.trim();
    $("token").value = "";
    store(TOKEN_KEY, token);
    loadUsage();
  });
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderUsage, 150);
  });

  syncRange();
  renderUsage();
  loadUsage();
  loadDownloads();
})();
</script>
</body>
</html>
`;

/**
 * @param {{ repo: string }} options
 */
export function renderDashboard(options) {
  const repo = /^[\w.-]+\/[\w.-]+$/.test(options.repo || "") ? options.repo : "";
  const toScript = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
  return PAGE.replace("__REPO_JSON__", () => toScript(repo))
    .replace("__FEATURE_LABELS_JSON__", () => toScript(FEATURE_LABELS))
    .replace("__FEATURE_GROUPS_JSON__", () => toScript(FEATURE_GROUPS));
}
