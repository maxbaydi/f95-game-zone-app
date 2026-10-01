const { useState, useEffect } = window.React;

const PREVIEW_W = 21;
const PREVIEW_H = 9;
const BANNER_WIDTH = 252;
const BANNER_IMAGE_H = Math.round(
  (BANNER_WIDTH * PREVIEW_H) / PREVIEW_W,
);
const BANNER_FOOTER_H = 100;
const BANNER_HEIGHT = BANNER_IMAGE_H + BANNER_FOOTER_H;

// Card hover/entrance styles live in assets/css/main.css (.banner-root).

const recentGameLaunches = new Map();
const GAME_LAUNCH_DEDUPE_MS = 4000;

// Shared launcher used by cards, the details panel and context menus: it
// ignores accidental double clicks and reports failures as toasts.
const launchLibraryGame = async ({ execPath, recordId, title }) => {
  const normalizedPath = String(execPath || "").trim();
  const toast = window.AppUI?.toast;
  const label = title || "the game";

  if (!normalizedPath) {
    toast?.error("This version has no executable selected.", {
      title: `Can't start ${label}`,
    });
    return { success: false };
  }

  const lastLaunchAt = recentGameLaunches.get(normalizedPath) || 0;
  if (Date.now() - lastLaunchAt < GAME_LAUNCH_DEDUPE_MS) {
    return { success: true, deduped: true };
  }
  recentGameLaunches.set(normalizedPath, Date.now());

  const toastId = toast?.loading(`Starting ${label}…`);
  try {
    const result = await window.electronAPI.launchGame({
      execPath: normalizedPath,
      extension: normalizedPath.split(".").pop().toLowerCase() || "",
      recordId: recordId ?? null,
    });

    if (!result?.success) {
      recentGameLaunches.delete(normalizedPath);
      toast?.update(toastId, {
        type: "error",
        title: `Can't start ${label}`,
        message:
          result?.error ||
          "Could not start this game. Check the installed files and try again.",
      });
      return result || { success: false };
    }

    toast?.update(toastId, {
      type: "success",
      title: `${label} is starting`,
      message: "Have fun!",
      duration: 2500,
    });
    return result;
  } catch (error) {
    recentGameLaunches.delete(normalizedPath);
    toast?.update(toastId, {
      type: "error",
      title: `Can't start ${label}`,
      message: window.AppUI?.errorMessage(error) || String(error),
    });
    return { success: false, error };
  }
};

window.launchLibraryGame = launchLibraryGame;

let bannerTemplateCache = { status: "idle", component: null, promise: null };

const loadBannerTemplate = () => {
  if (bannerTemplateCache.promise) {
    return bannerTemplateCache.promise;
  }

  bannerTemplateCache.status = "loading";
  bannerTemplateCache.promise = (async () => {
    try {
      const selectedTemplate =
        await window.electronAPI.getSelectedBannerTemplate?.();
      if (selectedTemplate && selectedTemplate !== "Default") {
        const templateModule = await import(
          `./data/templates/banner/${selectedTemplate}.js`
        );
        bannerTemplateCache.component = templateModule.default || null;
      }
    } catch (error) {
      console.error("Failed to load banner template:", error);
      window.electronAPI?.log?.(
        `Failed to load banner template: ${error?.message || error}`,
      );
      bannerTemplateCache.component = null;
    }
    bannerTemplateCache.status = "ready";
    return bannerTemplateCache.component;
  })();

  return bannerTemplateCache.promise;
};

