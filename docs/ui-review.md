# Renderer build and UI review

**Status:** completed for this review scope (2026-11-03)

## Renderer build

The renderer HTML files declare JSX/JavaScript inputs with `data-source` and load the generated `src/assets/compiled/` outputs. `scripts/build-renderer.js` reads `src/index.html`, `src/settings.html`, and `src/core/ui/windows/importer.html`; 31 declarations resolve to 25 unique source files. Babel compiles them before launch, so renderer windows do not transform JSX at runtime. The generated directory is ignored by Git and must be built before packaging.

`npm run build:renderer` compiles renderer sources. `npm run build:ui` builds CSS and compiled renderer scripts. `start`, `dev:web`, `dev`, `f95launcher`, `build`, `publish`, `screenshots`, `ci:check`, and `qa:ui` invoke the UI build they need. `npm run dev` starts the renderer watcher as well as CSS, Electron, and the web preview. After the watcher prints `renderer: rebuilt`, reload the window to load the new output.

`@babel/standalone` remains at the same version but is now a `devDependency`; no new library was added. The old `src/assets/vendor/babel/babel.min.js` copy is not loaded by renderer HTML and is excluded from packaged app files. See [the vendored runtime inventory](../src/assets/vendor/README.md).

## Running browser UI QA

Start the web preview, then run the QA script in another terminal:

```powershell
npm run dev:web
npm run qa:ui
```

`dev:web` serves `src/` on port 5173 by default (`DEV_WEB_PORT` can override it). `qa:ui` rebuilds CSS and renderer output, then runs `scripts/verify-ui.js` against the running preview. The script tries optional local `playwright`, then `playwright-core`; neither is a shipped app dependency. It launches headless Chromium using the Chrome channel by default.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `UI_QA_URL` | `http://127.0.0.1:5173` | Preview base URL |
| `UI_QA_OUT_DIR` | `output/playwright/ui-review` | Screenshot and `results.json` output directory |
| `UI_QA_BROWSER` | `chrome` | Chromium channel to launch |

The output directory is ignored by Git. The current result file is `output/playwright/ui-review/results.json`.

## Current browser review

The recorded browser run passed **44/44 checks** with zero failed checks and `errors: []`. The review uses `?demo=1` and web-preview or test-specific mocked IPC responses. It verifies these flows:

- Library, Updates, and Settings at 1600×900, 1024×680, and 900×620; all seven Settings sections.
- Library search/clear, game details and date formatting, metadata editor, screenshot navigation/focus, delete dialog/footer visibility, Downloads keyboard focus, Scan Hub, and rebuild confirmation.
- F95 browser search and a captcha demonstration state; this does not authenticate to F95 or contact a real mirror.
- Catalog search debounce with an out-of-order response; onboarding's manual-folder/detection race and failed settings save; all six onboarding steps.
- Disconnected storage with encryption requested but an empty passphrase, the WebDAV form, four install-dialog states, the empty library, and standalone Settings and Importer windows.

The UI changes covered by this review include:

- Responsive library toolbar and header sizing; title-sidebar and details-panel sizing at narrower widths; a delete dialog with a scrollable body and visible actions; a proportionate, uncropped details banner; human-readable release dates.
- Focus containment for Downloads, onboarding, and the screenshot viewer; Ctrl+F stays in the open dialog; closing dialogs become inert; delayed confirmation autofocus is cancelled after close.
- Catalog results are invalidated immediately when the query changes, including during the debounce delay. Onboarding preserves manually selected folders during discovery and remains open when saving settings fails. Requested storage encryption rejects a blank passphrase instead of silently connecting unencrypted.
- Settings persistence writes the next config before publishing it to in-memory state. Native IPC/readback passed with both the source and the packaged ASAR payload: all three windows became ready, and an injected settings-write failure preserved the previous config.
- Manual S3/Supabase infrastructure forms and the developer-console control were removed from user settings.

## Performance observations

These are ad-hoc elapsed-time samples, not a controlled benchmark:

| Sample | Before (ms) | After (ms) | Limit |
| --- | ---: | ---: | --- |
| Same browser demo, three runs | 5172, 4993, 5350 | 578, 602, 300 | Demo-preview timings; not representative of live F95 or cloud work |
| Native source bootstrap with a separate `userData` profile | 8171 | 1318 | One sample on each side; not a repeatable launch benchmark |

The native bootstrap check created no `src/data` directory.

## Final verification and limits

- Final `npm run ci:check`: CSS/renderer build, lint, JSX, typecheck, and **649/649 tests passed**.
- Windows x64 NSIS installer built with publication disabled: `dist/F95Launcher-Setup 1.9.1.exe`.
- `npm run check:package` validates all **71 local script/style references across three packaged windows**. Added the previously omitted scrollbar/preview scripts; all 25 compiled scripts are packaged and Babel is absent.
- Native source and packaged-ASAR smoke used separate disposable `userData` profiles: main, settings and importer ready, real IPC readback, no renderer exceptions, failed config write left the prior config active, no `src/data` directory created. This loads the packaged payload through the development Electron runtime; it is not an installed-EXE or installer test.
- The 44 browser checks use demo data and mocks. They do not verify live F95 authentication, real mirror hosts, real cloud authentication/sync, installer execution, or every possible UI combination.
