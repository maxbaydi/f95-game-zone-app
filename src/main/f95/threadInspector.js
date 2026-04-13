const { normalizeThreadDownloadLinks } = require("./threadLinks");

const THREAD_INSPECTION_TIMEOUT_MS = 30000;

const EXTRACT_THREAD_DOWNLOADS_SCRIPT = String.raw`(() => {
  const cleanText = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();

  const ignoredTitlePrefixes = [
    "vn",
    "ren'py",
    "renpy",
    "unity",
    "html",
    "flash",
    "rpgm",
    "rpgm mv",
    "rpgm mz",
    "rpg maker",
    "win",
    "windows",
    "linux",
    "mac",
    "android",
    "ios",
    "cheat mod",
    "mod",
    "tool",
    "collection",
    "completed",
    "onhold",
    "abandoned",
    "ongoing",
    "visual novel",
    "wolf rpg",
  ];
  const ignoredBracketTokens = new Set(ignoredTitlePrefixes);
  const engineLabelMap = {
    "ren'py": "Ren'Py",
    renpy: "Ren'Py",
    unity: "Unity",
    html: "HTML",
    flash: "Flash",
    rpgm: "RPGM",
    "rpgm mv": "RPGM",
    "rpgm mz": "RPGM",
    "rpg maker": "RPGM",
    "rpg maker mv": "RPGM",
    "rpg maker mz": "RPGM",
    "wolf rpg": "Wolf RPG",
    "unreal engine": "Unreal Engine",
    unreal: "Unreal Engine",
    godot: "Godot",
    java: "Java",
    webgl: "WebGL",
    adrift: "ADRIFT",
    qsp: "QSP",
    rags: "RAGS",
    tads: "Tads",
  };
  const platformMatchPattern =
    /\b(win(?:dows)?\s*\/\s*linux|linux\s*\/\s*win(?:dows)?|windows?\s*&\s*linux|win(?:dows)?|pc|linux|mac(?:os)?|osx|android|ios)\b(?:\s*\([^)]*\))?\s*:/gi;
  const releaseHintPattern =
    /\b(season\s*\d+(?:\s*&\s*\d+)?|s\d+|episode\s*\d+(?:\.\d+)?|ep(?:isode)?\s*\d+(?:\.\d+)?|chapter\s*\d+|part\s*\d+|artbook(?:\s*\([^)]*\))?)\b/gi;

  const normalizeEngineLabel = (value) => {
    const token = cleanText(value)
      .toLowerCase()
      .replace(/^pre[-_\s]+/i, "")
      .replace(/[_-]+/g, " ");

    return engineLabelMap[token] || "";
  };

  const normalizePlatformLabel = (rawValue) => {
    const token = cleanText(rawValue).toLowerCase();
    if (!token) {
      return "";
    }

    if (
      /^(?:win(?:dows)?\s*\/\s*linux|linux\s*\/\s*win(?:dows)?|windows?\s*&\s*linux)\b/i.test(
        token,
      )
    ) {
      return "Windows / Linux";
    }
    if (/^(?:win(?:dows)?|pc)\b/i.test(token)) {
      return "Windows";
    }
    if (/^linux\b/i.test(token)) {
      return "Linux";
    }
    if (/^(?:mac|macos|osx)\b/i.test(token)) {
      return "Mac";
    }
    if (/^android\b/i.test(token)) {
      return "Android";
    }
    if (/^ios\b/i.test(token)) {
      return "iOS";
    }
    return "";
  };

  const findNearestPlatformLabel = (beforeText) => {
    const normalizedBefore = String(beforeText || "");
    if (!normalizedBefore) {
      return "";
    }

    let matchedLabel = "";
    let match = platformMatchPattern.exec(normalizedBefore);
    while (match) {
      matchedLabel = normalizePlatformLabel(match[1] || "");
      match = platformMatchPattern.exec(normalizedBefore);
    }
    platformMatchPattern.lastIndex = 0;
    return matchedLabel;
  };

  const normalizeReleaseHint = (rawValue) =>
    cleanText(rawValue).replace(/\s+/g, " ");

  const findNearestReleaseHeading = (lines) => {
    const normalizedLines = Array.isArray(lines) ? lines : [];
    for (let index = normalizedLines.length - 1; index >= 0; index -= 1) {
      const candidate = normalizeReleaseHint(normalizedLines[index]);
      if (!candidate) {
        continue;
      }

      if (/^(season\s*\d+(?:\s*&\s*\d+)?|s\d+|episode\s*\d+(?:\.\d+)?|ep(?:isode)?\s*\d+(?:\.\d+)?|chapter\s*\d+|part\s*\d+)$/.test(candidate.toLowerCase())) {
        return candidate;
      }
    }

    return "";
  };

  const findNearestReleaseHint = (inputText) => {
    const normalizedInput = String(inputText || "");
    if (!normalizedInput) {
      return "";
    }

    let matchedReleaseHint = "";
    let match = releaseHintPattern.exec(normalizedInput);
    while (match) {
      matchedReleaseHint = normalizeReleaseHint(match[1] || "");
      match = releaseHintPattern.exec(normalizedInput);
    }
    releaseHintPattern.lastIndex = 0;
    return matchedReleaseHint;
  };

  const extractLeadingLabel = (lineText) => {
    const normalizedLine = cleanText(lineText);
    if (!normalizedLine) {
      return "";
    }
    const separatorIndex = normalizedLine.indexOf(":");
    if (separatorIndex <= 0) {
      return "";
    }
    return cleanText(normalizedLine.slice(0, separatorIndex));
  };

  const peelLeadingNoisePrefixes = (value) => {
    let result = cleanText(value);
    const sortedPrefixes = [...ignoredTitlePrefixes].sort(
      (left, right) => right.length - left.length,
    );
    const removedPrefixes = [];

    let changed = true;
    while (changed && result) {
      changed = false;

      for (const prefix of sortedPrefixes) {
        const escapedPrefix = prefix.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
        const prefixPattern = new RegExp(
          "^" + escapedPrefix + "(?=\\s|$)",
          "i",
        );

        if (!prefixPattern.test(result)) {
          continue;
        }

        removedPrefixes.push(prefix.toLowerCase());
        result = cleanText(
          result
            .replace(prefixPattern, " ")
            .replace(/^[|:;,.!/?<>\-–—~]+/, " "),
        );
        changed = true;
      }
    }

    return {
      cleaned: result,
      removedPrefixes,
    };
  };

  const stripLeadingNoisePrefixes = (value) => {
    return peelLeadingNoisePrefixes(value).cleaned;
  };

  const extractRawTitle = (node) => {
    if (!node) {
      return "";
    }

    try {
      const clone = node.cloneNode(true);
      clone
        .querySelectorAll(".labelLink, .label, .label-append")
        .forEach((labelNode) => labelNode.remove());
      return cleanText(clone.innerText || clone.textContent || "");
    } catch {
      return "";
    }
  };

  const extractTitleEngineFromLabels = (node) => {
    if (!node) {
      return "";
    }

    const candidates = [];
    node.querySelectorAll("[class]").forEach((element) => {
      element.classList.forEach((className) => {
        if (/^pre[-_]/i.test(className)) {
          candidates.push(className.replace(/^pre[-_]/i, ""));
        }
      });
    });
    node
      .querySelectorAll(".label, .labelLink, .label > span, .labelLink > span")
      .forEach((element) => {
        candidates.push(cleanText(element.innerText || element.textContent || ""));
      });

    for (const candidate of candidates) {
      const normalized = normalizeEngineLabel(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return "";
  };

  const parseThreadTitle = (rawTitle, fallbackEngine = "") => {
    const normalizedRawTitle = cleanText(rawTitle);
    const bracketTokens = Array.from(
      normalizedRawTitle.matchAll(/\[([^\]]+)\]/g),
    ).map((match) => cleanText(match[1]));
    const version =
      bracketTokens.find(
        (token) =>
          /^v?\d/i.test(token) ||
          /\d+\.\d+/.test(token) ||
          /(ep|episode|chapter|season)\s*\d+/i.test(token),
      ) || "";
    const creator =
      [...bracketTokens]
        .reverse()
        .find(
          (token) =>
            !ignoredBracketTokens.has(token.toLowerCase()) &&
            !(
              /^v?\d/i.test(token) ||
              /\d+\.\d+/.test(token) ||
              /(ep|episode|chapter|season)\s*\d+/i.test(token)
            ),
        ) || "";
    const titleWithoutBrackets = cleanText(
      normalizedRawTitle
        .replace(/\|\s*f95zone.*$/i, " ")
        .replace(/\[[^\]]+\]/g, " ")
        .replace(/\s+[|]\s+/g, " ")
        .replace(/\s+[-–—]\s+/g, " "),
    );
    const { cleaned: strippedTitle, removedPrefixes } =
      peelLeadingNoisePrefixes(titleWithoutBrackets);
    const title = strippedTitle || titleWithoutBrackets;
    const engineFromPrefixes = removedPrefixes
      .map((prefix) => normalizeEngineLabel(prefix))
      .find(Boolean);
    const engineFromBrackets = bracketTokens
      .map((token) => normalizeEngineLabel(token))
      .find(Boolean);

    return {
      rawTitle: normalizedRawTitle,
      title: title || normalizedRawTitle,
      creator,
      version,
      engine: fallbackEngine || engineFromPrefixes || engineFromBrackets || "",
    };
  };

  const titleNode =
    document.querySelector("h1.p-title-value") || document.querySelector("h1");
  const firstPostRoot =
    document.querySelector("article.message-threadStarterPost .bbWrapper") ||
    document.querySelector("article.message--post .bbWrapper") ||
    document.querySelector(".message-threadStarterPost .bbWrapper") ||
    document.querySelector(".message-body .bbWrapper");

  if (!firstPostRoot) {
    return {
      success: false,
      error: "Could not find the starter post on this page.",
      threadUrl: location.href,
      links: [],
    };
  }

  const rawTitle =
    extractRawTitle(titleNode) ||
    cleanText(titleNode?.innerText || titleNode?.textContent || document.title);
  const titleEngine = extractTitleEngineFromLabels(titleNode);
  const parsedTitle = parseThreadTitle(rawTitle, titleEngine);

  const links = [];
  const BLOCK_TAGS = new Set([
    "DIV",
    "P",
    "LI",
    "UL",
    "OL",
    "TABLE",
    "TBODY",
    "TR",
    "TD",
    "TH",
    "BLOCKQUOTE",
    "SECTION",
    "ARTICLE",
    "HR",
  ]);

  const createLineState = () => ({
    textParts: [],
    anchors: [],
  });

  const appendTextPart = (lineState, value) => {
    const normalized = cleanText(value);
    if (!normalized) {
      return;
    }
    lineState.textParts.push(normalized);
  };

  const isDownloadCandidateUrl = (resolvedUrl) => {
    const isF95Host = /(^|\.)f95zone\.to$/i.test(resolvedUrl.hostname);
    return (
      resolvedUrl.pathname.includes("/masked/") ||
      resolvedUrl.pathname.includes("/attachments/") ||
      !isF95Host
    );
  };

  const pushAnchorLinksFromLine = (lineText, anchors, state) => {
    for (const anchor of anchors) {
      const href = cleanText(anchor.getAttribute("href") || anchor.href);
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
        continue;
      }

      const resolvedUrl = new URL(href, location.origin);
      if (!isDownloadCandidateUrl(resolvedUrl)) {
        continue;
      }

      links.push({
        url: resolvedUrl.href,
        label:
          cleanText(anchor.innerText || anchor.textContent) || resolvedUrl.hostname,
        host: resolvedUrl.hostname,
        lineText,
        contextText: lineText,
        platformHint: state.platformHint || "",
        releaseHint: state.releaseHint || "",
        sectionHint: state.sectionHint || "",
        isLightboxImage:
          anchor.classList.contains("js-lbImage") ||
          anchor.hasAttribute("data-sub-html") ||
          Boolean(anchor.querySelector("img.bbImage")),
        order: links.length,
      });
    }
  };

  const flushLine = (lineState, state) => {
    const lineText = cleanText(lineState.textParts.join(" "));
    if (!lineText && lineState.anchors.length === 0) {
      return;
    }

    const leadingLabel = extractLeadingLabel(lineText);
    const explicitPlatformLabel = normalizePlatformLabel(leadingLabel);
    const explicitReleaseHint = explicitPlatformLabel
      ? ""
      : findNearestReleaseHint(leadingLabel);

    if (lineState.anchors.length === 0) {
      const releaseHeading = findNearestReleaseHeading([lineText]);
      if (releaseHeading) {
        state.currentRelease = releaseHeading;
      }
      if (/\bcompressed\b/i.test(lineText)) {
        state.currentSection = "Compressed";
      }
      lineState.textParts = [];
      lineState.anchors = [];
      return;
    }

    const lineReleaseHint = explicitReleaseHint || state.currentRelease || "";
    const lineSectionHint =
      /\bcompressed\b/i.test(lineText) ? "Compressed" : state.currentSection || "";

    pushAnchorLinksFromLine(lineText, lineState.anchors, {
      platformHint: explicitPlatformLabel,
      releaseHint: lineReleaseHint,
      sectionHint: lineSectionHint,
    });

    lineState.textParts = [];
    lineState.anchors = [];
  };

  const walkNodes = (nodes, state, lineState) => {
    for (const node of Array.from(nodes)) {
      if (!node) {
        continue;
      }

      if (node.nodeType === Node.TEXT_NODE) {
        appendTextPart(lineState, node.textContent || "");
        continue;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const tagName = String(node.tagName || "").toUpperCase();
      if (tagName === "BR") {
        flushLine(lineState, state);
        continue;
      }

      if (tagName === "A" && node.hasAttribute("href")) {
        lineState.anchors.push(node);
        appendTextPart(lineState, node.innerText || node.textContent || "");
        continue;
      }

      if (BLOCK_TAGS.has(tagName) && node !== firstPostRoot) {
        flushLine(lineState, state);
        const childState = {
          currentRelease: state.currentRelease,
          currentSection: state.currentSection,
        };
        const childLineState = createLineState();
        walkNodes(node.childNodes, childState, childLineState);
        flushLine(childLineState, childState);
        continue;
      }

      walkNodes(node.childNodes, state, lineState);
    }
  };

  const rootState = {
    currentRelease: "",
    currentSection: "",
  };
  const rootLineState = createLineState();
  walkNodes(firstPostRoot.childNodes, rootState, rootLineState);
  flushLine(rootLineState, rootState);
  if (links.length === 0) {
    return {
      success: false,
      error: "No download links were found in the starter post.",
      threadUrl: location.href,
      title: parsedTitle.title || rawTitle || "F95 thread",
      creator: parsedTitle.creator,
      version: parsedTitle.version,
      engine: parsedTitle.engine || "",
      links: [],
    };
  }

  return {
    success: true,
    threadUrl: location.href,
    rawTitle: parsedTitle.rawTitle || rawTitle,
    title: parsedTitle.title || rawTitle || "F95 thread",
    creator: parsedTitle.creator,
    version: parsedTitle.version,
    engine: parsedTitle.engine || "",
    links,
  };
})();`;

