const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MIRROR_TIERS,
  buildMirrorFallbackChain,
  describeMirrorLink,
  getMirrorDisplayName,
  getVariantPlatformId,
  pickRecommendedMirror,
  sortMirrorLinks,
} = require("../src/shared/f95MirrorAutomation");

const link = (host, order, extra = {}) => ({
  url: `https://f95zone.to/masked/${host}/${order}`,
  label: host.split(".")[0].toUpperCase(),
  host,
  order,
  ...extra,
});

test("describeMirrorLink classifies hosts by how automatable they are", () => {
  assert.equal(
    describeMirrorLink(link("pixeldrain.com", 0)).tier,
    MIRROR_TIERS.AUTO,
  );
  assert.equal(
    describeMirrorLink(link("gofile.io", 0)).tier,
    MIRROR_TIERS.AUTO,
  );
  assert.equal(
    describeMirrorLink(link("datanodes.to", 0)).tier,
    MIRROR_TIERS.AUTO,
  );
  assert.equal(
    describeMirrorLink(link("buzzheavier.com", 0)).tier,
    MIRROR_TIERS.AUTO,
  );
  assert.equal(
    describeMirrorLink(link("drive.google.com", 0)).tier,
    MIRROR_TIERS.AUTO,
  );
  assert.equal(
    describeMirrorLink(link("mixdrop.co", 0)).tier,
    MIRROR_TIERS.ASSISTED,
  );
  assert.equal(
    describeMirrorLink(link("uploadhaven.com", 0)).tier,
    MIRROR_TIERS.ASSISTED,
  );
  assert.equal(
    describeMirrorLink(link("mega.nz", 0)).tier,
    MIRROR_TIERS.MANUAL,
  );
  assert.equal(
    describeMirrorLink(link("filecrypt.cc", 0)).tier,
    MIRROR_TIERS.MANUAL,
  );
  assert.equal(
    describeMirrorLink(link("some-new-host.example", 0)).tier,
    MIRROR_TIERS.ASSISTED,
  );
});

test("describeMirrorLink flags link containers that download from other hosts", () => {
  assert.equal(
    describeMirrorLink(link("filecrypt.cc", 0)).redirectsToOtherHosts,
    true,
  );
  assert.equal(
    describeMirrorLink(link("mega.nz", 0)).redirectsToOtherHosts,
    false,
  );
});

test("describeMirrorLink treats direct Pixeldrain lists as browser-only", () => {
  const listLink = {
    url: "https://pixeldrain.com/l/abc123",
    host: "pixeldrain.com",
    label: "PIXELDRAIN",
  };
  const fileLink = {
    url: "https://pixeldrain.com/u/abc123",
    host: "pixeldrain.com",
    label: "PIXELDRAIN",
  };

  assert.equal(describeMirrorLink(listLink).tier, MIRROR_TIERS.MANUAL);
  assert.equal(describeMirrorLink(fileLink).tier, MIRROR_TIERS.AUTO);
});

test("sortMirrorLinks puts automatic hosts first and browser-only hosts last", () => {
  const sorted = sortMirrorLinks([
    link("mega.nz", 0),
    link("mixdrop.co", 1),
    link("gofile.io", 2),
    link("unknown-host.example", 3),
    link("pixeldrain.com", 4),
  ]);

  assert.deepEqual(
    sorted.map((entry) => entry.host),
    [
      "pixeldrain.com",
      "gofile.io",
      "mixdrop.co",
      "unknown-host.example",
      "mega.nz",
    ],
  );
});

test("sortMirrorLinks keeps thread order for hosts with the same rank", () => {
  const sorted = sortMirrorLinks([
    link("alpha.example", 5),
    link("beta.example", 1),
  ]);

  assert.deepEqual(
    sorted.map((entry) => entry.host),
    ["beta.example", "alpha.example"],
  );
});

test("getMirrorDisplayName uses known labels and falls back to the host token", () => {
  assert.equal(
    getMirrorDisplayName({ host: "drive.usercontent.google.com" }),
    "GOOGLE DRIVE",
  );
  assert.equal(getMirrorDisplayName({ host: "www.mixdrop.ag" }), "MIXDROP");
  assert.equal(getMirrorDisplayName({ host: "files.example.org" }), "FILES");
  assert.equal(
    getMirrorDisplayName({ label: "https://host.example/file" }),
    "HOST.EXAMPLE",
  );
  assert.equal(getMirrorDisplayName({}), "MIRROR");
});

test("getVariantPlatformId reads release and compressed variant ids", () => {
  assert.equal(getVariantPlatformId({ id: "windows-linux" }), "windows-linux");
  assert.equal(getVariantPlatformId({ id: "compressed-windows" }), "windows");
  assert.equal(
    getVariantPlatformId({ id: "release-ch-2-compressed-mac" }),
    "mac",
  );
  assert.equal(getVariantPlatformId({ id: "general" }), "general");
});

test("pickRecommendedMirror picks the Windows build on its best automatic host", () => {
  const variants = [
    {
      id: "android",
      label: "Android",
      firstOrder: 0,
      links: [link("pixeldrain.com", 0)],
    },
    {
      id: "windows",
      label: "Windows",
      firstOrder: 1,
      links: [link("mega.nz", 1), link("mixdrop.co", 2), link("gofile.io", 3)],
    },
    {
      id: "mac",
      label: "Mac",
      firstOrder: 4,
      links: [link("pixeldrain.com", 4)],
    },
  ];

  const recommendation = pickRecommendedMirror({ variants, platform: "win32" });

  assert.equal(recommendation.variant.id, "windows");
  assert.equal(recommendation.link.host, "gofile.io");
  assert.equal(recommendation.reason, "best-host");
});

