const mirrorAutomation = window.f95MirrorAutomation || null;

const MIRROR_TIER_FALLBACK_INFO = {
  label: "Auto*",
  title: "Usually automatic",
  description: "F95Launcher tries this mirror automatically.",
};

const MIRROR_TIER_STYLES = {
  auto: {
    chip: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200",
    dot: "bg-emerald-400",
    icon: "bolt",
    accent: "border-emerald-400/35",
  },
  assisted: {
    chip: "border-amber-400/40 bg-amber-500/15 text-amber-100",
    dot: "bg-amber-400",
    icon: "verified_user",
    accent: "border-amber-400/35",
  },
  manual: {
    chip: "border-white/15 bg-white/5 text-text/65",
    dot: "bg-text/35",
    icon: "open_in_browser",
    accent: "border-border",
  },
};

const MIRROR_TIER_STEPS = {
  auto: [
    { icon: "download", label: "Download" },
    { icon: "folder_zip", label: "Unpack" },
    { icon: "library_add_check", label: "Add to library" },
  ],
  assisted: [
    { icon: "bolt", label: "Try automatically" },
    { icon: "verified_user", label: "Quick check if asked" },
    { icon: "library_add_check", label: "Install" },
  ],
  manual: [
    { icon: "open_in_browser", label: "Page opens" },
    { icon: "ads_click", label: "You press Download" },
    { icon: "library_add_check", label: "We install it" },
  ],
};

const RECOMMENDATION_REASONS = {
  remembered: "You installed from this mirror last time",
  "best-host": "Best automatic host for your system",
  "browser-only":
    "No automatic host for this build, so the page opens in the browser",
};

const describeF95MirrorLink = (link) =>
  mirrorAutomation?.describeMirrorLink(link) || {
    hostId: "",
    tier: "assisted",
    rank: 190,
    note: "",
  };

const getF95MirrorTierInfo = (tier) =>
  mirrorAutomation?.getMirrorTierInfo(tier) || MIRROR_TIER_FALLBACK_INFO;

const getMirrorTierStyle = (tier) =>
  MIRROR_TIER_STYLES[tier] || MIRROR_TIER_STYLES.assisted;

const getF95MirrorDisplayName = (link) => {
  if (mirrorAutomation) {
    return mirrorAutomation.getMirrorDisplayName(link);
  }

  const token = String(link?.host || link?.label || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[./]/)
    .filter(Boolean)[0];
  return token ? token.toUpperCase() : "MIRROR";
};

const sortF95MirrorLinks = (links) =>
  mirrorAutomation ? mirrorAutomation.sortMirrorLinks(links) : [...links];

const isBrowserOnlyMirror = (link) =>
  describeF95MirrorLink(link).tier === "manual";

const getF95MirrorActionLabel = (link, { isUpdate = false } = {}) => {
  if (!link) {
    return isUpdate ? "Update" : "Install";
  }

  const hostName = getF95MirrorDisplayName(link);
  if (isBrowserOnlyMirror(link)) {
    return `Open ${hostName} to download`;
  }

  return `${isUpdate ? "Update" : "Install"} via ${hostName}`;
};

const normalizeMirrorVariants = (variants, links, fallbackLabel) => {
  const groups =
    Array.isArray(variants) && variants.length > 0
      ? variants
      : [{ id: "downloads", label: fallbackLabel || "Downloads", links }];

  return groups
    .map((variant, index) => {
      const normalizedLabel = String(
        variant?.label || fallbackLabel || "Downloads",
      );
      const labelParts = normalizedLabel.split(" · ");
      const inferredReleaseLabel = labelParts.length > 1 ? labelParts[0] : "";
      const inferredPlatformLabel =
        labelParts.length > 1
          ? labelParts.slice(1).join(" · ")
          : normalizedLabel;
      return {
        id: variant?.id || "group",
        label: normalizedLabel,
        platformLabel: String(
          variant?.platformLabel || inferredPlatformLabel || normalizedLabel,
        ),
        releaseLabel: String(
          variant?.releaseLabel || inferredReleaseLabel || "",
        ),
        firstOrder: Number(variant?.firstOrder ?? index),
        links: sortF95MirrorLinks(
          Array.isArray(variant?.links) ? variant.links : [],
        ),
      };
    })
    .filter((variant) => variant.links.length > 0);
};

