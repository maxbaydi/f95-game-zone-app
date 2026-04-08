const { useState, useEffect } = window.React;

const ATLAS_PREVIEW_W = 21;
const ATLAS_PREVIEW_H = 9;
const ATLAS_BANNER_WIDTH = 252;
const ATLAS_BANNER_IMAGE_H = Math.round(
  (ATLAS_BANNER_WIDTH * ATLAS_PREVIEW_H) / ATLAS_PREVIEW_W,
);
const ATLAS_BANNER_FOOTER_H = 100;
const ATLAS_BANNER_HEIGHT = ATLAS_BANNER_IMAGE_H + ATLAS_BANNER_FOOTER_H;

const bannerStyles = `
  .banner-root {
    perspective: 1000px;
    transform-style: preserve-3d;
    transform: skewX(0.001deg);
    transition: transform 0.38s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.38s ease;
  }
  .banner-root:hover {
    transform: rotateX(5deg) translateY(-6px) scale(1.02);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px #3d4450, 0 0 20px rgba(102, 192, 244, 0.12);
  }
  .banner-root::before {
    content: '';
    position: absolute;
    z-index: -1;
    top: 5%;
    left: 5%;
    width: 90%;
    height: 90%;
    background: rgba(0,0,0,0.45);
    box-shadow: 0 12px 32px rgba(0,0,0,0.45);
    transform-origin: top center;
    transform: skewX(0.001deg);
    transition: transform 0.38s cubic-bezier(0.22, 1, 0.36, 1) 0.08s, opacity 0.45s ease 0.08s;
    border-radius: 0;
  }
  .banner-root:hover::before {
    opacity: 0.55;
    transform: rotateX(5deg) translateY(-6px) scale(1.02);
  }
  @media (prefers-reduced-motion: reduce) {
    .banner-root,
    .banner-root::before {
      transition: none;
    }
    .banner-root:hover {
      transform: none;
      box-shadow: none;
    }
    .banner-root:hover::before {
      transform: none;
      opacity: 0.5;
    }
  }
`;

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

