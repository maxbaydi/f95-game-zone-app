(function attachF95MirrorAutomation(globalScope) {
  const MIRROR_TIERS = Object.freeze({
    AUTO: "auto",
    ASSISTED: "assisted",
    MANUAL: "manual",
  });

  const TIER_ORDER = {
    [MIRROR_TIERS.AUTO]: 0,
    [MIRROR_TIERS.ASSISTED]: 1,
    [MIRROR_TIERS.MANUAL]: 2,
  };

  const TIER_INFO = {
    [MIRROR_TIERS.AUTO]: {
      label: "Auto",
      title: "Installs automatically",
      description:
        "F95Launcher downloads and installs this mirror without any extra steps.",
    },
    [MIRROR_TIERS.ASSISTED]: {
      label: "Auto*",
      title: "Usually automatic",
      description:
        "F95Launcher tries it automatically. If the host shows a check, a window opens and the download continues once it passes.",
    },
    [MIRROR_TIERS.MANUAL]: {
      label: "Browser",
      title: "Needs you in the browser",
      description:
        "This host asks for a captcha or login. F95Launcher opens the page: finish the step there, or download the file in your own browser and pick it, and the game is installed for you.",
    },
  };

  // Tiers follow the live mirror check (docs/mirror-verification.md) and the
  // main-process host registry, which marks links as "auto" or "browser".
  // Lower rank = recommended and tried first inside the same tier.
  const HOST_PROFILES = [
    {
      id: "pixeldrain",
      label: "PIXELDRAIN",
      pattern: /(^|\.)(?:pixeldrain\.(?:com|net|dev)|pixeldra\.in)$/i,
      tier: MIRROR_TIERS.AUTO,
      rank: 10,
      note: "Direct download through the official API; interrupted downloads resume.",
    },
    {
      id: "gofile",
      label: "GOFILE",
      pattern: /(^|\.)gofile\.io$/i,
      tier: MIRROR_TIERS.AUTO,
      rank: 20,
      note: "Fast, but may be rate-limited at peak times.",
    },
    {
      id: "google-drive",
      label: "GOOGLE DRIVE",
      pattern: /(^|\.)(?:drive|docs|drive\.usercontent)\.google\.com$/i,
      tier: MIRROR_TIERS.AUTO,
      rank: 30,
      note: "Popular files can hit Google's daily download quota.",
    },
    {
      id: "mediafire",
      label: "MEDIAFIRE",
      pattern: /(^|\.)mediafire\.com$/i,
      tier: MIRROR_TIERS.AUTO,
      rank: 40,
      note: "Direct download.",
    },
    {
      id: "mega",
      label: "MEGA",
      pattern: /(^|\.)mega\.(?:nz|io|app|co\.nz)$/i,
      tier: MIRROR_TIERS.AUTO,
      rank: 45,
      note: "Downloaded and decrypted by F95Launcher; interrupted downloads resume.",
    },
    {
      id: "dropbox",
      label: "DROPBOX",
      pattern: /(^|\.)(?:dropbox\.com|dropboxusercontent\.com)$/i,
      tier: MIRROR_TIERS.AUTO,
      rank: 50,
      note: "Direct download.",
    },
    {
      id: "yandex-disk",
      label: "YANDEX DISK",
      pattern: /(^|\.)(?:disk\.yandex\.[a-z.]+|disk\.360\.yandex\.ru|yadi\.sk)$/i,
      tier: MIRROR_TIERS.AUTO,
      rank: 55,
      note: "Direct download.",
    },
    {
      id: "catbox",
      label: "CATBOX",
      pattern: /(^|\.)catbox\.moe$/i,
      tier: MIRROR_TIERS.AUTO,
      rank: 60,
      note: "Direct file link.",
    },
    {
      id: "pomf",
      label: "QU.AX",
      pattern: /(^|\.)(?:qu\.ax|uguu\.se|0x0\.st|pomf2?\.lain\.la)$/i,
      tier: MIRROR_TIERS.AUTO,
      rank: 65,
      note: "Direct file link.",
    },
    {
      id: "dailyuploads",
      label: "DAILYUPLOADS",
      pattern: /(^|\.)dailyuploads\.net$/i,
      tier: MIRROR_TIERS.AUTO,
      rank: 70,
      note: "Includes a one-minute countdown that F95Launcher waits out.",
    },
    {
      id: "buzzheavier",
      label: "BUZZHEAVIER",
      pattern:
        /(^|\.)(?:buzzheavier\.com|bzzhr\.(?:co|to)|flashbang\.sh|trashbytes\.net)$/i,
      tier: MIRROR_TIERS.ASSISTED,
      rank: 110,
      note: "May show a Cloudflare check in a window; it usually passes on its own.",
    },
    {
      id: "filesfm",
      label: "FILES.FM",
      pattern: /(^|\.)files\.fm$/i,
      tier: MIRROR_TIERS.ASSISTED,
      rank: 120,
      note: "May show a Cloudflare check in a window; it usually passes on its own.",
    },
    {
      id: "onedrive",
      label: "ONEDRIVE",
      pattern: /(^|\.)(?:1drv\.ms|onedrive\.live\.com|sharepoint\.com)$/i,
      tier: MIRROR_TIERS.ASSISTED,
      rank: 150,
      note: "Microsoft sometimes asks to open the page first.",
    },
    {
      id: "datanodes",
      label: "DATANODES",
      pattern: /(^|\.)datanodes\.to$/i,
      tier: MIRROR_TIERS.MANUAL,
      rank: 200,
      note: "Captcha on the download button; easiest to finish in your own browser.",
    },
    {
      id: "mixdrop",
      label: "MIXDROP",
      pattern: /(^|\.)(?:mixdrop|mxdrop|mixdrp|m1xdrop|mixdropjmk)\./i,
      tier: MIRROR_TIERS.MANUAL,
      rank: 205,
      note: "Captcha and bot check; easiest to finish in your own browser.",
    },
    {
      id: "krakenfiles",
      label: "KRAKENFILES",
      pattern: /(^|\.)krakenfiles\.com$/i,
      tier: MIRROR_TIERS.MANUAL,
      rank: 210,
      note: "Captcha on the download button.",
    },
    {
      id: "uploadhaven",
      label: "UPLOADHAVEN",
      pattern: /(^|\.)uploadhaven\.com$/i,
      tier: MIRROR_TIERS.MANUAL,
      rank: 215,
      note: "hCaptcha before every free download.",
    },
    {
      id: "workupload",
      label: "WORKUPLOAD",
      pattern: /(^|\.)workupload\.com$/i,
      tier: MIRROR_TIERS.MANUAL,
      rank: 220,
      note: "Puzzle check before the download.",
    },
    {
      id: "xfs-captcha",
      label: "",
      pattern: /(^|\.)(?:send\.(?:cm|now)|usersdrive\.com|hexload\.com|hexupload\.net)$/i,
      tier: MIRROR_TIERS.MANUAL,
      rank: 225,
      note: "Captcha on the download button.",
    },
    {
      id: "filecrypt",
      label: "FILECRYPT",
      pattern: /(^|\.)filecrypt\.(?:cc|co)$/i,
      tier: MIRROR_TIERS.MANUAL,
      rank: 240,
      note: "Link container protected by a captcha.",
    },
  ];

  const UNKNOWN_HOST_PROFILE = {
    id: "",
    label: "",
    tier: MIRROR_TIERS.ASSISTED,
    rank: 190,
    note: "Less common host. F95Launcher will try it automatically.",
  };

  const REGISTRY_AUTO_PROFILE = {
    id: "",
    label: "",
    tier: MIRROR_TIERS.ASSISTED,
    rank: 180,
    note: "Supported host; it may ask for a quick check.",
  };

  const PLATFORM_IDS = [
    "windows-linux",
    "windows",
    "linux",
    "mac",
    "android",
    "ios",
  ];

  const PLATFORM_SCORES = {
    win32: { "windows-linux": 3, windows: 3, general: 2 },
    linux: { "windows-linux": 3, linux: 3, general: 2, windows: 1 },
    darwin: { mac: 3, general: 2, "windows-linux": 1 },
  };

  function normalizeHost(value) {
    return String(value || "")
      .trim()
      .replace(/^www\./i, "")
      .toLowerCase();
  }

  function getMirrorHostProfile(host) {
    const hostname = normalizeHost(host);
    if (!hostname) {
      return null;
    }

    return (
      HOST_PROFILES.find((profile) => profile.pattern.test(hostname)) || null
    );
  }

  function describeMirrorLink(link) {
    const profile =
      getMirrorHostProfile(link?.host) ||
      (link?.support === "auto" ? REGISTRY_AUTO_PROFILE : UNKNOWN_HOST_PROFILE);
    const result = {
      hostId: profile.id,
      tier: profile.tier,
      rank: profile.rank,
      note: profile.note,
    };

    // The host registry decides per link (folders, password-protected MEGA
    // links, captcha-only hosts), so "browser" always wins.
    if (link?.support === "browser" && result.tier !== MIRROR_TIERS.MANUAL) {
      return {
        ...result,
        tier: MIRROR_TIERS.MANUAL,
        rank: Math.max(result.rank, 230),
        note: "This link needs a captcha, login or waiting page.",
      };
    }

    return result;
  }

  function getMirrorTierInfo(tier) {
    return TIER_INFO[tier] || TIER_INFO[MIRROR_TIERS.ASSISTED];
  }

  function getMirrorDisplayName(link) {
    const profile = getMirrorHostProfile(link?.host);
    if (profile?.label) {
      return profile.label;
    }

    const registryLabel = String(link?.hostLabel || "").trim();
    if (registryLabel && registryLabel !== normalizeHost(link?.host)) {
      return registryLabel.toUpperCase();
    }

    const token = normalizeHost(link?.host).split(".").filter(Boolean)[0];
    if (token) {
      return token.replace(/[^a-z0-9]+/gi, "").toUpperCase();
    }

    const fallback = String(link?.label || "")
      .trim()
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .replace(/^www\./i, "")
      .replace(/[^a-z0-9 ._-]+/gi, "");

    return fallback ? fallback.toUpperCase() : "MIRROR";
  }

  function compareMirrorLinks(left, right) {
    const leftInfo = describeMirrorLink(left);
    const rightInfo = describeMirrorLink(right);
    const tierDelta = TIER_ORDER[leftInfo.tier] - TIER_ORDER[rightInfo.tier];
    if (tierDelta !== 0) {
      return tierDelta;
    }

    const rankDelta = leftInfo.rank - rightInfo.rank;
    if (rankDelta !== 0) {
      return rankDelta;
    }

    return (Number(left?.order) || 0) - (Number(right?.order) || 0);
  }

  function sortMirrorLinks(links) {
    return (Array.isArray(links) ? links : [])
      .map((link, index) => ({ link, index }))
      .sort((left, right) => {
        const delta = compareMirrorLinks(left.link, right.link);
        return delta !== 0 ? delta : left.index - right.index;
      })
      .map((entry) => entry.link);
  }

  function isCompressedVariant(variant) {
    return (
      /(^|-)compressed-/i.test(String(variant?.id || "")) ||
      /\bcompressed\b/i.test(
        `${variant?.label || ""} ${variant?.releaseLabel || ""}`,
      )
    );
  }

  function getVariantPlatformId(variant) {
    const variantId = String(variant?.id || "").toLowerCase();
    for (const platformId of PLATFORM_IDS) {
      if (variantId === platformId || variantId.endsWith(`-${platformId}`)) {
        return platformId;
      }
    }

    return "general";
  }

  function getVariantPlatformScore(variant, platform) {
    const scores = PLATFORM_SCORES[platform] || PLATFORM_SCORES.win32;
    return scores[getVariantPlatformId(variant)] ?? 0;
  }

  function getReleaseKey(variant) {
    return String(variant?.releaseLabel || "")
      .replace(/\bcompressed\b/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function getBestTierScore(links) {
    let best = -1;
    for (const link of links) {
      const tier = describeMirrorLink(link).tier;
      best = Math.max(best, 2 - TIER_ORDER[tier]);
    }
    return best;
  }

  function normalizeVariants(variants, links) {
    const source =
      Array.isArray(variants) && variants.length > 0
        ? variants
        : [{ id: "general", label: "Downloads", links }];

    return source
      .map((variant, index) => ({
        ...variant,
        firstOrder: Number(variant?.firstOrder ?? index),
        links: Array.isArray(variant?.links) ? variant.links : [],
      }))
      .filter((variant) => variant.links.length > 0);
  }

  function findVariantForLink(variants, linkUrl) {
    return (
      variants.find((variant) =>
        variant.links.some((link) => String(link.url) === String(linkUrl)),
      ) || null
    );
  }

  /**
   * Picks the mirror a user most likely wants: a build for their OS from the
   * first release listed in the thread, on the most automatable host.
   */
  function pickRecommendedMirror(input) {
    const platform = String(input?.platform || "win32");
    const variants = normalizeVariants(input?.variants, input?.links);
    if (variants.length === 0) {
      return null;
    }

    const preferredUrl = String(input?.preferredLinkUrl || "");
    if (preferredUrl) {
      const preferredVariant = findVariantForLink(variants, preferredUrl);
      const preferredLink = preferredVariant?.links.find(
        (link) => String(link.url) === preferredUrl,
      );
      if (
        preferredLink &&
        describeMirrorLink(preferredLink).tier !== MIRROR_TIERS.MANUAL
      ) {
        return {
          link: preferredLink,
          variant: preferredVariant,
          reason: "remembered",
        };
      }
    }

    const bestPlatformScore = Math.max(
      ...variants.map((variant) => getVariantPlatformScore(variant, platform)),
    );
    const platformVariants = variants.filter(
      (variant) =>
        getVariantPlatformScore(variant, platform) === bestPlatformScore,
    );
    const firstRelease = [...platformVariants].sort(
      (left, right) => left.firstOrder - right.firstOrder,
    )[0];
    const releaseKey = getReleaseKey(firstRelease);
    const candidates = platformVariants
      .filter((variant) => getReleaseKey(variant) === releaseKey)
      .sort((left, right) => {
        const tierDelta =
          getBestTierScore(right.links) - getBestTierScore(left.links);
        if (tierDelta !== 0) {
          return tierDelta;
        }

        const compressedDelta =
          Number(isCompressedVariant(left)) -
          Number(isCompressedVariant(right));
        if (compressedDelta !== 0) {
          return compressedDelta;
        }

        return left.firstOrder - right.firstOrder;
      });

    const variant = candidates[0];
    const link = sortMirrorLinks(variant.links)[0];
    const tier = describeMirrorLink(link).tier;

    return {
      link,
      variant,
      reason: tier === MIRROR_TIERS.MANUAL ? "browser-only" : "best-host",
    };
  }

  /**
   * Other mirrors of the same build that can be tried automatically when the
   * chosen one fails, best host first.
   */
  function buildMirrorFallbackChain(input) {
    const primaryUrl = String(input?.link?.url || "");
    const limit = Number.isInteger(input?.limit) ? input.limit : 3;
    const variants = normalizeVariants(input?.variants, input?.links);
    const variant = findVariantForLink(variants, primaryUrl);
    if (!variant) {
      return [];
    }

    return sortMirrorLinks(variant.links)
      .filter(
        (link) =>
          String(link.url) !== primaryUrl &&
          describeMirrorLink(link).tier !== MIRROR_TIERS.MANUAL,
      )
      .slice(0, Math.max(0, limit));
  }

  const api = {
    MIRROR_TIERS,
    HOST_PROFILES,
    buildMirrorFallbackChain,
    compareMirrorLinks,
    describeMirrorLink,
    findVariantForLink,
    getMirrorDisplayName,
    getMirrorHostProfile,
    getMirrorTierInfo,
    getVariantPlatformId,
    getVariantPlatformScore,
    isCompressedVariant,
    pickRecommendedMirror,
    sortMirrorLinks,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.f95MirrorAutomation = api;
  }
})(globalThis);
