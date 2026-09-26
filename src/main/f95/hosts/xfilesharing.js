/**
 * Generic landing-page resolution used for XFileSharing-style hosts
 * (datanodes, racaty, nopy, send.cm, ...) and as the fallback for hosts that
 * have no dedicated resolver.
 */
const {
  MirrorError,
  buildAbsoluteUrl,
  cancelResponseBody,
  createActionRequiredError,
  createHttpError,
  detectCaptchaKind,
  extractAnchors,
  extractHtmlForms,
  extractHtmlTagAttributes,
  hostnameOf,
  isArchiveFileName,
  isFileResponse,
  isSameHostFamily,
  looksLikeCloudflareChallenge,
  normalizeHostname,
  normalizeText,
  parseBooleanAttribute,
  readResponseJson,
  readResponseText,
  readTagAttribute,
  safeDecodeHtmlEntities,
  safeParseUrl,
  stripHtmlTags,
} = require("./common");
const { resolveKnownFileHostUrl } = require("./pixeldrain");

const MAX_XFS_WAIT_SECONDS = 90;
const MAX_LANDING_STEPS = 5;
const XFS_NOT_FOUND_PATTERN =
  /file not found|file you were looking for could not be found|file (?:has been|was) (?:removed|deleted)|no longer available|file is not available|file has expired|file doesn't exist|file does not exist/i;

function parseCountdownLandingConfig(html, pageUrl) {
  const countdownAttributes = extractHtmlTagAttributes(
    html,
    "download-countdown",
  );
  if (!countdownAttributes) {
    return null;
  }

  const fileActionAttributes =
    extractHtmlTagAttributes(html, "file-actions") || {};
  const referer = readTagAttribute(countdownAttributes, ["referer"]) || pageUrl;
  const code =
    readTagAttribute(countdownAttributes, ["code"]) ||
    readTagAttribute(fileActionAttributes, ["code"]);

  if (!code) {
    return null;
  }

  return {
    code,
    referer,
    rand: readTagAttribute(countdownAttributes, ["rand"]),
    freeMethod: readTagAttribute(countdownAttributes, [
      "free-method",
      "freemethod",
    ]),
    premiumMethod: readTagAttribute(countdownAttributes, [
      "premium-method",
      "premiummethod",
    ]),
    countdown: Number(
      readTagAttribute(countdownAttributes, [":countdown", "countdown"]) || 0,
    ),
    hasCaptcha: parseBooleanAttribute(
      readTagAttribute(countdownAttributes, [":has-captcha", "has-captcha"]),
    ),
    hasPassword: parseBooleanAttribute(
      readTagAttribute(countdownAttributes, [":has-password", "has-password"]),
    ),
    hasCountdown: parseBooleanAttribute(
      readTagAttribute(countdownAttributes, [
        ":has-countdown",
        "has-countdown",
      ]),
    ),
    fileLink: readTagAttribute(fileActionAttributes, ["link"]),
    fileToken: readTagAttribute(fileActionAttributes, ["token"]),
  };
}

