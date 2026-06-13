# Agent Guide

## Project shape

- This is a Manifest V2 browser extension for Netflix subtitle translation.
- Content scripts are loaded in the order listed in `manifest.json`; keep dependencies compatible with that order.
- The extension uses plain JavaScript, HTML, and CSS without a bundler or package build step.
- Runtime state and options are stored with Chrome extension APIs, mainly `chrome.storage.sync` and `chrome.storage.local`.
- Subtitle persistence uses sql.js assets under `vendor/sqljs/`; keep `vendor/sqljs/sql-wasm.wasm` listed in `web_accessible_resources` if touching DB loading.

## Working guidelines

- Prefer small, direct changes over broad refactors.
- Preserve the existing global namespace pattern: modules attach APIs to `window.NST`.
- Keep content-script files syntax-compatible with the extension runtime; avoid introducing module syntax unless the manifest/loading model is changed too.
- When adding a user-facing option, wire it through all relevant places: popup/options UI, storage defaults, `src/content/config.js`, and the consuming content module.
- When changing panel or subtitle behavior, check interactions with scrolling, focus, fullscreen, and persisted panel state.
- Do not add external dependencies unless the task explicitly requires it.

## Validation

- Run `node --check` on changed JavaScript files.
- For UI or Netflix behavior changes, manually load/reload the extension in the browser and test on a Netflix watch page when possible.
- For popup changes, verify stored settings update immediately and still work after a page reload.
- For subtitle-panel changes, test normal playback, timestamp seeking, fullscreen enter/leave, and toggling the panel.

## Release notes and TODO workflow

- Update `manifest.json` version when shipping extension behavior changes.
- `README.org` is used as the running task log. When completing a TODO, mark it `DONE` and add a short factual summary under the heading.
- Keep summaries permanent and concise: files touched, behavior changed, and any caveats.

## Git hygiene

- Check `git status` and `git diff` before committing.
- Stage specific files only; do not include local Claude settings or unrelated generated files.
- Do not push unless the user explicitly asks.