const groupVariantsByRelease = (variants) => {
  const groups = new Map();
  for (const variant of variants) {
    const releaseLabel = String(variant.releaseLabel || "").trim();
    const releaseKey = releaseLabel || "__default";
    if (!groups.has(releaseKey)) {
      groups.set(releaseKey, {
        key: releaseKey,
        releaseLabel,
        firstOrder: variant.firstOrder,
        variants: [],
      });
    }

    const group = groups.get(releaseKey);
    if (variant.firstOrder < group.firstOrder) {
      group.firstOrder = variant.firstOrder;
    }
    group.variants.push(variant);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      variants: [...group.variants].sort(
        (left, right) => left.firstOrder - right.firstOrder,
      ),
    }))
    .sort((left, right) => left.firstOrder - right.firstOrder);
};

const findF95MirrorVariant = (variants, links, linkUrl) =>
  normalizeMirrorVariants(variants, links).find((variant) =>
    variant.links.some((link) => String(link.url) === String(linkUrl)),
  ) || null;

const buildF95MirrorFallbackLinks = (thread, link) => {
  if (!mirrorAutomation || !link) {
    return [];
  }

  const variant = findF95MirrorVariant(
    thread?.variants,
    thread?.links,
    link.url,
  );
  return mirrorAutomation
    .buildMirrorFallbackChain({
      variants: thread?.variants,
      links: thread?.links,
      link,
    })
    .map((fallbackLink) => ({
      url: fallbackLink.url,
      label: fallbackLink.label,
      host: fallbackLink.host,
      variantId: fallbackLink.variantId || variant?.id || "",
    }));
};

const F95MirrorTierBadge = ({ tier, compact = false }) => {
  const style = getMirrorTierStyle(tier);
  const info = getF95MirrorTierInfo(tier);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-[0.12em] ${style.chip}`}
      title={`${info.title}. ${info.description}`}
    >
      <span className="material-symbols-outlined text-[12px] leading-none">
        {style.icon}
      </span>
      {!compact && info.label}
    </span>
  );
};

const F95MirrorLegend = () => (
  <div className="flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-text/60">
    {["auto", "assisted", "manual"].map((tier) => (
      <div key={tier} className="flex items-center gap-2">
        <F95MirrorTierBadge tier={tier} />
        <span>{getF95MirrorTierInfo(tier).title}</span>
      </div>
    ))}
  </div>
);

const F95MirrorLinkButton = ({
  link,
  isSelected,
  isRecommended,
  disabled,
  onSelect,
}) => {
  const automation = describeF95MirrorLink(link);
  const style = getMirrorTierStyle(automation.tier);
  const tierInfo = getF95MirrorTierInfo(automation.tier);
  const isBrowserOnly = automation.tier === "manual";

  return (
    <button
      type="button"
      onClick={() => onSelect?.(link)}
      disabled={disabled}
      title={[tierInfo.title, automation.note, link?.host]
        .filter(Boolean)
        .join(" · ")}
      className={`group flex w-full min-w-0 items-center gap-2 border px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-[0.08em] transition ${
        isSelected
          ? "border-accent/70 bg-selected text-accent shadow-glow-accent"
          : `border-transparent hover:border-border hover:bg-white/5 ${
              isBrowserOnly
                ? "text-text/50 hover:text-text/80"
                : "text-text/85 hover:text-text"
            }`
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <span className={`h-2 w-2 shrink-0 ${style.dot}`} />
      <span className="min-w-0 flex-1 truncate">
        {getF95MirrorDisplayName(link)}
      </span>
      {isRecommended && (
        <span
          className="material-symbols-outlined text-[14px] leading-none text-glam"
          title="Recommended"
        >
          star
        </span>
      )}
      {isBrowserOnly && (
        <span className="material-symbols-outlined text-[14px] leading-none text-text/40">
          open_in_browser
        </span>
      )}
    </button>
  );
};

