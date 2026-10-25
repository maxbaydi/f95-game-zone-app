const {
  MirrorActionRequiredError,
  MirrorError,
  buildAbsoluteUrl,
  cancelResponseBody,
  createHttpError,
  detectCaptchaKind,
  extractHtmlForms,
  getHeader,
  looksLikeCloudflareChallenge,
  normalizeHostname,
  parseHtmlTagAttributes,
  readResponseText,
  safeParseUrl,
  stripHtmlTags,
} = require("./common");

const F95_MASKED_CAPTCHA_MESSAGE =
  "This mirror needs captcha confirmation before F95Launcher can continue. Finish the captcha, then retry the install.";

/**
 * The download page hands its script-check code back after 2.1 s; the server
 * counts whole seconds and wants more than one full second.
 */
const F95_DOWNLOAD_CODE_DELAY_MS = 2100;

const F95_DOWNLOAD_EXPIRED_MESSAGE =
  "This F95 download link has expired (they work for a few hours after the game page was opened). Retry re-reads the game page for a fresh link.";

function isF95Hostname(hostname) {
  return /(^|\.)f95zone\.to$/i.test(normalizeHostname(hostname));
}

function isMaskedF95Link(parsedUrl) {
  return Boolean(
    parsedUrl && isF95Hostname(parsedUrl.hostname) && /\/masked\//i.test(parsedUrl.pathname),
  );
}

/**
 * Download page links that replaced masked links in starter posts:
 * `/dl/<postId>/?u=<user>&k=<link key>&r=<page opened at>&t=<token>`.
 * The target host is not in the URL; the thread shows it in the link text
 * and favicon.
 */
function isF95DownloadPageLink(parsedUrl) {
  return Boolean(
    parsedUrl && isF95Hostname(parsedUrl.hostname) && /^\/dl\/\d+\/?$/i.test(parsedUrl.pathname),
  );
}

/**
 * `k` and the post id stay the same when the thread is opened again; `r` and
 * `t` change, and the link expires a few hours after `r`.
 * @param {string | URL} value
 * @returns {{postId: string, key: string, renderedAt: number} | null}
 */
function parseF95DownloadPageLink(value) {
  const parsedUrl = typeof value === "string" ? safeParseUrl(value) : value;
  if (!isF95DownloadPageLink(parsedUrl)) {
    return null;
  }
  const postId = parsedUrl.pathname.match(/^\/dl\/(\d+)/i)[1];
  const key = parsedUrl.searchParams.get("k") || "";
  return key ? { postId, key, renderedAt: Number(parsedUrl.searchParams.get("r")) || 0 } : null;
}

/**
 * Same as the page's own script: "c", then the code reversed, in base64.
 * @param {string} hidden
 */
function decodeF95DownloadCode(hidden) {
  const encoded = String(hidden || "").replace(/^c/, "");
  if (!encoded || !/^[A-Za-z0-9+/]+=*$/.test(encoded)) {
    return "";
  }
  return Buffer.from(encoded, "base64").toString("latin1").split("").reverse().join("");
}

function isF95AttachmentLink(parsedUrl) {
  return Boolean(
    parsedUrl &&
      isF95Hostname(parsedUrl.hostname) &&
      /\/attachments\//i.test(parsedUrl.pathname),
  );
}

/**
 * F95 masked links usually carry the target host in the path:
 * `/masked/mega.nz/2/123456/AbCdEf`.
 * @param {string | URL} value
 */
