const HOST_LABEL_ALIASES = [
  { pattern: /(^|\.)gofile\.io$/i, label: "GOFILE" },
  { pattern: /(^|\.)mixdrop\./i, label: "MIXDROP" },
  { pattern: /(^|\.)mega\.nz$/i, label: "MEGA" },
  { pattern: /(^|\.)buzzheavier\.com$/i, label: "BUZZHEAVIER" },
  { pattern: /(^|\.)datanodes\.to$/i, label: "DATANODES" },
  { pattern: /(^|\.)pixeldrain\.com$/i, label: "PIXELDRAIN" },
  { pattern: /(^|\.)workupload\.com$/i, label: "WORKUPLOAD" },
  { pattern: /(^|\.)mediafire\.com$/i, label: "MEDIAFIRE" },
  { pattern: /(^|\.)uploadhaven\.com$/i, label: "UPLOADHAVEN" },
  { pattern: /(^|\.)krakenfiles\.com$/i, label: "KRAKENFILES" },
  { pattern: /(^|\.)drive\.google\.com$/i, label: "GOOGLE DRIVE" },
  {
    pattern: /(^|\.)drive\.usercontent\.google\.com$/i,
    label: "GOOGLE DRIVE",
  },
  { pattern: /(^|\.)1drv\.ms$/i, label: "ONEDRIVE" },
  { pattern: /(^|\.)onedrive\.live\.com$/i, label: "ONEDRIVE" },
];

const normalizeHostToken = (host) => {
  const hostname = String(host || "").trim().toLowerCase();
  if (!hostname) {
    return "";
  }

  const alias = HOST_LABEL_ALIASES.find((entry) => entry.pattern.test(hostname));
  if (alias) {
    return alias.label;
  }

  const token = hostname
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean)[0];
  if (!token) {
    return "";
  }

  return token.replace(/[^a-z0-9]+/gi, "").toUpperCase();
};

const getF95MirrorDisplayName = (link) => {
  const hostLabel = normalizeHostToken(link?.host);
  if (hostLabel) {
    return hostLabel;
  }

  const fallback = String(link?.label || "Mirror")
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .replace(/^www\./i, "")
    .replace(/[^a-z0-9 ._-]+/gi, "");

  if (!fallback) {
    return "MIRROR";
  }

  return fallback.toUpperCase();
};

const normalizeMirrorVariants = (variants, links, fallbackLabel) => {
  const groups =
    Array.isArray(variants) && variants.length > 0
      ? variants
      : [{ id: "downloads", label: fallbackLabel || "Downloads", links }];

  return groups
    .map((variant) => ({
      id: variant?.id || "group",
      label: String(variant?.label || fallbackLabel || "Downloads"),
      links: Array.isArray(variant?.links) ? variant.links : [],
    }))
    .filter((variant) => variant.links.length > 0);
};

const F95MirrorColumns = ({
  variants,
  links,
  selectedLinkUrl,
  onSelectLink,
  disabled,
  fallbackLabel = "Downloads",
}) => {
  const variantGroups = normalizeMirrorVariants(variants, links, fallbackLabel);
  if (variantGroups.length === 0) {
    return null;
  }

  const columnCount = variantGroups.length;

  return (
    <div className="min-w-0 overflow-x-auto">
      <div
        className="grid w-full min-w-0 divide-x divide-border/70"
        style={{
          gridTemplateColumns: `repeat(${columnCount}, minmax(5.5rem, 1fr))`,
        }}
      >
        {variantGroups.map((variant) => (
          <section
            key={`${variant.id}-${variant.label}`}
            className="min-w-0 px-3 sm:px-4"
          >
            <div className="border-b border-border/70 pb-2 text-[11px] uppercase tracking-[0.18em] text-text/50">
              {variant.label}
            </div>
            <div className="mt-3 flex flex-col gap-1">
              {variant.links.map((link) => {
                const isSelected =
                  selectedLinkUrl && String(selectedLinkUrl) === String(link.url);
                return (
                  <button
                    key={link.url}
                    type="button"
                    onClick={() => onSelectLink?.(link)}
                    disabled={disabled}
                    title={String(link?.host || "")}
                    className={`w-full rounded-md px-0 py-1 text-left text-xs font-semibold uppercase tracking-[0.08em] transition ${
                      isSelected
                        ? "text-accent"
                        : "text-text/80 hover:bg-white/5 hover:text-text"
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {getF95MirrorDisplayName(link)}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

window.getF95MirrorDisplayName = getF95MirrorDisplayName;
window.F95MirrorColumns = F95MirrorColumns;
