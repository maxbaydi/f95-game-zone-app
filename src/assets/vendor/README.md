# Vendored UI runtime

Every renderer window used to pull React, ReactDOM, Babel, react-virtualized,
Font Awesome and Google Fonts from public CDNs at startup. Without network
access (or with a CDN blocked) the frameless transparent window stayed
invisible and the app looked like it never started. These files are bundled
so the UI always boots offline.

| Path | Package | Version | License |
| --- | --- | --- | --- |
| `react/react.production.min.js` | `react` (UMD) | 18.3.1 | MIT |
| `react-dom/react-dom.production.min.js` | `react-dom` (UMD) | 18.3.1 | MIT |
| `react-virtualized/react-virtualized.js` | `react-virtualized` (UMD) | 9.22.6 | MIT |
| `babel/babel.min.js` | `@babel/standalone` | 7.28.4 | MIT |
| `fontawesome/` | `@fortawesome/fontawesome-free` (css + woff2) | 6.5.1 | Font Awesome Free (OFL/MIT/CC BY 4.0) |
| `material-symbols/` | `@material-symbols/font-400` (outlined) | 0.47.5 | Apache-2.0 |
| `manrope/` | `@fontsource-variable/manrope` (latin + cyrillic) | 5.3.0 | OFL-1.1 |

To refresh a file, `npm pack <package>@<version>`, copy the file listed above
and update this table. `fonts.css` declares the Manrope and Material Symbols
faces used by `main.css` and the Tailwind config.