const useBannerTemplate = () => {
  const [component, setComponent] = useState(() =>
    bannerTemplateCache.status === "ready" ? bannerTemplateCache.component : null,
  );

  useEffect(() => {
    if (bannerTemplateCache.status === "ready") {
      return undefined;
    }
    let active = true;
    loadBannerTemplate().then((loaded) => {
      if (active && loaded) {
        setComponent(() => loaded);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return component;
};

const getEngineBackgroundColor = (engine) => {
  const engineColors = {
    ADRIFT: "#4F68D9",
    Flash: "#D04220",
    HTML: "#5B8600",
    Java: "#6EA4B1",
    Others: "#72A200",
    QSP: "#BD3631",
    RAGS: "#B67E00",
    RPGM: "#4F68D9",
    "Ren'Py": "#9B00EF",
    Tads: "#4F68D9",
    Unity: "#D35B00",
    "Unreal Engine": "#3730A9",
    WebGL: "#E56200",
    "Wolf RPG": "#4B8926",
  };
  return engineColors[engine] || "#4B8926";
};

const getStatusBackgroundColor = (status) => {
  const statusColors = {
    Completed: "#4F68D9",
    Onhold: "#649DFC",
    Abandoned: "#B67E00",
    "": "transparent",
    null: "transparent",
  };
  return statusColors[status] || "transparent";
};

// Install state of a library record on this PC (see shared/libraryInstallState).
const getCardInstallState = (game) => {
  if (window.libraryInstallState?.getLibraryInstallState) {
    return window.libraryInstallState.getLibraryInstallState(game);
  }
  const versions = Array.isArray(game?.versions) ? game.versions : [];
  if (versions.length === 0) return "not_installed";
  return versions.some((version) => version?.isPresent !== false)
    ? "installed"
    : "missing";
};

// No catalog entry, thread id or thread link (see shared/libraryInstallState).
const needsCardCatalogLink = (game) => {
  if (window.libraryInstallState?.needsCatalogLink) {
    return window.libraryInstallState.needsCatalogLink(game);
  }
  return Boolean(game && !game.atlas_id && !game.f95_id && !game.siteUrl);
};

const getNewestVersion = (versions) => {
  if (!versions || versions.length === 0) return "";
  let maxVersion = versions[0].version;
  let maxValue = 0;
  for (const version of versions) {
    let current;
    try {
      current = parseInt(version.version.replace(/[^0-9]/g, ""), 10);
    } catch {
      current = 0;
    }
    if (current > maxValue) {
      maxValue = current;
      maxVersion = version.version;
    }
  }
  return maxVersion || "";
};

const pickVersionForLaunch = (versions) => {
  if (!versions?.length) return null;
  if (versions.length === 1) return versions[0];
  let best = versions[0];
  let maxValue = 0;
  for (const v of versions) {
    const n = parseInt(String(v.version).replace(/[^0-9]/g, ""), 10) || 0;
    if (n > maxValue) {
      maxValue = n;
      best = v;
    }
  }
  return best;
};

function F95BannerCard({
  game,
  onSelect,
  onUpdateGame,
  onContextMenu,
  onToggleFavorite,
}) {
  const displayTitle = game.displayTitle || game.title || "Unknown";
  const installState = getCardInstallState(game);
  const isInstalled = installState === "installed";
  const isMissing = installState === "missing";
  const presentVersions = (Array.isArray(game.versions) ? game.versions : []).filter(
    (version) => version?.isPresent !== false,
  );
  const newestInstalledVersion =
    game.newestInstalledVersion || getNewestVersion(presentVersions) || "";
  // Text of the version chip: only games that are really on this PC show a
  // version; the others explain why there is no "Play" button.
  const versionChipText = isInstalled
    ? newestInstalledVersion || "Installed"
    : isMissing
      ? "Files missing"
      : "Not installed";
  const playableVersions = presentVersions.filter((version) =>
    Boolean(version?.exec_path),
  );
  const launchable = isInstalled ? pickVersionForLaunch(playableVersions) : null;
  const canPlay = Boolean(launchable?.exec_path);
  // Installed, but no version knows which file starts the game: the card
  // opens the details panel where the launcher can be chosen.
  const needsExecutable = isInstalled && !canPlay && presentVersions.length > 0;
  const canInstall = !canPlay && !needsExecutable && Boolean(game.siteUrl);
  const primaryActionLabel = canPlay
    ? "Play"
    : needsExecutable
      ? "Choose .exe"
      : canInstall
        ? "Install"
        : "Play";
  const isNotMatched = needsCardCatalogLink(game);
  const stateBadge = isMissing
    ? {
        text: "Files missing",
        title: `The install folder was deleted, moved or is on a disconnected drive${game.lastKnownVersion ? ` (last installed: ${game.lastKnownVersion})` : ""}.`,
        className:
          "border-amber-400/80 text-amber-200 bg-black/55 hover:bg-amber-400/20",
      }
    : installState === "not_installed"
      ? {
          text: "Not installed",
          title: "This game is in your library but was never installed on this PC.",
          className: "border-white/35 text-white/80 bg-black/45",
        }
      : null;
  const isFavorite = Boolean(game.isFavorite);
  const favoriteActionLabel = isFavorite
    ? "Remove from Favorites"
    : "Add to Favorites";

  const [isFavoritePulse, setIsFavoritePulse] = useState(false);

  const handlePrimaryAction = (e) => {
    e.stopPropagation();
    if (canPlay && launchable?.exec_path) {
      void launchLibraryGame({
        execPath: launchable.exec_path,
        recordId: game.record_id,
        title: displayTitle,
      });
      return;
    }

    if (needsExecutable) {
      onSelect?.();
      return;
    }

    if (canInstall) {
      onUpdateGame?.(game);
    }
  };

  const handleFavoriteAction = (e) => {
    e.stopPropagation();
    setIsFavoritePulse(true);
    onToggleFavorite?.(game);
  };

  const handleCardKeyDown = (e) => {
    if (e.target !== e.currentTarget) {
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.();
    }
  };

  const thumbChildren = [];
  const bannerPlaceholder = React.createElement(
    "div",
    {
      key: "ph",
      className:
        "flex h-full w-full items-center justify-center bg-gradient-to-br from-tertiary/60 to-primary text-text/35",
    },
    React.createElement(
      "span",
      { className: "material-symbols-outlined text-[34px]", "aria-hidden": true },
      "sports_esports",
    ),
  );
  if (game.banner_url && window.AppImage) {
    thumbChildren.push(
      React.createElement(window.AppImage, {
        key: "img",
        src: game.banner_url,
        alt: displayTitle,
        loading: "lazy",
        draggable: false,
        className: "banner-thumb-img h-full w-full object-cover",
        fallback: bannerPlaceholder,
      }),
    );
  } else if (game.banner_url) {
    thumbChildren.push(
      React.createElement("img", {
        key: "img",
        src: game.banner_url,
        alt: displayTitle,
        className: "w-full h-full object-cover",
      }),
    );
  } else {
    thumbChildren.push(bannerPlaceholder);
  }
  if (stateBadge || isNotMatched) {
    thumbChildren.push(
      React.createElement(
        "div",
        {
          key: "badges",
          className:
            "pointer-events-none absolute top-2 left-2 z-30 flex flex-col items-start gap-1",
        },
        [
          stateBadge &&
            React.createElement(
              "div",
              {
                key: "state",
                className: `app-badge-enter pointer-events-auto px-2 py-0.5 border text-[10px] backdrop-blur-sm ${stateBadge.className}`,
                title: stateBadge.title,
              },
              stateBadge.text,
            ),
          isNotMatched &&
            React.createElement(
              "div",
              {
                key: "unmatched",
                className:
                  "app-badge-enter pointer-events-auto px-2 py-0.5 border border-white/35 bg-black/45 text-[10px] text-white/80 backdrop-blur-sm",
                title:
                  "Added from its folder and not linked to the game catalog yet. Open the details to link it.",
              },
              "Not matched",
            ),
        ].filter(Boolean),
      ),
    );
  }
  if (game.isUpdateAvailable && isInstalled) {
    thumbChildren.push(
      React.createElement(
        "button",
        {
          key: "upd",
          type: "button",
          className:
            "app-badge-enter absolute top-2 right-2 z-30 px-2 py-0.5 border border-yellow-400/90 text-yellow-300 text-[10px] pointer-events-auto bg-black/45 backdrop-blur-sm transition-colors hover:bg-yellow-400/20 hover:text-yellow-100",
          onClick: (e) => {
            e.stopPropagation();
            onUpdateGame?.(game);
          },
        },
        game.latestVersion ? `Update ${game.latestVersion}` : "Update",
      ),
    );
  }

  const primaryActionControl = React.createElement(
    "button",
    {
      key: "play",
      type: "button",
      className: `inline-flex shrink-0 items-center justify-center gap-1 border px-1.5 py-0.5 text-[10px] font-semibold pointer-events-auto transition-[background-color,box-shadow,color] ${
        canPlay || canInstall || needsExecutable
          ? "border-accent/70 bg-accent/85 text-onAccent hover:bg-accent hover:shadow-glow-accent"
          : "cursor-not-allowed border-border/60 bg-surfaceMuted text-white/55"
      }`,
      disabled: !canPlay && !canInstall && !needsExecutable,
      onClick: handlePrimaryAction,
      "aria-label": primaryActionLabel,
      title: needsExecutable
        ? "Choose the file that starts this game"
        : primaryActionLabel,
    },
    React.createElement(
      "span",
      {
        className: "material-symbols-outlined text-[13px] leading-none",
        "aria-hidden": true,
      },
      canPlay
        ? "play_arrow"
        : needsExecutable
          ? "settings"
          : canInstall
            ? "download"
            : "block",
    ),
    primaryActionLabel,
  );

  const favoriteControl = React.createElement(
    "button",
    {
      key: "favorite",
      type: "button",
      className: `inline-flex h-6 w-6 shrink-0 items-center justify-center border pointer-events-auto transition-colors ${
        isFavorite
          ? "border-amber-400/80 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30"
          : "border-border/60 bg-surfaceMuted/70 text-white/80 hover:bg-selected"
      }`,
      onClick: handleFavoriteAction,
      "aria-label": favoriteActionLabel,
      title: favoriteActionLabel,
    },
    React.createElement(
      "span",
      {
        className: "material-symbols-outlined text-[16px] leading-none",
        style: isFavorite ? { fontVariationSettings: "'FILL' 1" } : undefined,
      },
      "star",
    ),
  );

  const bodyChildren = [
    React.createElement(
      "div",
      {
        key: "labels",
        className: "flex justify-between items-center gap-2 mb-1.5 shrink-0",
      },
      [
        React.createElement("div", {
          key: "engine",
          className:
            "text-white text-[10px] px-1.5 py-0.5 shrink-0 max-w-[52%] truncate",
          style: { backgroundColor: getEngineBackgroundColor(game.engine) },
          title: game.engine || "Unknown",
          children: game.engine || "Unknown",
        }),
        React.createElement(
          "div",
          {
            key: "sv",
            className: "flex items-center shrink-0 min-w-0",
          },
          [
            game.status &&
              React.createElement("div", {
                key: "st",
                className:
                  "text-white text-[10px] px-1.5 py-0.5 truncate max-w-[72px]",
                style: {
                  backgroundColor: getStatusBackgroundColor(game.status),
                },
                title: game.status,
                children: game.status,
              }),
            React.createElement("div", {
              key: "ver",
              className: `${
                isMissing
                  ? "bg-amber-500/25 text-amber-100"
                  : isInstalled
                    ? "bg-surfaceMuted text-white"
                    : "bg-surfaceMuted text-white/60"
              } text-[10px] text-right truncate max-w-[100px] ${game.status ? "-ml-px" : ""} px-1.5 py-0.5`,
              title: versionChipText,
              children: versionChipText,
            }),
          ],
        ),
      ],
    ),
    React.createElement(
      "div",
      {
        key: "title",
        className: "mb-2 shrink-0",
      },
      React.createElement("h2", {
        className: "truncate text-sm font-semibold leading-tight text-white",
        title: displayTitle,
        children: displayTitle,
      }),
    ),
    React.createElement(
      "div",
      {
        key: "row",
        className: "mt-auto flex min-h-0 items-center justify-between gap-2",
      },
      [favoriteControl, primaryActionControl],
    ),
  ].filter(Boolean);

  return React.createElement(
    "div",
    {
      className:
        "relative flex flex-col cursor-pointer overflow-hidden banner-root border border-border bg-black/30 shadow-glass-sm ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-accent",
      style: {
        width: BANNER_WIDTH,
        height: BANNER_HEIGHT,
      },
      role: "button",
      tabIndex: 0,
      "aria-label": `${displayTitle}${
        game.isUpdateAvailable && isInstalled ? " (update available)" : ""
      }${isMissing ? " (files missing)" : installState === "not_installed" ? " (not installed)" : ""}`,
      onClick: onSelect,
      onKeyDown: handleCardKeyDown,
      onContextMenu: onContextMenu,
    },
    [
      React.createElement(
        "div",
        {
          key: "thumb",
          className: "relative w-full shrink-0 bg-primary overflow-hidden",
          style: { height: BANNER_IMAGE_H },
        },
        thumbChildren,
      ),
      React.createElement(
        "div",
        {
          key: "body",
          className:
            "flex flex-col flex-1 min-h-0 px-2.5 pt-2 pb-2.5 border-t border-border bg-primary shadow-glass",
        },
        bodyChildren,
      ),
    ],
  );
}

window.F95BannerCard = F95BannerCard;

const GameBanner = ({ game, onSelect, onUpdateGame, onToggleFavorite }) => {
  const handleContextMenu = (e) => {
    e.preventDefault();
    if (!game) {
      return;
    }

    const versions = Array.isArray(game.versions) ? game.versions : [];
    const presentVersions = versions.filter(
      (version) => version?.isPresent !== false,
    );
    const playableVersions = presentVersions.filter((version) =>
      Boolean(version?.exec_path),
    );
    const folderVersions = presentVersions.filter((version) =>
      Boolean(version?.game_path),
    );
    const menuTemplate = [];

    if (playableVersions.length === 1) {
      const v = playableVersions[0];
      const ext = v.exec_path ? v.exec_path.split(".").pop().toLowerCase() : "";
      menuTemplate.push({
        label: "Play",
        enabled: Boolean(v.exec_path),
        data: {
          action: "launch",
          execPath: v.exec_path,
          extension: ext,
          recordId: game.record_id,
        },
      });
    } else if (playableVersions.length > 1) {
      menuTemplate.push({
        label: "Play",
        submenu: playableVersions.map((v) => {
          const ext = v.exec_path
            ? v.exec_path.split(".").pop().toLowerCase()
            : "";
          return {
            label: v.version || "Unknown version",
            enabled: Boolean(v.exec_path),
            data: {
              action: "launch",
              execPath: v.exec_path,
              extension: ext,
              recordId: game.record_id,
            },
          };
        }),
      });
    }

    if (menuTemplate.length > 0) {
      menuTemplate.push({ type: "separator" });
    }

    if (folderVersions.length === 1) {
      const v = folderVersions[0];
      menuTemplate.push({
        label: "Open Game Folder",
        enabled: Boolean(v.game_path),
        data: { action: "openFolder", gamePath: v.game_path },
      });
    } else if (folderVersions.length > 1) {
      menuTemplate.push({
        label: "Open Game Folder",
        submenu: folderVersions.map((v) => ({
          label: v.version || "Unknown version",
          enabled: Boolean(v.game_path),
          data: { action: "openFolder", gamePath: v.game_path },
        })),
      });
    }

    const installState = getCardInstallState(game);
    // The folder was moved or renamed: point the library at its new place.
    if (installState === "missing") {
      menuTemplate.push({
        label: "Locate Folder…",
        data: { action: "locateGame", recordId: game.record_id },
      });
    }

    // Files are here, but no version knows which file starts the game.
    if (
      installState === "installed" &&
      playableVersions.length === 0 &&
      presentVersions.length > 0
    ) {
      menuTemplate.push({
        label: "Choose Executable…",
        data: { action: "chooseExecutable", recordId: game.record_id },
      });
    }

    if (game.isUpdateAvailable && playableVersions.length && game.siteUrl) {
      if (menuTemplate.length > 0) {
        menuTemplate.push({ type: "separator" });
      }

      menuTemplate.push({
        label: game.latestVersion
          ? `Update to ${game.latestVersion}`
          : "Update Game",
        data: { action: "updateGame", recordId: game.record_id },
      });
    }

    // No playable copy on this PC (never installed, or the folder is gone):
    // offer a fresh install instead of an update.
    if (!playableVersions.length && game.siteUrl) {
      if (menuTemplate.length > 0) {
        menuTemplate.push({ type: "separator" });
      }

      menuTemplate.push({
        label: game.latestVersion
          ? `Install ${game.latestVersion}`
          : "Install",
        data: { action: "updateGame", recordId: game.record_id },
      });
    }

    if (game.siteUrl) {
      if (menuTemplate.length > 0) {
        menuTemplate.push({ type: "separator" });
      }

      menuTemplate.push({
        label: "Open Game Page",
        data: { action: "openUrl", url: game.siteUrl },
      });
    }

    if (menuTemplate.length > 0) {
      menuTemplate.push({ type: "separator" });
    }

    menuTemplate.push({
      label: game.isFavorite ? "Remove from Favorites" : "Add to Favorites",
      data: {
        action: game.isFavorite ? "removeFromFavorites" : "addToFavorites",
        recordId: game.record_id,
      },
    });

    if (menuTemplate.length > 0) {
      menuTemplate.push({ type: "separator" });
    }

    menuTemplate.push({
      label: "View Details",
      data: { action: "properties", recordId: game.record_id },
    });

    menuTemplate.push({
      label: "Remove Game",
      data: { action: "removeGame", recordId: game.record_id },
    });

    window.electronAPI.showContextMenu(menuTemplate);
  };

  const CustomTemplate = useBannerTemplate();

  if (!game) {
    return null;
  }

  return React.createElement(CustomTemplate || F95BannerCard, {
    game,
    onSelect,
    onUpdateGame,
    onToggleFavorite,
    onContextMenu: handleContextMenu,
  });
};

window.GameBanner = GameBanner;
