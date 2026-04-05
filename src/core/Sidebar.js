const Sidebar = ({
  activeSection = "library",
  onSelectSection,
  updateCount = 0,
}) => {
  const items = [
    {
      id: "library",
      label: "Library",
      path: [
        '<path d="M12 2 A 1 1 0 0 0 11.289062 2.296875L1.203125 11.097656 A 0.5 0.5 0 0 0 1 11.5 A 0.5 0.5 0 0 0 1.5 12L4 12L4 20C4 20.552 4.448 21 5 21L9 21C9.552 21 10 20.552 10 20L10 14L14 14L14 20C14 20.552 14.448 21 15 21L19 21C19.552 21 20 20.552 20 20L20 12L22.5 12 A 0.5 0.5 0 0 0 23 11.5 A 0.5 0.5 0 0 0 22.796875 11.097656L12.716797 2.3027344 A 1 1 0 0 0 12.710938 2.296875 A 1 1 0 0 0 12 2 z"/>',
      ],
      viewBox: "0 0 24 22",
    },
    {
      id: "updates",
      label: "Updates",
      path: [
        '<path d="M5,12A7,7,0,0,1,16.89,7H14a1,1,0,0,0,0,2h5.08A1,1,0,0,0,20,8V3a1,1,0,0,0-2,0V5.32A9,9,0,0,0,3,12a1,1,0,0,0,2,0Z M20,11a1,1,0,0,0-1,1A7,7,0,0,1,7.11,17H10a1,1,0,0,0,0-2H4.92A1,1,0,0,0,4,16v5a1,1,0,0,0,2,0V18.68A9,9,0,0,0,21,12,1,1,0,0,0,20,11Z"/>',
      ],
      viewBox: "0 0 24 24",
      badge: updateCount > 0 ? updateCount : null,
    },
    {
      id: "search",
      label: "Search",
      path: [
        '<path d="M10.5 3C6.35786 3 3 6.35786 3 10.5C3 14.6421 6.35786 18 10.5 18C12.2632 18 13.8844 17.3913 15.1641 16.3711L19.3965 20.6035C19.5918 20.7988 19.9082 20.7988 20.1035 20.6035C20.2988 20.4082 20.2988 20.0918 20.1035 19.8965L15.8711 15.6641C16.8913 14.3844 17.5 12.7632 17.5 11C17.5 6.85786 14.1421 3.5 10 3.5 Z M10.5 5C13.8137 5 16.5 7.68629 16.5 11C16.5 14.3137 13.8137 17 10.5 17C7.18629 17 4.5 14.3137 4.5 11C4.5 7.68629 7.18629 5 10.5 5Z"/>',
      ],
      viewBox: "0 0 24 24",
    },
  ];

  return React.createElement(
    "div",
    {
      className:
        "w-[60px] flex min-w-[60px] flex-col items-center border-r border-border bg-primary/80 py-px backdrop-blur-xl fixed z-50 h-full shadow-glass-sm",
    },
    items.map((item) => {
      const isActive = activeSection === item.id && !item.isExternal;

      return React.createElement(
        "button",
        {
          key: item.id,
          type: "button",
          title: item.label,
          className:
            "group relative flex h-[68px] w-full cursor-pointer items-center justify-center bg-transparent transition-colors [-webkit-app-region:no-drag] hover:bg-white/5",
          onClick: () => onSelectSection?.(item.id),
        },
        React.createElement("div", {
          className: `absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b from-accentBar to-accent transition-opacity shadow-glow-accent ${
            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-80"
          }`,
        }),
        item.badge &&
          React.createElement(
            "div",
            {
              className:
                "absolute right-2 top-3 min-w-[18px] rounded-full border border-glam/40 bg-glam/90 px-1.5 py-0.5 text-[10px] font-semibold text-black shadow-glow-glam",
            },
            item.badge > 99 ? "99+" : String(item.badge),
          ),
        React.createElement(
          "div",
          {
            className:
              "pointer-events-none absolute left-[68px] whitespace-nowrap rounded-lg border border-border bg-primary/95 px-3 py-1.5 text-xs text-text opacity-0 shadow-glass backdrop-blur-md transition-opacity group-hover:opacity-100",
          },
          item.label,
        ),
        React.createElement(
          "svg",
          {
            className: `w-6 h-6 transition-colors ${
              isActive ? "text-accent" : "text-border group-hover:text-text"
            }`,
            viewBox: item.viewBox,
          },
          item.path.map((pathStr, index) =>
            React.createElement("path", {
              key: index,
              fill: "currentColor",
              d: pathStr.match(/d="([^"]*)"/)[1],
            }),
          ),
        ),
      );
    }),
  );
};

window.Sidebar = Sidebar;
