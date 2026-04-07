const SOCIAL_HOST_PATTERNS = [
  /(^|\.)twitter\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)discord\.com$/i,
  /(^|\.)discordapp\.com$/i,
  /(^|\.)patreon\.com$/i,
  /(^|\.)steamcommunity\.com$/i,
  /(^|\.)steampowered\.com$/i,
  /(^|\.)reddit\.com$/i,
];

const FILE_HOST_PATTERNS = [
  /(^|\.)buzzheavier\.com$/i,
  /(^|\.)datanodes\.to$/i,
  /(^|\.)mega\.nz$/i,
  /(^|\.)gofile\.io$/i,
  /(^|\.)pixeldrain\.com$/i,
  /(^|\.)mixdrop\./i,
  /(^|\.)workupload\.com$/i,
  /(^|\.)vikingfile\.com$/i,
  /(^|\.)anonfile\.de$/i,
  /(^|\.)anonfiles\.se$/i,
  /(^|\.)drive\.usercontent\.google\.com$/i,
  /(^|\.)mediafire\.com$/i,
  /(^|\.)dropbox\.com$/i,
  /(^|\.)drive\.google\.com$/i,
  /(^|\.)1drv\.ms$/i,
  /(^|\.)onedrive\.live\.com$/i,
  /(^|\.)qiwi\.gg$/i,
  /(^|\.)catbox\.moe$/i,
  /(^|\.)uploadhaven\.com$/i,
  /(^|\.)krakenfiles\.com$/i,
  /(^|\.)nopy\.to$/i,
  /(^|\.)sendspace\.com$/i,
  /(^|\.)anonfiles\.com$/i,
  /(^|\.)filecrypt\.cc$/i,
];

const FILE_HOST_HINT_PATTERNS = [
  { pattern: /\bbuzzheavier\b/i, host: "buzzheavier.com" },
  { pattern: /\bdatanodes?\b/i, host: "datanodes.to" },
  { pattern: /\bmega\b/i, host: "mega.nz" },
  { pattern: /\bgofile\b/i, host: "gofile.io" },
  { pattern: /\bpixeldrain\b/i, host: "pixeldrain.com" },
  { pattern: /\bmixdrop\b/i, host: "mixdrop.co" },
  { pattern: /\bworkupload\b/i, host: "workupload.com" },
  { pattern: /\bvikingfile\b/i, host: "vikingfile.com" },
  { pattern: /\bmediafire\b/i, host: "mediafire.com" },
  { pattern: /\bdropbox\b/i, host: "dropbox.com" },
  { pattern: /\b(?:google\s*drive|gdrive)\b/i, host: "drive.google.com" },
  { pattern: /\bonedrive\b/i, host: "onedrive.live.com" },
  { pattern: /\buploadhaven\b/i, host: "uploadhaven.com" },
  { pattern: /\bkrakenfiles\b/i, host: "krakenfiles.com" },
  { pattern: /\bcatbox\b/i, host: "catbox.moe" },
  { pattern: /\bsendspace\b/i, host: "sendspace.com" },
  { pattern: /\bfilecrypt\b/i, host: "filecrypt.cc" },
];

const NON_DOWNLOAD_SECTION_PATTERNS = [
  /^\s*developer\b/i,
  /^\s*dev\b/i,
  /^\s*store\b/i,
  /^\s*shop\b/i,
  /^\s*extras?\b/i,
  /^\s*official(?:\s+site)?\b/i,
  /^\s*website\b/i,
  /^\s*patreon\b/i,
  /^\s*itch(?:\.io)?\b/i,
  /^\s*steam\b/i,
  /^\s*trailer\b/i,
  /^\s*walkthrough\b/i,
  /^\s*changelog\b/i,
];

const IGNORED_TEXT_PATTERNS = [
  /\btwitter\b/i,
  /\bx\.com\b/i,
  /\bfacebook\b/i,
  /\binstagram\b/i,
  /\byoutube\b/i,
  /\bdiscord\b/i,
  /\bpatreon\b/i,
  /\bsteam\b/i,
  /\btrailer\b/i,
  /\bofficial site\b/i,
  /\bhomepage\b/i,
];

const PLATFORM_PATTERNS = [
  {
    id: "windows-linux",
    label: "Windows / Linux",
    pattern:
      /\b(win(?:dows)?\s*\/\s*linux|linux\s*\/\s*win(?:dows)?|pc\s*\/\s*linux|windows?\s*&\s*linux)\b/i,
  },
  {
    id: "windows",
    label: "Windows",
    pattern: /\b(win(?:dows)?|pc)\b/i,
  },
  {
    id: "linux",
    label: "Linux",
    pattern: /\blinux\b/i,
  },
  {
    id: "mac",
    label: "Mac",
    pattern: /\b(mac|osx|macos)\b/i,
  },
  {
    id: "android",
    label: "Android",
    pattern: /\bandroid\b/i,
  },
  {
    id: "ios",
    label: "iOS",
    pattern: /\bios\b/i,
  },
];

