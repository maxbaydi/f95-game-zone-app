# Vendored UI runtime

Renderer windows load their runtime libraries, fonts and icons from this
directory instead of public CDNs, so the UI can start without network access.
React component scripts are compiled before Electron opens a window; Babel is
no longer part of the renderer runtime.

| Path | Package | Version | License |
| --- | --- | --- | --- |
| `react/react.production.min.js` | `react` (UMD) | 18.3.1 | MIT |
| `react-dom/react-dom.production.min.js` | `react-dom` (UMD) | 18.3.1 | MIT |
| `react-virtualized/react-virtualized.js` | `react-virtualized` (UMD) | 9.22.6 | MIT |
| `fontawesome/` | `@fortawesome/fontawesome-free` (css + woff2) | 6.5.1 | Font Awesome Free (OFL/MIT/CC BY 4.0) |
| `material-symbols/` | `@material-symbols/font-400` (outlined) | 0.47.5 | Apache-2.0 |
| `manrope/` | `@fontsource-variable/manrope` (latin + cyrillic) | 5.3.0 | OFL-1.1 |

## Renderer compilation

`@babel/standalone` 7.28.4 is a build-time `devDependency`. The renderer build
uses it to compile the JSX/JavaScript scripts declared with `data-source` in
the three renderer HTML files into ignored `src/assets/compiled/` outputs.
The old `babel/babel.min.js` source copy remains in this directory, but the
renderer HTML does not load it and the packaged application excludes it. The
compiler version was not upgraded as part of this change.

To refresh a runtime vendor file, `npm pack <package>@<version>`, copy the file
listed above and update this table. `fonts.css` declares the Manrope and
Material Symbols faces used by `main.css` and the Tailwind config.