function extractMaskedTargetHost(value) {
  const parsedUrl = typeof value === "string" ? safeParseUrl(value) : value;
  if (!isMaskedF95Link(parsedUrl)) {
    return "";
  }

  const segments = parsedUrl.pathname.split("/").filter(Boolean);
  const maskedIndex = segments.findIndex((segment) => segment.toLowerCase() === "masked");
  const candidate = normalizeHostname(segments[maskedIndex + 1] || "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(candidate) ? candidate : "";
}

/**
 * @param {any} ctx
 * @param {string} maskedUrl
 */
async function resolveMaskedF95Target(ctx, maskedUrl) {
  const requestBody = new URLSearchParams({
    xhr: "1",
    download: "1",
  }).toString();

  const response = await ctx.fetch(maskedUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
    },
    body: requestBody,
  });

  if (!response.ok) {
    const status = Number(response.status) || 0;
    const body = status === 403 || status === 503 ? await readResponseText(response, 100000) : "";
    if (!body) {
      await cancelResponseBody(response);
    }
    if (body && looksLikeCloudflareChallenge(body)) {
      throw new MirrorActionRequiredError(F95_MASKED_CAPTCHA_MESSAGE, {
        code: "captcha_required",
        actionUrl: maskedUrl,
        userMessage: F95_MASKED_CAPTCHA_MESSAGE,
        hostLabel: "F95zone",
      });
    }
    const httpError = createHttpError(response, "F95zone");
    throw new MirrorError(`F95 masked link failed with HTTP ${status}.`, {
      code: httpError.code,
      status,
      retryable: httpError.retryable,
      retryAfterMs: httpError.retryAfterMs,
      userMessage: httpError.userMessage,
    });
  }

  let payload = null;
  const contentType = getHeader(response, "content-type");
  if (typeof response.json === "function" && !/text\/html/i.test(contentType)) {
    payload = await response.json().catch(() => null);
  } else {
    const text = await readResponseText(response);
    try {
      payload = JSON.parse(text);
    } catch {
      if (looksLikeCloudflareChallenge(text)) {
        throw new MirrorActionRequiredError(F95_MASKED_CAPTCHA_MESSAGE, {
          code: "captcha_required",
          actionUrl: maskedUrl,
          userMessage: F95_MASKED_CAPTCHA_MESSAGE,
          hostLabel: "F95zone",
        });
      }
      payload = null;
    }
  }

  if (!payload || typeof payload !== "object") {
    throw new MirrorError("F95 masked link returned an invalid response.", {
      code: "invalid_response",
      retryable: true,
    });
  }

  if (payload.status === "ok" && payload.msg) {
    return String(payload.msg).trim();
  }

  if (payload.status === "captcha") {
    throw new MirrorActionRequiredError(
      "This masked F95 link now requires captcha confirmation. Open the mirror in the embedded browser and finish the captcha there.",
      {
        code: "captcha_required",
        actionUrl: maskedUrl,
        userMessage: F95_MASKED_CAPTCHA_MESSAGE,
        hostLabel: "F95zone",
      },
    );
  }

  throw new MirrorError(
    String(payload.msg || "F95 did not return a downloadable mirror for this thread."),
    { code: "masked_link_failed" },
  );
}

function isExternalHttpUrl(value) {
  const parsedUrl = safeParseUrl(value);
  return Boolean(
    parsedUrl && /^https?:$/i.test(parsedUrl.protocol) && !isF95Hostname(parsedUrl.hostname),
  );
}

function withoutScripts(html) {
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ");
}

/**
 * Host URL of the "taking you to the host" page (`f95dl_go`): its
 * `data-url`, the meta refresh, or the "Nothing happening?" link.
 * @param {string} html
 * @param {string} pageUrl
 */
