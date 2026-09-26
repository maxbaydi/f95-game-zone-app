const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_FALLBACK_LINKS,
  buildMirrorCandidates,
  isF95MaskedUrl,
  resolveMirrorWithFallback,
} = require("../src/main/f95/mirrorFallback");
const {
  MirrorActionRequiredError,
} = require("../src/main/f95/downloadSupport");

const candidate = (host, url = `https://${host}/file`) => ({
  url,
  host,
  label: host.toUpperCase(),
});

test("buildMirrorCandidates keeps the chosen mirror first and drops invalid or duplicate links", () => {
  const candidates = buildMirrorCandidates(candidate("pixeldrain.com"), [
    candidate("pixeldrain.com"),
    { url: "javascript:alert(1)", host: "evil" },
    candidate("gofile.io"),
    candidate("datanodes.to"),
    candidate("mixdrop.co"),
    candidate("uploadhaven.com"),
  ]);

  assert.equal(candidates[0].host, "pixeldrain.com");
  assert.deepEqual(
    candidates.slice(1).map((entry) => entry.host),
    ["gofile.io", "datanodes.to", "mixdrop.co"],
  );
  assert.equal(candidates.length, MAX_FALLBACK_LINKS + 1);
  assert.deepEqual(buildMirrorCandidates({ url: "" }, null), []);
});

test("isF95MaskedUrl only matches F95 masked links", () => {
  assert.equal(isF95MaskedUrl("https://f95zone.to/masked/abc/"), true);
  assert.equal(isF95MaskedUrl("https://f95zone.to/threads/game.1/"), false);
  assert.equal(isF95MaskedUrl("https://gofile.io/d/abc"), false);
  assert.equal(isF95MaskedUrl("not a url"), false);
});

test("resolveMirrorWithFallback returns the first mirror that resolves", async () => {
  const prepared = [];
  const result = await resolveMirrorWithFallback({
    candidates: [candidate("pixeldrain.com"), candidate("gofile.io")],
    prepare: async (url) => {
      prepared.push(url);
      return { resolvedUrl: `${url}?direct`, sourceHost: "pixeldrain.com" };
    },
  });

  assert.equal(result.candidate.host, "pixeldrain.com");
  assert.equal(
    result.prepared.resolvedUrl,
    "https://pixeldrain.com/file?direct",
  );
  assert.deepEqual(prepared, ["https://pixeldrain.com/file"]);
  assert.deepEqual(result.attempts, [
    {
      url: "https://pixeldrain.com/file",
      host: "pixeldrain.com",
      label: "PIXELDRAIN.COM",
      ok: true,
    },
  ]);
});

test("resolveMirrorWithFallback switches to the next mirror and reports every attempt", async () => {
  const events = [];
  const result = await resolveMirrorWithFallback({
    candidates: [candidate("gofile.io"), candidate("pixeldrain.com")],
    prepare: async (url) => {
      if (url.includes("gofile")) {
        throw new Error("Gofile rate limit");
      }
      return { resolvedUrl: url, sourceHost: "pixeldrain.com" };
    },
    onAttempt: (event) =>
      events.push(
        `${event.phase}:${event.candidate.host}:${event.index}/${event.total}`,
      ),
  });

  assert.equal(result.candidate.host, "pixeldrain.com");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].ok, false);
  assert.equal(result.attempts[0].error, "Gofile rate limit");
  assert.deepEqual(events, [
    "trying:gofile.io:0/2",
    "failed:gofile.io:0/2",
    "trying:pixeldrain.com:1/2",
    "resolved:pixeldrain.com:1/2",
  ]);
});

test("resolveMirrorWithFallback stops on an F95 captcha because it gates every masked mirror", async () => {
  const prepared = [];
  const maskedUrl = "https://f95zone.to/masked/gofile/1/";
  const result = await resolveMirrorWithFallback({
    candidates: [
      candidate("gofile.io", maskedUrl),
      candidate("pixeldrain.com", "https://f95zone.to/masked/pixeldrain/2/"),
    ],
    prepare: async (url) => {
      prepared.push(url);
      throw new MirrorActionRequiredError("captcha", {
        code: "captcha_required",
        actionUrl: url,
      });
    },
  });

  assert.equal(result.prepared, null);
  assert.deepEqual(prepared, [maskedUrl]);
  assert.equal(result.actionFailure.candidate.url, maskedUrl);
});

test("resolveMirrorWithFallback skips a host-specific check when another mirror works", async () => {
  const result = await resolveMirrorWithFallback({
    candidates: [candidate("mixdrop.co"), candidate("gofile.io")],
    prepare: async (url) => {
      if (url.includes("mixdrop")) {
        throw new MirrorActionRequiredError("Cloudflare", {
          code: "mirror_action_required",
          actionUrl: url,
        });
      }
      return { resolvedUrl: url, sourceHost: "gofile.io" };
    },
  });

  assert.equal(result.candidate.host, "gofile.io");
  assert.equal(result.attempts[0].actionRequired, true);
  assert.equal(result.actionFailure, null);
});

test("resolveMirrorWithFallback keeps the first browser check when nothing resolves", async () => {
  const result = await resolveMirrorWithFallback({
    candidates: [
      candidate("gofile.io"),
      candidate("mixdrop.co"),
      candidate("datanodes.to"),
    ],
    prepare: async (url) => {
      if (url.includes("mixdrop")) {
        throw new MirrorActionRequiredError("Cloudflare", {
          code: "mirror_action_required",
          actionUrl: url,
        });
      }
      throw new Error(`${url} is down`);
    },
  });

  assert.equal(result.prepared, null);
  assert.equal(result.attempts.length, 3);
  assert.equal(result.actionFailure.candidate.host, "mixdrop.co");
  assert.equal(result.lastError.message, "https://datanodes.to/file is down");
});
