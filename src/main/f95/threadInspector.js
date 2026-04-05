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

  const stripLeadingNoisePrefixes = (value) => {
    let result = cleanText(value);
    const sortedPrefixes = [...ignoredTitlePrefixes].sort(
      (left, right) => right.length - left.length,
    );

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

        result = cleanText(
          result
            .replace(prefixPattern, " ")
            .replace(/^[|:;,.!/?<>\-–—~]+/, " "),
        );
        changed = true;
      }
    }

    return result;
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

  const parseThreadTitle = (rawTitle) => {
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
    const title =
      stripLeadingNoisePrefixes(titleWithoutBrackets) || titleWithoutBrackets;

    return {
      rawTitle: normalizedRawTitle,
      title: title || normalizedRawTitle,
      creator,
      version,
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
  const parsedTitle = parseThreadTitle(rawTitle);

  const links = [];
  const anchors = Array.from(firstPostRoot.querySelectorAll("a[href]"));

  const getLineContainer = (anchor) =>
    anchor.closest("p, li, td, blockquote") || anchor.parentElement;

  const getLineText = (anchor) => {
    const lineContainer = getLineContainer(anchor);
    if (!lineContainer) {
      return cleanText(anchor.innerText || anchor.textContent || "");
    }

    try {
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(lineContainer);
      beforeRange.setEndBefore(anchor);
      const beforeText =
        cleanText(beforeRange.toString().split(/\n+/).pop() || "") || "";

      const afterRange = document.createRange();
      afterRange.selectNodeContents(lineContainer);
      afterRange.setStartAfter(anchor);
      const afterText =
        cleanText(afterRange.toString().split(/\n+/)[0] || "") || "";

      return cleanText(
        beforeText +
          " " +
          cleanText(anchor.innerText || anchor.textContent || "") +
          " " +
          afterText,
      );
    } catch {
      return cleanText(lineContainer.innerText || lineContainer.textContent || "");
    }
  };

  for (const anchor of anchors) {
    const href = cleanText(anchor.getAttribute("href") || anchor.href);
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
      continue;
    }

    const resolvedUrl = new URL(href, location.origin);
    const isF95Host = /(^|\.)f95zone\.to$/i.test(resolvedUrl.hostname);
    const isDownloadCandidate =
      resolvedUrl.pathname.includes("/masked/") ||
      resolvedUrl.pathname.includes("/attachments/") ||
      !isF95Host;

    if (!isDownloadCandidate) {
      continue;
    }
    links.push({
      url: resolvedUrl.href,
      label:
        cleanText(anchor.innerText || anchor.textContent) || resolvedUrl.hostname,
      host: resolvedUrl.hostname,
      lineText: getLineText(anchor),
      contextText: cleanText(
        getLineContainer(anchor)?.innerText ||
        getLineContainer(anchor)?.textContent ||
          "",
      ),
      isLightboxImage:
        anchor.classList.contains("js-lbImage") ||
        anchor.hasAttribute("data-sub-html") ||
        Boolean(anchor.querySelector("img.bbImage")),
      order: links.length,
    });
  }
  if (links.length === 0) {
    return {
      success: false,
      error: "No download links were found in the starter post.",
      threadUrl: location.href,
      title: parsedTitle.title || rawTitle || "F95 thread",
      creator: parsedTitle.creator,
      version: parsedTitle.version,
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