const getNewestVersion = (versions) => {
  if (!versions || versions.length === 0) return "V 1.0";
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
  return maxVersion || "V 1.0";
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

function AtlasF95BannerCard({ game, onSelect, onUpdateGame, onContextMenu }) {
  const displayTitle = game.displayTitle || game.title || "Unknown";
  const newestInstalledVersion =
    game.newestInstalledVersion ||
    (Array.isArray(game.versions) && game.versions.length > 0
      ? getNewestVersion(game.versions)
      : game.latestVersion || "Unknown");
  const launchable = pickVersionForLaunch(game.versions);
  const canPlay = Boolean(launchable?.exec_path);
  const canInstall = !canPlay && Boolean(game.siteUrl);
  const primaryActionLabel = canPlay
    ? "Play"
    : canInstall
      ? "Install"
      : "Play";

  const handlePrimaryAction = (e) => {
    e.stopPropagation();
    if (canPlay && launchable?.exec_path) {
      const ext = launchable.exec_path.split(".").pop().toLowerCase() || "";
      window.electronAPI.launchGame({
        execPath: launchable.exec_path,
        extension: ext,
        recordId: game.record_id,
      });
      return;
    }

    if (canInstall) {
      onUpdateGame?.(game);
    }
  };

  const thumbChildren = [];
  if (game.banner_url) {
    thumbChildren.push(
      React.createElement("img", {
        key: "img",
        src: game.banner_url,
        alt: displayTitle,
        className: "w-full h-full object-cover",
      }),
    );
  } else {
    thumbChildren.push(
      React.createElement("div", {
        key: "ph",
        className: "w-full h-full bg-primary",
      }),
    );
  }
  if (game.isUpdateAvailable) {
    thumbChildren.push(
      React.createElement(
        "button",
        {
          key: "upd",
          type: "button",
          className:
            "absolute top-2 right-2 z-30 px-2 py-0.5 border border-yellow-400/90 text-yellow-300 text-[10px] pointer-events-auto bg-black/45 backdrop-blur-sm",
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
      className: `inline-flex shrink-0 items-center justify-center border px-1.5 py-0.5 text-[10px] font-semibold pointer-events-auto transition-colors ${
        canPlay || canInstall
          ? "border-accent/70 bg-accent/85 text-onAccent hover:bg-accent"
          : "cursor-not-allowed border-border/60 bg-surfaceMuted text-white/55"
      }`,
      disabled: !canPlay && !canInstall,
      onClick: handlePrimaryAction,
      "aria-label": primaryActionLabel,
      title: primaryActionLabel,
    },
    primaryActionLabel,
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
              className: `bg-surfaceMuted text-white text-[10px] text-right truncate max-w-[100px] ${game.status ? "-ml-px" : ""} px-1.5 py-0.5`,
              title: newestInstalledVersion,
              children: newestInstalledVersion,
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
        className: "mt-auto flex min-h-0 items-center justify-end",
      },
      primaryActionControl,
    ),
  ].filter(Boolean);

  return React.createElement(
    "div",
    {
      className:
        "relative flex flex-col cursor-pointer overflow-hidden banner-root border border-border bg-black/30 shadow-glass-sm ring-1 ring-border",
      style: {
        width: ATLAS_BANNER_WIDTH,
        height: ATLAS_BANNER_HEIGHT,
      },
      onClick: onSelect,
      onContextMenu: onContextMenu,
    },
    [
      React.createElement("style", { key: "banner-styles" }, bannerStyles),
      React.createElement(
        "div",
        {
          key: "thumb",
          className: "relative w-full shrink-0 bg-primary overflow-hidden",
          style: { height: ATLAS_BANNER_IMAGE_H },
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

window.AtlasF95BannerCard = AtlasF95BannerCard;

const GameBanner = ({ game, onSelect, onUpdateGame }) => {
  const [template, setTemplate] = useState(null);

  const handleContextMenu = (e) => {
    e.preventDefault();
    if (!game) {
      return;
    }

    const versions = Array.isArray(game.versions) ? game.versions : [];
    const playableVersions = versions.filter((version) =>
      Boolean(version?.exec_path),
    );
    const folderVersions = versions.filter((version) =>
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

    if (game.isUpdateAvailable && game.siteUrl) {
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

    if (!playableVersions.length && game.siteUrl) {
      if (menuTemplate.length > 0) {
        menuTemplate.push({ type: "separator" });
      }

      menuTemplate.push({
        label: "Install",
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
      label: "View Details",
      data: { action: "properties", recordId: game.record_id },
    });

    menuTemplate.push({
      label: "Remove Game",
      data: { action: "removeGame", recordId: game.record_id },
    });

    window.electronAPI.showContextMenu(menuTemplate);
  };

  const DefaultBannerTemplate = (props) =>
    React.createElement(AtlasF95BannerCard, {
      ...props,
      onContextMenu: handleContextMenu,
    });

  useEffect(() => {
    const loadTemplate = async () => {
      try {
        const selectedTemplate =
          await window.electronAPI.getSelectedBannerTemplate();
        if (selectedTemplate && selectedTemplate !== "Default") {
          try {
            const templateModule = await import(
              `./data/templates/banner/${selectedTemplate}.js`
            );
            setTemplate(() => templateModule.default);
          } catch (importErr) {
            console.error(
              `Failed to import template ${selectedTemplate}:`,
              importErr,
            );
            window.electronAPI.log(
              `Failed to import template ${selectedTemplate}: ${importErr.message}`,
            );
            setTemplate(() => DefaultBannerTemplate);
          }
        } else {
          setTemplate(() => DefaultBannerTemplate);
        }
      } catch (err) {
        console.error("Error loading banner template:", err);
        window.electronAPI.log(`Error loading banner template: ${err.message}`);
        setTemplate(() => DefaultBannerTemplate);
      }
    };
    loadTemplate();
  }, [game.banner_url]);

  if (!template) {
    return React.createElement("div", null, "Loading template...");
  }

  return React.createElement(template, {
    game,
    onSelect,
    onUpdateGame,
    onContextMenu: handleContextMenu,
  });
};

window.GameBanner = GameBanner;