function decodePayloadUrl(value) {
  const text = String(value || "");
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Datanodes-style Vue landing page: POST op=download2 (XHR) → JSON {url}.
 * @param {any} ctx
 * @param {string} pageUrl
 * @param {NonNullable<ReturnType<typeof parseCountdownLandingConfig>>} config
 * @param {string} hostLabel
 */
async function submitCountdownLanding(ctx, pageUrl, config, hostLabel) {
  if (config.hasCaptcha) {
    throw createActionRequiredError(
      hostLabel,
      pageUrl,
      "asks for a captcha before downloading.",
      "captcha_required",
    );
  }

  if (config.hasPassword) {
    throw new MirrorError(
      "Password-protected mirrors are not supported for automatic install yet.",
      { code: "password_required" },
    );
  }

  const requestBody = new URLSearchParams({
    op: "download2",
    id: config.code,
    rand: config.rand || "",
    referer: config.referer || pageUrl,
    method_free: config.freeMethod || "",
    method_premium: config.premiumMethod || "",
    g_captch__a: "1",
  }).toString();

  let waited = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await ctx.fetch(pageUrl, {
      method: "POST",
      redirect: "manual",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        referer: config.referer || pageUrl,
        "x-requested-with": "XMLHttpRequest",
      },
      body: requestBody,
    });

    if (!response.ok) {
      await cancelResponseBody(response);
      const httpError = createHttpError(response, hostLabel);
      throw new MirrorError(
        `Mirror download handshake failed with HTTP ${response.status}. ${httpError.userMessage}`,
        {
          code: httpError.code,
          status: httpError.status,
          retryable: httpError.retryable,
          retryAfterMs: httpError.retryAfterMs,
        },
      );
    }

    const payload = await readResponseJson(response);
    const resolvedPayloadUrl = buildAbsoluteUrl(
      pageUrl,
      decodePayloadUrl(payload?.url),
    );
    if (resolvedPayloadUrl) {
      return resolvedPayloadUrl;
    }

    if (payload?.error && config.countdown > 0 && !waited) {
      waited = true;
      const waitSeconds = Math.min(config.countdown, MAX_XFS_WAIT_SECONDS);
      ctx.report(`Waiting ${waitSeconds}s for the ${hostLabel} countdown`);
      await ctx.sleep(waitSeconds * 1000 + 500);
      continue;
    }

    if (payload?.error) {
      throw new MirrorError(String(payload.error), { code: "mirror_error" });
    }
    break;
  }

  throw createActionRequiredError(
    hostLabel,
    pageUrl,
    "did not return a download link after the countdown.",
  );
}

function pickXfsForm(forms) {
  return (
    forms.find((form) =>
      /^download[1-3]$/i.test(String(form.fields.op || "").trim()),
    ) || null
  );
}

/**
 * Classic XFileSharing "type the digits" captcha: each digit is rendered in a
 * span positioned with padding-left, so sorting by that offset gives the code.
 * @param {string} html
 */