const PLATFORM_PRIORITY = [
  "windows-linux",
  "windows",
  "linux",
  "mac",
  "android",
  "ios",
  "compressed-windows-linux",
  "compressed-windows",
  "compressed-linux",
  "compressed-mac",
  "compressed-android",
  "compressed-ios",
  "general",
];

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeF95DownloadPath(parsedUrl) {
  return (
    parsedUrl.pathname.includes("/masked/") ||
    parsedUrl.pathname.includes("/attachments/")
  );
}

function looksLikeDownloadableAttachment(parsedUrl) {
  return /\.(zip|7z|rar|apk|exe|tar|gz|bz2|xz)$/i.test(parsedUrl.pathname);
}

function looksLikePreviewAttachment(parsedUrl) {
  return /(?:\.|[-_])(avif|bmp|gif|jpe?g|png|webp|mp4|webm)(?:$|[./_-])/i.test(
    parsedUrl.pathname,
  );
}

function isSocialHost(hostname) {
  return SOCIAL_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

function isKnownFileHost(hostname) {
  return FILE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

function extractFileHostHint(value) {
  const normalized = cleanText(value);
  if (!normalized) {
    return "";
  }

  const matchedHint = FILE_HOST_HINT_PATTERNS.find((entry) =>
    entry.pattern.test(normalized),
  );
  return matchedHint?.host || "";
}

function isNonDownloadSectionLabel(lineLabel) {
  const normalized = cleanText(lineLabel);
  if (!normalized) {
    return false;
  }

  return NON_DOWNLOAD_SECTION_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

function extractLineLabel(lineText, anchorLabel) {
  const normalizedLine = cleanText(lineText);
  const normalizedAnchor = cleanText(anchorLabel);
  if (!normalizedLine) {
    return "";
  }

  const colonIndex = normalizedLine.indexOf(":");
  if (colonIndex > 0) {
    return cleanText(normalizedLine.slice(0, colonIndex));
  }

  if (normalizedAnchor) {
    const anchorIndex = normalizedLine
      .toLowerCase()
      .indexOf(normalizedAnchor.toLowerCase());
    if (anchorIndex > 0) {
      return cleanText(
        normalizedLine
          .slice(0, anchorIndex)
          .replace(/[-–—|/]+$/g, "")
          .replace(/:+$/g, ""),
      );
    }
  }

  return "";
}

function detectVariant(lineLabel, lineText, contextText) {
  const searchText = `${cleanText(lineLabel)} ${cleanText(lineText)} ${cleanText(contextText)}`;
  for (const variant of PLATFORM_PATTERNS) {
    if (variant.pattern.test(searchText)) {
      return variant;
    }
  }

  return {
    id: "general",
    label: lineLabel || "General",
  };
}

function detectVariantFromHint(platformHint) {
  const hint = cleanText(platformHint);
  if (!hint) {
    return null;
  }

  for (const variant of PLATFORM_PATTERNS) {
    if (variant.pattern.test(hint)) {
      return variant;
    }
  }

  return null;
}

function sanitizeVariantLabel(value) {
  return cleanText(value)
    .replace(/^[\s:|/\\+.,;!?#*`~<>\-–—_=]+/g, "")
    .replace(/[\s:|/\\+.,;!?#*`~<>\-–—_=]+$/g, "");
}

function resolveVariantLabel(lineLabel, variant) {
  if (variant.id !== "general") {
    return variant.label;
  }

  const normalizedLabel = sanitizeVariantLabel(lineLabel);
  if (!normalizedLabel) {
    return "General";
  }

  if (isNonDownloadSectionLabel(normalizedLabel)) {
    return "";
  }

  if (extractFileHostHint(normalizedLabel)) {
    return "";
  }

  return normalizedLabel;
}

function shouldIgnoreByText({ label, lineText, contextText }) {
  const combinedText = `${cleanText(label)} ${cleanText(lineText)} ${cleanText(contextText)}`;
  return IGNORED_TEXT_PATTERNS.some((pattern) => pattern.test(combinedText));
}

function dedupeLinksByHost(inputLinks) {
  const links = [];
  const seenHosts = new Set();
  for (const link of inputLinks) {
    const hostKey = cleanText(link?.host || "").toLowerCase();
    const dedupeKey = hostKey || cleanText(link?.label || "").toLowerCase();
    if (dedupeKey && seenHosts.has(dedupeKey)) {
      continue;
    }
    if (dedupeKey) {
      seenHosts.add(dedupeKey);
    }
    links.push(link);
  }
  return links;
}

function classifyThreadDownloadLink(rawLink) {
  const url = cleanText(rawLink?.url);
  if (!url) {
    return null;
  }

  let parsedUrl = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsedUrl.hostname;
  const label = cleanText(rawLink?.label || hostname);
  const lineText = cleanText(rawLink?.lineText || "");
  const contextText = cleanText(rawLink?.contextText || "");
  const isF95Host = /(^|\.)f95zone\.to$/i.test(hostname);
  const isF95Download = isF95Host && looksLikeF95DownloadPath(parsedUrl);
  const isPreviewAttachment = isF95Host && looksLikePreviewAttachment(parsedUrl);
  const lineLabel = extractLineLabel(lineText, label);
  const lineHostHint = extractFileHostHint(lineLabel);
  const labelHostHint = extractFileHostHint(label);
  const inferredHostHint = labelHostHint || lineHostHint;
  const normalizedHost = isF95Host && inferredHostHint ? inferredHostHint : hostname;
  const variant =
    detectVariantFromHint(rawLink?.platformHint) ||
    detectVariant(lineLabel, lineText, contextText);
  const sectionHint = cleanText(rawLink?.sectionHint || "");
  const isCompressedSection = /\bcompressed\b/i.test(sectionHint);
  const baseVariantLabel = resolveVariantLabel(lineLabel, variant);
  const variantId =
    isCompressedSection && variant.id !== "general"
      ? `compressed-${variant.id}`
      : variant.id;
  const variantLabel =
    isCompressedSection && baseVariantLabel
      ? `Compressed ${baseVariantLabel}`
      : baseVariantLabel;
  const isDownloadableF95Attachment =
    isF95Host &&
    parsedUrl.pathname.includes("/attachments/") &&
    looksLikeDownloadableAttachment(parsedUrl);
  const isAllowedF95Mirror = isF95Download || isDownloadableF95Attachment;
  const isExternalDownloadHost = !isF95Host && isKnownFileHost(normalizedHost);

  if (rawLink?.isLightboxImage || isPreviewAttachment) {
    return null;
  }

  if (isSocialHost(hostname) || shouldIgnoreByText({ label, lineText, contextText })) {
    return null;
  }

  if (isNonDownloadSectionLabel(lineLabel)) {
    return null;
  }

  if (isF95Host && !isAllowedF95Mirror) {
    return null;
  }

  if (isAllowedF95Mirror && !inferredHostHint) {
    return null;
  }

  if (!isAllowedF95Mirror && !isExternalDownloadHost) {
    return null;
  }

  if (!variantLabel) {
    return null;
  }

  return {
    url: parsedUrl.href,
    label,
    host: normalizedHost,
    lineLabel: variantLabel,
    variantId,
    variantLabel: variantLabel,
    order: Number(rawLink?.order) || 0,
  };
}

function normalizeThreadDownloadLinks(rawLinks) {
  const seen = new Set();
  const links = [];

  for (const rawLink of Array.isArray(rawLinks) ? rawLinks : []) {
    const normalized = classifyThreadDownloadLink(rawLink);
    if (!normalized || seen.has(normalized.url)) {
      continue;
    }

    seen.add(normalized.url);
    links.push(normalized);
  }

  const variantMap = new Map();
  for (const link of links) {
    const variantKey =
      link.variantId === "general"
        ? `${link.variantId}:${link.variantLabel}`
        : link.variantId;
    if (!variantMap.has(variantKey)) {
      variantMap.set(variantKey, {
        id: link.variantId,
        label: link.variantLabel,
        links: [],
      });
    }

    variantMap.get(variantKey).links.push(link);
  }

  const variants = [...variantMap.values()]
    .map((variant) => ({
      ...variant,
      links: dedupeLinksByHost(
        [...variant.links].sort((left, right) => left.order - right.order),
      ),
    }))
    .sort((left, right) => {
      const leftIndex = PLATFORM_PRIORITY.indexOf(left.id);
      const rightIndex = PLATFORM_PRIORITY.indexOf(right.id);
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      return left.label.localeCompare(right.label);
    });

  return {
    links: [...links].sort((left, right) => left.order - right.order),
    variants,
  };
}

module.exports = {
  classifyThreadDownloadLink,
  cleanText,
  extractLineLabel,
  normalizeThreadDownloadLinks,
};