function inspectF95Thread({ BrowserWindow, threadUrl }) {
  return new Promise((resolve, reject) => {
    const hiddenWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: "persist:f95-auth",
      },
    });

    let finished = false;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out while loading the F95 thread."));
    }, THREAD_INSPECTION_TIMEOUT_MS);

    const cleanup = () => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      hiddenWindow.webContents.removeAllListeners("did-finish-load");
      hiddenWindow.webContents.removeAllListeners("did-fail-load");
      hiddenWindow.webContents.removeAllListeners("render-process-gone");
      if (!hiddenWindow.isDestroyed()) {
        hiddenWindow.close();
      }
    };

    hiddenWindow.webContents.once("did-fail-load", (event, errorCode, errorDescription) => {
      cleanup();
      reject(
        new Error(
          `Failed to load the F95 thread: ${errorDescription || errorCode}`,
        ),
      );
    });

    hiddenWindow.webContents.once("render-process-gone", () => {
      cleanup();
      reject(new Error("The hidden F95 inspection page crashed."));
    });

    hiddenWindow.webContents.once("did-finish-load", async () => {
      try {
        const rawPayload = await hiddenWindow.webContents.executeJavaScript(
          EXTRACT_THREAD_DOWNLOADS_SCRIPT,
        );
        const normalizedDownloads = normalizeThreadDownloadLinks(rawPayload?.links || []);
        const payload = rawPayload?.success
          ? {
              ...rawPayload,
              links: normalizedDownloads.links,
              variants: normalizedDownloads.variants,
            }
          : rawPayload;
        cleanup();
        resolve(payload);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    hiddenWindow.loadURL(threadUrl).catch((error) => {
      cleanup();
      reject(error);
    });
  });
}

module.exports = {
  inspectF95Thread,
};
