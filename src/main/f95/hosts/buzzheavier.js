const {
  MirrorError,
  buildAbsoluteUrl,
  cancelResponseBody,
  createHttpError,
  getHeader,
  hostMatchesDomain,
  isFileResponse,
  safeParseUrl,
} = require("./common");
const { resolveGenericLandingTarget } = require("./xfilesharing");

const HOST_LABEL = "Buzzheavier";
const BUZZHEAVIER_DOMAINS = [
  "buzzheavier.com",
  "bzzhr.co",
  "bzzhr.to",
  "flashbang.sh",
  "trashbytes.net",
];

function isBuzzheavierHost(hostname) {
  return hostMatchesDomain(hostname, BUZZHEAVIER_DOMAINS);
}

/**
 * @param {string} rawUrl
 * @returns {null | {origin: string, id: string, direct: boolean}}
 */
function parseBuzzheavierUrl(rawUrl) {
  const parsedUrl = safeParseUrl(rawUrl);
  if (!parsedUrl || !isBuzzheavierHost(parsedUrl.hostname)) {
    return null;
  }

  const segments = parsedUrl.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  if (/^dl$/i.test(segments[0])) {
    return { origin: parsedUrl.origin, id: segments[1] || "", direct: true };
  }

  const id = /^f$/i.test(segments[0]) ? segments[1] || "" : segments[0];
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) {
    return null;
  }

  return { origin: parsedUrl.origin, id, direct: false };
}

function isSamePage(leftUrl, rightUrl) {
  const left = safeParseUrl(leftUrl);
  const right = safeParseUrl(rightUrl);
  return Boolean(
    left &&
      right &&
      left.origin === right.origin &&
      left.pathname.replace(/\/+$/, "") === right.pathname.replace(/\/+$/, ""),
  );
}

/**
 * Buzzheavier's download button is an htmx request: GET /{id}/download with
 * `hx-request: true` answers with an `hx-redirect` header pointing at the
 * real file URL (often on flashbang.sh / trashbytes.net).
 * @param {any} ctx
 * @param {string} rawUrl
 */
async function resolveBuzzheavierTarget(ctx, rawUrl) {
  const parsed = parseBuzzheavierUrl(rawUrl);
  if (!parsed) {
    return resolveGenericLandingTarget(ctx, rawUrl, { hostLabel: HOST_LABEL });
  }

  if (parsed.direct) {
    return { url: rawUrl, transfer: "direct" };
  }

  const pageUrl = `${parsed.origin}/${parsed.id}`;
  const response = await ctx.fetch(`${pageUrl}/download`, {
    method: "GET",
    redirect: "follow",
    headers: {
      accept: "*/*",
      "hx-request": "true",
      "hx-current-url": pageUrl,
      referer: pageUrl,
    },
  });

  const hxRedirect = getHeader(response, "hx-redirect");
  if (hxRedirect) {
    await cancelResponseBody(response);
    const redirectUrl = buildAbsoluteUrl(pageUrl, hxRedirect);
    // Without a valid Cloudflare clearance the endpoint answers 204 with an
    // hx-redirect back to the page itself; that is not a file.
    if (redirectUrl && !isSamePage(redirectUrl, pageUrl)) {
      return {
        url: redirectUrl,
        headers: { referer: pageUrl },
        transfer: "direct",
      };
    }
    if (redirectUrl) {
      return resolveGenericLandingTarget(ctx, pageUrl, { hostLabel: HOST_LABEL });
    }
  }

  if (response.status === 404 || response.status === 410) {
    await cancelResponseBody(response);
    throw new MirrorError("This Buzzheavier file no longer exists.", {
      code: "not_found",
      status: response.status,
    });
  }

  if (response.ok && isFileResponse(response)) {
    await cancelResponseBody(response);
    return {
      url: response.url || `${pageUrl}/download`,
      headers: { referer: pageUrl },
      transfer: "direct",
    };
  }

  await cancelResponseBody(response);
  if (response.status === 429 || response.status >= 500) {
    throw createHttpError(response, HOST_LABEL);
  }

  return resolveGenericLandingTarget(ctx, pageUrl, { hostLabel: HOST_LABEL });
}

module.exports = {
  BUZZHEAVIER_DOMAINS,
  HOST_LABEL,
  isBuzzheavierHost,
  parseBuzzheavierUrl,
  resolveBuzzheavierTarget,
};
