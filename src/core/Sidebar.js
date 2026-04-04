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
    {
      id: "settings",
      label: "Settings",
      path: [
        '<path d="M10.490234 2C10.011234 2 9.6017656 2.3385938 9.5097656 2.8085938L9.1757812 4.5234375C8.3550224 4.8338012 7.5961042 5.2674041 6.9296875 5.8144531L5.2851562 5.2480469C4.8321563 5.0920469 4.33375 5.2793594 4.09375 5.6933594L2.5859375 8.3066406C2.3469375 8.7216406 2.4339219 9.2485 2.7949219 9.5625L4.1132812 10.708984C4.0447181 11.130337 4 11.559284 4 12C4 12.440716 4.0447181 12.869663 4.1132812 13.291016L2.7949219 14.4375C2.4339219 14.7515 2.3469375 15.278359 2.5859375 15.693359L4.09375 18.306641C4.33275 18.721641 4.8321562 18.908906 5.2851562 18.753906L6.9296875 18.1875C7.5958842 18.734206 8.3553934 19.166339 9.1757812 19.476562L9.5097656 21.191406C9.6017656 21.661406 10.011234 22 10.490234 22L13.509766 22C13.988766 22 14.398234 21.661406 14.490234 21.191406L14.824219 19.476562C15.644978 19.166199 16.403896 18.732596 17.070312 18.185547L18.714844 18.751953C19.167844 18.907953 19.66625 18.721641 19.90625 18.306641L21.414062 15.691406C21.653063 15.276406 21.566078 14.7515 21.205078 14.4375L19.886719 13.291016C19.955282 12.869663 20 12.440716 20 12C20 11.559284 19.955282 11.130337 19.886719 10.708984L21.205078 9.5625C21.566078 9.2485 21.653063 8.7216406 21.414062 8.3066406L19.90625 5.6933594C19.66725 5.2783594 19.167844 5.0910937 18.714844 5.2460938L17.070312 5.8125C16.404116 5.2657937 15.644607 4.8336609 14.824219 4.5234375L14.490234 2.8085938C14.398234 2.3385937 13.988766 2 13.509766 2L10.490234 2 z M 12 8C14.209 8 16 9.791 16 12C16 14.209 14.209 16 12 16C9.791 16 8 14.209 8 12C8 9.791 9.791 8 12 8 z"/>',
      ],
      viewBox: "0 0 24 22",
      isExternal: true,
    },
  ];

  return React.createElement(
    "div",
    {
      className:
        "w-[60px] flex min-w-[60px] flex-col items-center border-r border-white/10 bg-primary/80 py-px backdrop-blur-xl fixed z-50 h-full shadow-glass-sm",
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
              "pointer-events-none absolute left-[68px] whitespace-nowrap rounded-lg border border-white/15 bg-primary/95 px-3 py-1.5 text-xs text-text opacity-0 shadow-glass backdrop-blur-md transition-opacity group-hover:opacity-100",
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