test("pickRecommendedMirror follows the operating system", () => {
  const variants = [
    {
      id: "windows",
      label: "Windows",
      firstOrder: 0,
      links: [link("gofile.io", 0)],
    },
    {
      id: "mac",
      label: "Mac",
      firstOrder: 1,
      links: [link("pixeldrain.com", 1)],
    },
    {
      id: "linux",
      label: "Linux",
      firstOrder: 2,
      links: [link("datanodes.to", 2)],
    },
  ];

  assert.equal(
    pickRecommendedMirror({ variants, platform: "darwin" }).variant.id,
    "mac",
  );
  assert.equal(
    pickRecommendedMirror({ variants, platform: "linux" }).variant.id,
    "linux",
  );
});

test("pickRecommendedMirror prefers the full build when both builds are automatic", () => {
  const variants = [
    {
      id: "compressed-windows",
      label: "Compressed Windows",
      releaseLabel: "Compressed",
      firstOrder: 0,
      links: [link("pixeldrain.com", 0)],
    },
    {
      id: "windows",
      label: "Windows",
      firstOrder: 1,
      links: [link("gofile.io", 1)],
    },
  ];

  const recommendation = pickRecommendedMirror({ variants, platform: "win32" });

  assert.equal(recommendation.variant.id, "windows");
});

test("pickRecommendedMirror switches to the compressed build when only it is automatic", () => {
  const variants = [
    {
      id: "windows-linux",
      label: "Windows / Linux",
      firstOrder: 0,
      links: [link("mega.nz", 0)],
    },
    {
      id: "compressed-windows-linux",
      label: "Compressed Windows / Linux",
      releaseLabel: "Compressed",
      firstOrder: 1,
      links: [link("mega.nz", 1), link("pixeldrain.com", 2)],
    },
  ];

  const recommendation = pickRecommendedMirror({ variants, platform: "win32" });

  assert.equal(recommendation.variant.id, "compressed-windows-linux");
  assert.equal(recommendation.link.host, "pixeldrain.com");
});

test("pickRecommendedMirror stays on the first release instead of jumping to another chapter", () => {
  const variants = [
    {
      id: "release-chapter-1-windows",
      label: "Chapter 1 · Windows",
      releaseLabel: "Chapter 1",
      firstOrder: 0,
      links: [link("mega.nz", 0)],
    },
    {
      id: "release-chapter-2-windows",
      label: "Chapter 2 · Windows",
      releaseLabel: "Chapter 2",
      firstOrder: 1,
      links: [link("pixeldrain.com", 1)],
    },
  ];

  const recommendation = pickRecommendedMirror({ variants, platform: "win32" });

  assert.equal(recommendation.variant.id, "release-chapter-1-windows");
  assert.equal(recommendation.link.host, "mega.nz");
  assert.equal(recommendation.reason, "browser-only");
});

test("pickRecommendedMirror respects the remembered mirror unless it is browser-only", () => {
  const gofile = link("gofile.io", 1);
  const mega = link("mega.nz", 2);
  const variants = [
    {
      id: "windows",
      label: "Windows",
      firstOrder: 0,
      links: [link("pixeldrain.com", 0), gofile, mega],
    },
  ];

  const remembered = pickRecommendedMirror({
    variants,
    platform: "win32",
    preferredLinkUrl: gofile.url,
  });
  assert.equal(remembered.link.url, gofile.url);
  assert.equal(remembered.reason, "remembered");

  const rememberedManual = pickRecommendedMirror({
    variants,
    platform: "win32",
    preferredLinkUrl: mega.url,
  });
  assert.equal(rememberedManual.link.host, "pixeldrain.com");
  assert.equal(rememberedManual.reason, "best-host");
});

test("pickRecommendedMirror works from a flat link list and handles empty input", () => {
  const links = [link("mega.nz", 0), link("buzzheavier.com", 1)];

  assert.equal(pickRecommendedMirror({ links }).link.host, "buzzheavier.com");
  assert.equal(pickRecommendedMirror({ variants: [], links: [] }), null);
});

test("buildMirrorFallbackChain returns other automatable mirrors of the same build", () => {
  const primary = link("pixeldrain.com", 0);
  const variants = [
    {
      id: "windows",
      label: "Windows",
      links: [
        primary,
        link("mega.nz", 1),
        link("mixdrop.co", 2),
        link("gofile.io", 3),
        link("datanodes.to", 4),
        link("uploadhaven.com", 5),
      ],
    },
    { id: "mac", label: "Mac", links: [link("buzzheavier.com", 6)] },
  ];

  const chain = buildMirrorFallbackChain({ variants, link: primary });

  assert.deepEqual(
    chain.map((entry) => entry.host),
    ["gofile.io", "datanodes.to", "mixdrop.co"],
  );
  assert.deepEqual(
    buildMirrorFallbackChain({ variants, link: primary, limit: 1 }).map(
      (entry) => entry.host,
    ),
    ["gofile.io"],
  );
  assert.deepEqual(
    buildMirrorFallbackChain({ variants, link: { url: "https://unknown" } }),
    [],
  );
});