function solveXfsDigitCaptcha(html) {
  const digits = [];
  const spanPattern =
    /<span[^>]*style\s*=\s*["'][^"']*padding-left\s*:\s*(\d+)px[^"']*["'][^>]*>\s*([^<]{1,10})\s*<\/span>/gi;
  let match = null;

  while ((match = spanPattern.exec(String(html || "")))) {
    const character = safeDecodeHtmlEntities(match[2]).trim();
    if (/^\d$/.test(character)) {
      digits.push({ position: Number(match[1]), character });
    }
  }

  if (digits.length < 3) {
    return "";
  }

  return digits
    .sort((left, right) => left.position - right.position)
    .map((digit) => digit.character)
    .join("");
}

function parseXfsCountdownSeconds(html) {
  const text = String(html || "");
  const match =
    text.match(
      /<span[^>]*class\s*=\s*["'][^"']*\bseconds\b[^"']*["'][^>]*>\s*(\d{1,3})\s*<\/span>/i,
    ) ||
    text.match(
      /id\s*=\s*["']countdown[^"']*["'][^>]*>(?:\s|<[^>]+>|[A-Za-z:.])*?(\d{1,3})\b/i,
    ) ||
    text.match(/(?:var|let)\s+(?:countdown|seconds|cntdwn|timer)\s*=\s*(\d{1,3})\b/i);
  return match ? Number(match[1]) || 0 : 0;
}

function isLikelyErrorPage(html) {
  const headings = [];
  const headingPattern =
    /<(title|h1|h2|h3|b|div|p|span)\b([^>]*)>([\s\S]{0,300}?)<\/\1>/gi;
  let match = null;
  let inspected = 0;

  while ((match = headingPattern.exec(String(html || ""))) && inspected < 2000) {
    inspected += 1;
    const tagName = match[1].toLowerCase();
    const isErrorContainer = /\bclass\s*=\s*["'][^"']*\berr(?:or)?\b/i.test(
      match[2] || "",
    );
    if (["title", "h1", "h2", "h3"].includes(tagName) || isErrorContainer) {
      headings.push(stripHtmlTags(match[3]));
    }
    // Continue right after the opening tag name so nested headings are seen.
    headingPattern.lastIndex = match.index + match[1].length + 1;
  }

  return headings.some((heading) => XFS_NOT_FOUND_PATTERN.test(heading));
}

function isSameLandingPage(candidateUrl, pageUrl, originalUrl) {
  const candidate = safeParseUrl(candidateUrl);
  if (!candidate) {
    return true;
  }

  for (const reference of [pageUrl, originalUrl]) {
    const parsedReference = safeParseUrl(reference);
    if (!parsedReference) {
      continue;
    }
    if (
      normalizeHostname(candidate.hostname) ===
      normalizeHostname(parsedReference.hostname)
    ) {
      const candidateCode = candidate.pathname.split("/").filter(Boolean)[0] || "";
      const referenceCode =
        parsedReference.pathname.split("/").filter(Boolean)[0] || "";
      if (!candidateCode || candidateCode === referenceCode) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Find the direct file link on an XFileSharing result page.
 * @param {string} html
 * @param {string} pageUrl
 * @param {string} [originalUrl]
 */
function extractXfsDirectLink(html, pageUrl, originalUrl = "") {
  const text = String(html || "");
  const directSpan = text.match(
    /id\s*=\s*["']direct_link["'][\s\S]{0,400}?href\s*=\s*["']([^"']+)["']/i,
  );
  if (directSpan) {
    const directUrl = buildAbsoluteUrl(pageUrl, directSpan[1]);
    if (directUrl) {
      return directUrl;
    }
  }

  const anchors = extractAnchors(text, pageUrl).filter(
    (anchor) =>
      /^https?:/i.test(anchor.url) &&
      !/premium|login|register|signup|upgrade|pricing|torrent|affiliate/i.test(
        anchor.url,
      ) &&
      !isSameLandingPage(anchor.url, pageUrl, originalUrl),
  );

  const looksLikeFileUrl = (url) => {
    const parsedUrl = safeParseUrl(url);
    if (!parsedUrl) {
      return false;
    }
    const pathname = decodeURIComponent(parsedUrl.pathname || "");
    return (
      isArchiveFileName(pathname) ||
      /\.(apk|exe)$/i.test(pathname) ||
      /\/(?:d|dl|files?)\/[A-Za-z0-9_-]{12,}\//.test(pathname)
    );
  };

  const labelledAnchor = anchors.find(
    (anchor) =>
      /click here to download|download (?:file|now)|direct (?:download )?link|start download/i.test(
        anchor.text,
      ) && looksLikeFileUrl(anchor.url),
  );
  if (labelledAnchor) {
    return labelledAnchor.url;
  }

  const fileAnchor = anchors.find(
    (anchor) =>
      looksLikeFileUrl(anchor.url) && isSameHostFamily(pageUrl, anchor.url),
  );
  if (fileAnchor) {
    return fileAnchor.url;
  }

  const scriptRedirect = text.match(
    /(?:window\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i,
  );
  if (scriptRedirect && looksLikeFileUrl(scriptRedirect[1])) {
    return scriptRedirect[1];
  }

  return "";
}

/**
 * Submit an XFileSharing `op=download1/2` form, honouring the free method,
 * countdowns and the digit captcha. Returns the raw response.
 */
async function submitXfsForm(ctx, form, html, pageUrl, hostLabel) {
  const op = String(form.fields.op || "").toLowerCase();
  const captchaKind =
    detectCaptchaKind(form.innerHtml) ||
    (op !== "download1" ? detectCaptchaKind(html) : "");
  if (captchaKind) {
    throw createActionRequiredError(
      hostLabel,
      pageUrl,
      `asks for a captcha (${captchaKind}) before downloading.`,
      "captcha_required",
    );
  }

  if (
    form.inputs.some(
      (input) => /^password$/i.test(input.name) && input.type !== "hidden",
    )
  ) {
    throw new MirrorError(
      `${hostLabel} mirror is password-protected, which F95Launcher cannot install automatically.`,
      { code: "password_required" },
    );
  }

  const fields = { ...form.fields };
  const freeSubmit = form.inputs.find((input) => /method_free/i.test(input.name));
  if (freeSubmit) {
    fields[freeSubmit.name] = freeSubmit.value || "Free Download";
  } else if (op === "download1" && !fields.method_free) {
    fields.method_free = "Free Download";
  }

  if (Object.prototype.hasOwnProperty.call(fields, "code") && !fields.code) {
    const code = solveXfsDigitCaptcha(form.innerHtml) || solveXfsDigitCaptcha(html);
    if (!code) {
      throw createActionRequiredError(
        hostLabel,
        pageUrl,
        "asks for a captcha code before downloading.",
        "captcha_required",
      );
    }
    fields.code = code;
  }

  if (op !== "download1") {
    const waitSeconds = parseXfsCountdownSeconds(html);
    if (waitSeconds > MAX_XFS_WAIT_SECONDS) {
      throw createActionRequiredError(
        hostLabel,
        pageUrl,
        `asks you to wait ${waitSeconds}s before the free download.`,
      );
    }
    if (waitSeconds > 0) {
      ctx.report(`Waiting ${waitSeconds}s for the ${hostLabel} countdown`);
      await ctx.sleep(waitSeconds * 1000 + 500);
    }
  }

  const body = new URLSearchParams(fields).toString();
  if (form.method === "GET") {
    const actionUrl = new URL(form.action);
    for (const [name, value] of Object.entries(fields)) {
      actionUrl.searchParams.set(name, String(value));
    }
    return ctx.fetch(actionUrl.toString(), {
      method: "GET",
      redirect: "follow",
      headers: { referer: pageUrl },
    });
  }

  return ctx.fetch(form.action, {
    method: "POST",
    redirect: "follow",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: new URL(pageUrl).origin,
      referer: pageUrl,
    },
    body,
  });
}

function scoreHtmlDownloadCandidate(candidate) {
  const url = String(candidate?.url || "");
  const urlLower = url.toLowerCase();
  const context = normalizeText(candidate?.context || "").toLowerCase();
  let score = 0;

  if (/\/download(?:\/|$)|\/dl(?:\/|$)|[?&]download(?:=|&|$)/i.test(url)) {
    score += 80;
  }

  if (/direct/i.test(context)) {
    score += 25;
  }

  if (/download|get file|start/i.test(context)) {
    score += 35;
  }

  if (
    /pricing|terms|privacy|blog|help|contact|report|preview|show in browser/i.test(
      urlLower,
    )
  ) {
    score -= 120;
  }

  if (/pricing|terms|privacy|blog|help|contact|report|preview/i.test(context)) {
    score -= 80;
  }

  if (
    candidate?.attributeName &&
    /hx-get|href|formaction|action/i.test(candidate.attributeName)
  ) {
    score += 10;
  }

  return score;
}

function extractHtmlDownloadCandidates(pageUrl, html) {
  const candidates = [];
  const seen = new Set();
  const tagPattern = /<(a|button|form)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const attributePattern =
    /\b(href|hx-get|hx-post|data-href|data-url|formaction|action)\s*=\s*["']([^"']+)["']/gi;

  const pushCandidate = (attributeName, attributeValue, context) => {
    const absoluteUrl = buildAbsoluteUrl(pageUrl, attributeValue);
    if (!absoluteUrl || seen.has(`${attributeName}:${absoluteUrl}`)) {
      return;
    }

    if (!isSameHostFamily(pageUrl, absoluteUrl)) {
      return;
    }

    seen.add(`${attributeName}:${absoluteUrl}`);
    candidates.push({
      attributeName,
      url: absoluteUrl,
      context: normalizeText(context),
    });
  };

  let tagMatch = null;
  while ((tagMatch = tagPattern.exec(html))) {
    const [, tagName, attributes, innerHtml] = tagMatch;
    const context = normalizeText(
      safeDecodeHtmlEntities(
        `${attributes} ${String(innerHtml || "").replace(/<[^>]+>/g, " ")}`,
      ),
    );

    let attributeMatch = null;
    while ((attributeMatch = attributePattern.exec(attributes))) {
      pushCandidate(attributeMatch[1], attributeMatch[2], context || tagName);
    }
  }

  return candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreHtmlDownloadCandidate(candidate),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
}

/**
 * Legacy candidate walker: follows the best scored same-host links until it
 * reaches something that is not an HTML page. Returns the last URL reached.
 */
async function resolveHtmlLandingDownloadUrlWithContext(
  ctx,
  rawUrl,
  seenUrls = new Set(),
) {
  if (!rawUrl || seenUrls.has(rawUrl)) {
    return rawUrl;
  }

  seenUrls.add(rawUrl);

  const response = await ctx.fetch(rawUrl, {
    method: "GET",
    redirect: "follow",
  });

  if (!response.ok) {
    await cancelResponseBody(response);
    return response.url || rawUrl;
  }

  const finalUrl = response.url || rawUrl;
  if (isFileResponse(response)) {
    await cancelResponseBody(response);
    return finalUrl;
  }

  const html = await readResponseText(response);
  const candidates = extractHtmlDownloadCandidates(finalUrl, html);
  if (candidates.length === 0) {
    return finalUrl;
  }

  for (const candidate of candidates) {
    const normalizedCandidate = resolveKnownFileHostUrl(candidate.url);
    if (!normalizedCandidate || seenUrls.has(normalizedCandidate)) {
      continue;
    }

    const resolvedCandidate = await resolveHtmlLandingDownloadUrlWithContext(
      ctx,
      normalizedCandidate,
      seenUrls,
    );
    if (resolvedCandidate && resolvedCandidate !== finalUrl) {
      return resolvedCandidate;
    }
  }

  return finalUrl;
}

/**
 * Strict candidate walker for the generic resolver: only returns a URL that
 * was verified to serve a file (not an HTML page).
 */
async function findFileViaCandidates(ctx, pageUrl, html, seenUrls, depth = 0) {
  if (depth > 2) {
    return "";
  }

  const candidates = extractHtmlDownloadCandidates(pageUrl, html).slice(0, 4);
  for (const candidate of candidates) {
    const candidateUrl = resolveKnownFileHostUrl(candidate.url);
    if (!candidateUrl || seenUrls.has(candidateUrl)) {
      continue;
    }
    seenUrls.add(candidateUrl);

    const response = await ctx.fetch(candidateUrl, {
      method: "GET",
      redirect: "follow",
      headers: { referer: pageUrl },
    });
    if (!response.ok) {
      await cancelResponseBody(response);
      continue;
    }

    const finalUrl = response.url || candidateUrl;
    if (isFileResponse(response)) {
      await cancelResponseBody(response);
      return finalUrl;
    }

    const nestedHtml = await readResponseText(response);
    const nestedUrl = await findFileViaCandidates(
      ctx,
      finalUrl,
      nestedHtml,
      seenUrls,
      depth + 1,
    );
    if (nestedUrl) {
      return nestedUrl;
    }
  }

  return "";
}

/**
 * Generic landing-page resolver: countdown (datanodes), XFileSharing forms,
 * direct-link scraping and finally scored same-host download candidates.
 * @param {any} ctx
 * @param {string} rawUrl
 * @param {{hostLabel?: string}} [options]
 * @returns {Promise<string | {url: string, headers?: Record<string, string>}>}
 */
async function resolveGenericLandingTarget(ctx, rawUrl, options = {}) {
  const hostLabel = options.hostLabel || hostnameOf(rawUrl) || "This mirror";
  const seenUrls = new Set([rawUrl]);
  let currentUrl = rawUrl;
  let response = await ctx.fetch(rawUrl, { method: "GET", redirect: "follow" });

  /**
   * Links scraped from a page must be fetched the way a browser would: with
   * the page as Referer (qu.ax and several XFS hosts bounce back to the
   * landing page otherwise). Known-host links keep resolving instead.
   * @param {string} fileUrl
   * @param {string} pageUrl
   */
  const finalizeFromPage = (fileUrl, pageUrl) => {
    const next = ctx.continueOrFinal(fileUrl);
    if (typeof next === "string" || fileUrl === pageUrl) {
      return next;
    }
    return { ...next, headers: { ...(next.headers || {}), referer: pageUrl } };
  };

  for (let step = 0; step < MAX_LANDING_STEPS; step += 1) {
    const pageUrl = response.url || currentUrl;

    if (!response.ok) {
      const status = Number(response.status) || 0;
      if (status === 403 || status === 503) {
        const body = await readResponseText(response, 200000);
        if (looksLikeCloudflareChallenge(body) || detectCaptchaKind(body)) {
          throw createActionRequiredError(
            hostLabel,
            rawUrl,
            "requires browser verification (captcha / Cloudflare) before downloading.",
            "captcha_required",
          );
        }
      } else {
        await cancelResponseBody(response);
      }
      if (status === 404 || status === 410) {
        throw new MirrorError(
          `${hostLabel}: the file no longer exists (HTTP ${status}). Pick another mirror.`,
          { code: "not_found", status },
        );
      }
      throw createHttpError(response, hostLabel);
    }

    if (isFileResponse(response)) {
      await cancelResponseBody(response);
      return ctx.continueOrFinal(pageUrl);
    }

    const html = await readResponseText(response);

    if (isLikelyErrorPage(html)) {
      throw new MirrorError(
        `${hostLabel}: the file no longer exists or was removed. Pick another mirror.`,
        { code: "not_found" },
      );
    }

    const countdownConfig = parseCountdownLandingConfig(html, pageUrl);
    if (countdownConfig) {
      const downloadUrl = await submitCountdownLanding(
        ctx,
        pageUrl,
        countdownConfig,
        hostLabel,
      );
      return finalizeFromPage(downloadUrl, pageUrl);
    }

    const xfsForm = pickXfsForm(extractHtmlForms(html, pageUrl));
    if (xfsForm) {
      ctx.report(`Requesting ${hostLabel} free download`);
      response = await submitXfsForm(ctx, xfsForm, html, pageUrl, hostLabel);
      currentUrl = xfsForm.action;
      continue;
    }

    const directLink = extractXfsDirectLink(html, pageUrl, rawUrl);
    if (directLink) {
      return finalizeFromPage(directLink, pageUrl);
    }

    if (looksLikeCloudflareChallenge(html)) {
      throw createActionRequiredError(
        hostLabel,
        rawUrl,
        "requires browser verification (Cloudflare) before downloading.",
        "captcha_required",
      );
    }

    const candidateUrl = await findFileViaCandidates(ctx, pageUrl, html, seenUrls);
    if (candidateUrl) {
      return finalizeFromPage(candidateUrl, pageUrl);
    }

    const captchaKind = detectCaptchaKind(html);
    throw createActionRequiredError(
      hostLabel,
      rawUrl,
      captchaKind
        ? `asks for a captcha (${captchaKind}) before downloading.`
        : "page did not expose a direct download link that F95Launcher understands.",
      captchaKind ? "captcha_required" : "mirror_action_required",
    );
  }

  throw createActionRequiredError(
    hostLabel,
    rawUrl,
    "needed too many steps to reach the file.",
  );
}

module.exports = {
  extractHtmlDownloadCandidates,
  extractXfsDirectLink,
  parseCountdownLandingConfig,
  parseXfsCountdownSeconds,
  resolveGenericLandingTarget,
  resolveHtmlLandingDownloadUrlWithContext,
  solveXfsDigitCaptcha,
  submitCountdownLanding,
};
