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
  /(^|\.)mega\.nz$/i,
  /(^|\.)gofile\.io$/i,
  /(^|\.)pixeldrain\.com$/i,
  /(^|\.)mixdrop\./i,
  /(^|\.)workupload\.com$/i,
  /(^|\.)vikingfile\.com$/i,
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

const DOWNLOAD_CONTEXT_PATTERNS = [
  /\bdownload\b/i,
  /\bwin(?:dows)?\b/i,
  /\blinux\b/i,
  /\bmac\b/i,
  /\bandroid\b/i,
  /\bios\b/i,
  /\bpc\b/i,
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

function isSocialHost(hostname) {
  return SOCIAL_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

function isKnownFileHost(hostname) {
  return FILE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

function hasDownloadContext(lineText, contextText) {
  const combinedText = `${cleanText(lineText)} ${cleanText(contextText)}`;
  return DOWNLOAD_CONTEXT_PATTERNS.some((pattern) => pattern.test(combinedText));
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

function shouldIgnoreByText({ label, lineText, contextText }) {
  const combinedText = `${cleanText(label)} ${cleanText(lineText)} ${cleanText(contextText)}`;
  return IGNORED_TEXT_PATTERNS.some((pattern) => pattern.test(combinedText));
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
  const hasContext = hasDownloadContext(lineText, contextText);
  const isExternalDownloadHost = !isF95Host && isKnownFileHost(hostname);
  const lineLabel = extractLineLabel(lineText, label);
  const variant = detectVariant(lineLabel, lineText, contextText);

  if (isSocialHost(hostname) || shouldIgnoreByText({ label, lineText, contextText })) {
    return null;
  }

  if (
    isF95Host &&
    parsedUrl.pathname.includes("/attachments/") &&
    !hasContext &&
    !looksLikeDownloadableAttachment(parsedUrl)
  ) {
    return null;
  }

  if (!isF95Download && !isExternalDownloadHost && !hasContext) {
    return null;
  }

  if (!isF95Download && !isF95Host && !hasContext && !isKnownFileHost(hostname)) {
    return null;
  }

  return {
    url: parsedUrl.href,
    label,
    host: hostname,
    lineLabel: lineLabel || variant.label,
    variantId: variant.id,
    variantLabel: lineLabel || variant.label,
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
    const variantKey = `${link.variantId}:${link.variantLabel}`;
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
      links: [...variant.links].sort((left, right) => left.order - right.order),
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