function extractF95DownloadTarget(html, pageUrl) {
  const source = withoutScripts(html);
  const candidates = [];
  const goTag = source.match(/<[a-z][a-z0-9]*\b([^>]*\bdata-xf-init\s*=\s*"[^"]*\bf95dl-go\b[^"]*"[^>]*)>/i);
  if (goTag) {
    candidates.push(parseHtmlTagAttributes(goTag[1])["data-url"]);
  }
  const refresh = source.match(/<meta\b([^>]*http-equiv\s*=\s*["']?refresh[^>]*)>/i);
  if (refresh) {
    candidates.push(
      String(parseHtmlTagAttributes(refresh[1]).content || "").replace(/^\s*\d*\s*;?\s*url\s*=\s*/i, ""),
    );
  }
  const goingLink = source.match(/class="[^"]*\bf95dl-going-link\b[^"]*"[^>]*>[\s\S]*?<a\b([^>]*)>/i);
  if (goingLink) {
    candidates.push(parseHtmlTagAttributes(goingLink[1]).href);
  }

  for (const candidate of candidates) {
    const url = buildAbsoluteUrl(pageUrl, candidate || "");
    if (isExternalHttpUrl(url)) {
      return url;
    }
  }
  return "";
}

function isF95DownloadForm(form) {
  return /\bf95dl-box\b/.test(form.attributes.class || "") && form.method === "POST";
}

function createF95DownloadCaptchaError(pageUrl) {
  return new MirrorActionRequiredError(F95_MASKED_CAPTCHA_MESSAGE, {
    code: "captcha_required",
    actionUrl: pageUrl,
    userMessage: F95_MASKED_CAPTCHA_MESSAGE,
    hostLabel: "F95zone",
  });
}

function formAsksForCaptcha(form) {
  return Boolean(detectCaptchaKind(form.innerHtml) || /captcha/i.test(form.innerHtml));
}

/**
 * Error for a page that is neither the download page nor the way to the host:
 * an expired link, a forum message ("You must be logged-in…"), an HTTP error.
 * @param {Response} response
 * @param {string} html
 * @param {string} pageUrl
 */
function describeF95DownloadPageFailure(response, html, pageUrl) {
  if (looksLikeCloudflareChallenge(html)) {
    return createF95DownloadCaptchaError(pageUrl);
  }
  const status = Number(response.status) || 0;
  const messageMatch = withoutScripts(html).match(
    /<div\b[^>]*class="blockMessage(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const message = messageMatch ? stripHtmlTags(messageMatch[1]) : "";
  if (/expired/i.test(message)) {
    return new MirrorError(F95_DOWNLOAD_EXPIRED_MESSAGE, { code: "link_expired", status });
  }
  if (message) {
    return new MirrorError(`F95zone: ${message}`, { code: "masked_link_failed", status });
  }
  if (!response.ok) {
    return createHttpError(response, "F95zone");
  }
  return new MirrorError("The F95 download page returned an unexpected answer.", {
    code: "invalid_response",
    retryable: true,
  });
}

/**
 * Resolve an F95 download page link the way the page does in a browser:
 * open it, hand back its script-check code (more than one second later),
 * submit the Continue form and read the host URL from the answer.
 * @param {any} ctx
 * @param {string} pageUrl
 */
async function resolveF95DownloadPage(ctx, pageUrl) {
  const response = await ctx.fetch(pageUrl, {
    method: "GET",
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  const openedAt = Date.now();
  const html = await readResponseText(response);
  const form = extractHtmlForms(html, pageUrl).find(isF95DownloadForm);
  if (!form) {
    const target = extractF95DownloadTarget(html, pageUrl);
    if (target) {
      return target;
    }
    throw describeF95DownloadPageFailure(response, html, pageUrl);
  }
  if (formAsksForCaptcha(form)) {
    throw createF95DownloadCaptchaError(pageUrl);
  }

  const fields = { ...form.fields };
  const pageTag = html.match(/<div\b([^>]*\bdata-xf-init\s*=\s*"[^"]*\bf95dl-page\b[^"]*"[^>]*)>/i);
  const code = pageTag ? parseHtmlTagAttributes(pageTag[1])["data-code"] : "";
  if (code) {
    const codeInput = form.inputs.find((input) =>
      /\bjs-f95dlCode\b/.test(input.attributes.class || ""),
    );
    fields[codeInput?.name || "w"] = decodeF95DownloadCode(code);
  }
  const waitMs = F95_DOWNLOAD_CODE_DELAY_MS - (Date.now() - openedAt);
  if (waitMs > 0) {
    await ctx.sleep(waitMs);
  }

  const answer = await ctx.fetch(form.action, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      accept: "text/html,application/xhtml+xml",
      origin: new URL(pageUrl).origin,
      referer: pageUrl,
    },
    body: new URLSearchParams(fields).toString(),
  });
  const status = Number(answer.status) || 0;
  if (status >= 300 && status < 400) {
    const location = buildAbsoluteUrl(form.action, getHeader(answer, "location"));
    await cancelResponseBody(answer);
    if (isExternalHttpUrl(location)) {
      return location;
    }
    throw new MirrorError("F95 sent the download back to its own pages instead of the host.", {
      code: "masked_link_failed",
      retryable: true,
    });
  }

  const answerHtml = await readResponseText(answer);
  const target = extractF95DownloadTarget(answerHtml, form.action);
  if (target) {
    return target;
  }
  const againForm = extractHtmlForms(answerHtml, pageUrl).find(isF95DownloadForm);
  if (againForm && formAsksForCaptcha(againForm)) {
    throw createF95DownloadCaptchaError(pageUrl);
  }
  if (againForm) {
    throw new MirrorError("F95 did not accept the download check yet.", {
      code: "masked_link_failed",
      retryable: true,
    });
  }
  throw describeF95DownloadPageFailure(answer, answerHtml, pageUrl);
}

module.exports = {
  F95_DOWNLOAD_CODE_DELAY_MS,
  decodeF95DownloadCode,
  extractF95DownloadTarget,
  extractMaskedTargetHost,
  isF95AttachmentLink,
  isF95DownloadPageLink,
  isF95Hostname,
  isMaskedF95Link,
  parseF95DownloadPageLink,
  resolveF95DownloadPage,
  resolveMaskedF95Target,
};