const F95MirrorColumns = ({
  variants,
  links,
  selectedLinkUrl,
  recommendedLinkUrl = "",
  onSelectLink,
  disabled,
  fallbackLabel = "Downloads",
}) => {
  const releaseGroups = React.useMemo(() => {
    const variantGroups = normalizeMirrorVariants(
      variants,
      links,
      fallbackLabel,
    );
    if (variantGroups.length === 0) {
      return [];
    }
    return groupVariantsByRelease(variantGroups);
  }, [variants, links, fallbackLabel]);

  if (releaseGroups.length === 0) {
    return null;
  }

  const renderLink = (link) => (
    <F95MirrorLinkButton
      key={link.url}
      link={link}
      isSelected={
        Boolean(selectedLinkUrl) && String(selectedLinkUrl) === String(link.url)
      }
      isRecommended={
        Boolean(recommendedLinkUrl) &&
        String(recommendedLinkUrl) === String(link.url)
      }
      disabled={disabled}
      onSelect={onSelectLink}
    />
  );

  return (
    <div className="space-y-6">
      {releaseGroups.map((releaseGroup) => {
        const columnCount = releaseGroup.variants.length;
        return (
          <section key={releaseGroup.key} className="min-w-0">
            {releaseGroup.releaseLabel && (
              <div className="mb-3 text-sm font-semibold text-text/90">
                {releaseGroup.releaseLabel}
              </div>
            )}
            <div className="min-w-0 overflow-x-auto">
              <div
                className="grid w-full min-w-0 divide-x divide-border/70"
                style={{
                  gridTemplateColumns: `repeat(${columnCount}, minmax(8.5rem, 1fr))`,
                }}
              >
                {releaseGroup.variants.map((variant) => {
                  const quickLinks = variant.links.filter(
                    (link) => !isBrowserOnlyMirror(link),
                  );
                  const browserLinks =
                    variant.links.filter(isBrowserOnlyMirror);
                  return (
                    <section
                      key={`${variant.id}-${variant.label}`}
                      className="min-w-0 px-3 sm:px-4"
                    >
                      <div className="border-b border-border/70 pb-2 text-[11px] uppercase tracking-[0.18em] text-text/50">
                        {variant.platformLabel || variant.label}
                      </div>
                      <div className="mt-2 flex flex-col gap-0.5">
                        {quickLinks.map(renderLink)}
                      </div>
                      {browserLinks.length > 0 && (
                        <div className="mt-2">
                          <div
                            className="flex items-center gap-2 px-2 pb-1 text-[10px] uppercase tracking-[0.16em] text-text/35"
                            title={getF95MirrorTierInfo("manual").description}
                          >
                            <span className="h-px flex-1 bg-border/70" />
                            In browser
                            <span className="h-px flex-1 bg-border/70" />
                          </div>
                          <div className="flex flex-col gap-0.5">
                            {browserLinks.map(renderLink)}
                          </div>
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
};

const F95MirrorSteps = ({ tier }) => {
  const steps = MIRROR_TIER_STEPS[tier] || MIRROR_TIER_STEPS.assisted;
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-text/75">
      {steps.map((step, index) => (
        <li key={step.label} className="flex items-center gap-2">
          {index > 0 && (
            <span className="material-symbols-outlined text-[14px] leading-none text-text/30">
              arrow_forward
            </span>
          )}
          <span className="flex items-center gap-1.5 border border-border/80 bg-black/20 px-2 py-1">
            <span className="text-[10px] font-semibold text-accent/80">
              {index + 1}
            </span>
            <span className="material-symbols-outlined text-[15px] leading-none text-text/70">
              {step.icon}
            </span>
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
};

const collapseAttemptEvents = (events) => {
  const byIndex = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    byIndex.set(event.index, event);
  }
  return [...byIndex.values()].sort((left, right) => left.index - right.index);
};

const F95MirrorAttemptLog = ({ events }) => {
  const rows = collapseAttemptEvents(events);
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5 border border-border bg-black/25 px-4 py-3 text-xs">
      {rows.map((row) => {
        const hostName = getF95MirrorDisplayName(row);
        let icon = "progress_activity";
        let tone = "text-text/80";
        let text = `Connecting to ${hostName}...`;
        if (row.phase === "resolved") {
          icon = "check_circle";
          tone = "text-emerald-200";
          text = `${hostName} is ready, the download is starting`;
        } else if (row.phase === "failed") {
          icon = row.actionRequired ? "verified_user" : "cancel";
          tone = row.actionRequired ? "text-amber-100" : "text-red-200";
          text = row.actionRequired
            ? `${hostName} asks for a quick check in the browser`
            : `${hostName} did not return the file: ${row.error || "unknown error"}`;
        }

        return (
          <div
            key={`${row.index}-${row.url}`}
            className={`flex items-start gap-2 ${tone}`}
          >
            <span
              className={`material-symbols-outlined mt-px text-[16px] leading-none ${
                row.phase === "trying" ? "animate-spin" : ""
              }`}
            >
              {icon}
            </span>
            <span className="min-w-0 flex-1 break-words">
              {row.total > 1 && (
                <span className="mr-1.5 text-text/40">
                  {row.index + 1}/{row.total}
                </span>
              )}
              {text}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const F95RecommendedMirrorCard = ({ thread, link, recommendedLinkUrl }) => {
  if (!link) {
    return null;
  }

  const automation = describeF95MirrorLink(link);
  const tierInfo = getF95MirrorTierInfo(automation.tier);
  const style = getMirrorTierStyle(automation.tier);
  const variant = findF95MirrorVariant(
    thread?.variants,
    thread?.links,
    link.url,
  );
  const isRecommended =
    Boolean(recommendedLinkUrl) &&
    String(recommendedLinkUrl) === String(link.url);
  const reasonText = isRecommended
    ? RECOMMENDATION_REASONS[thread?.recommendation?.reason] ||
      RECOMMENDATION_REASONS["best-host"]
    : "Your choice";
  const fallbackLinks =
    automation.tier === "manual"
      ? []
      : buildF95MirrorFallbackLinks(thread, link);
  const variantLabel = [
    variant?.releaseLabel,
    variant?.platformLabel || variant?.label,
  ]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" · ");

  return (
    <section
      className={`border bg-secondary/70 px-5 py-4 shadow-glass ${style.accent}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em]">
        <span
          className={`material-symbols-outlined text-[16px] leading-none ${
            isRecommended ? "text-glam" : "text-accent"
          }`}
        >
          {isRecommended ? "star" : "touch_app"}
        </span>
        <span className={isRecommended ? "text-glam" : "text-accent"}>
          {isRecommended ? "Recommended" : "Selected"}
        </span>
        <span className="normal-case tracking-normal text-text/55">
          {reasonText}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="text-2xl font-semibold tracking-[0.04em] text-text">
          {getF95MirrorDisplayName(link)}
        </div>
        <F95MirrorTierBadge tier={automation.tier} />
        {variantLabel && (
          <div className="ml-auto border border-border/80 bg-black/20 px-2 py-1 text-xs text-text/75">
            {variantLabel}
          </div>
        )}
      </div>

      <div className="mt-2 text-sm text-text/70">
        {tierInfo.description}
        {automation.note ? ` ${automation.note}` : ""}
      </div>

      <div className="mt-4">
        <F95MirrorSteps tier={automation.tier} />
      </div>

      {fallbackLinks.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-text/55">
          <span className="material-symbols-outlined text-[15px] leading-none text-emerald-300/80">
            swap_horiz
          </span>
          If it fails, F95Launcher switches to
          {fallbackLinks.map((fallbackLink) => (
            <span
              key={fallbackLink.url}
              className="border border-border/80 bg-black/20 px-1.5 py-0.5 font-semibold uppercase tracking-[0.08em] text-text/75"
            >
              {getF95MirrorDisplayName(fallbackLink)}
            </span>
          ))}
          automatically.
        </div>
      )}
    </section>
  );
};

const F95MirrorPicker = ({
  thread,
  selectedLinkUrl,
  onSelectLink,
  disabled,
  attemptEvents,
}) => {
  const links = Array.isArray(thread?.links) ? thread.links : [];
  const variants = Array.isArray(thread?.variants) ? thread.variants : [];
  const recommendedLinkUrl =
    thread?.recommendation?.linkUrl || thread?.preferredLinkUrl || "";
  const selectedLink =
    links.find((link) => String(link.url) === String(selectedLinkUrl)) ||
    links.find((link) => String(link.url) === String(recommendedLinkUrl)) ||
    links[0] ||
    null;
  const recommendedTier = recommendedLinkUrl
    ? describeF95MirrorLink(
        links.find((link) => String(link.url) === String(recommendedLinkUrl)),
      ).tier
    : "manual";
  const [showAllMirrors, setShowAllMirrors] = React.useState(
    !recommendedLinkUrl || recommendedTier === "manual",
  );

  if (links.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <F95RecommendedMirrorCard
        thread={thread}
        link={selectedLink}
        recommendedLinkUrl={recommendedLinkUrl}
      />

      <F95MirrorAttemptLog events={attemptEvents} />

      <section className="border border-border/70 bg-black/10">
        <button
          type="button"
          onClick={() => setShowAllMirrors((previous) => !previous)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-text/80 transition hover:bg-white/5"
        >
          <span className="material-symbols-outlined text-[18px] leading-none text-text/60">
            {showAllMirrors ? "expand_less" : "expand_more"}
          </span>
          <span className="font-medium">
            {showAllMirrors
              ? "Hide other mirrors"
              : "Choose another build or mirror"}
          </span>
          <span className="text-text/45">({links.length})</span>
        </button>
        {showAllMirrors && (
          <div className="space-y-4 border-t border-border/70 px-4 py-4">
            <F95MirrorLegend />
            <F95MirrorColumns
              variants={variants}
              links={links}
              selectedLinkUrl={selectedLink?.url || ""}
              recommendedLinkUrl={recommendedLinkUrl}
              onSelectLink={onSelectLink}
              disabled={disabled}
            />
          </div>
        )}
      </section>
    </div>
  );
};

const useF95InstallAttempts = () => {
  const [attemptEvents, setAttemptEvents] = React.useState([]);
  const threadUrlRef = React.useRef("");

  React.useEffect(() => {
    if (typeof window.electronAPI?.onF95InstallAttempt !== "function") {
      return undefined;
    }

    return window.electronAPI.onF95InstallAttempt((payload) => {
      if (
        !payload ||
        String(payload.threadUrl || "") !== threadUrlRef.current
      ) {
        return;
      }
      setAttemptEvents((previous) => [...previous, payload]);
    });
  }, []);

  const beginAttempts = React.useCallback((threadUrl) => {
    threadUrlRef.current = String(threadUrl || "");
    setAttemptEvents([]);
  }, []);

  const resetAttempts = React.useCallback(() => {
    threadUrlRef.current = "";
    setAttemptEvents([]);
  }, []);

  return { attemptEvents, beginAttempts, resetAttempts };
};

window.f95MirrorUi = {
  buildFallbackLinks: buildF95MirrorFallbackLinks,
  describeLink: describeF95MirrorLink,
  findVariant: findF95MirrorVariant,
  getActionLabel: getF95MirrorActionLabel,
  isBrowserOnly: isBrowserOnlyMirror,
};
window.getF95MirrorDisplayName = getF95MirrorDisplayName;
window.useF95InstallAttempts = useF95InstallAttempts;
window.F95MirrorTierBadge = F95MirrorTierBadge;
window.F95MirrorAttemptLog = F95MirrorAttemptLog;
window.F95MirrorColumns = F95MirrorColumns;
window.F95MirrorPicker = F95MirrorPicker;
