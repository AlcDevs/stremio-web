# Webmods — how they work and how to build one

> Copied here from `stremio-community-v5`'s `utils/webmods/` (source of truth
> stays that repo — this is a reference copy, not wired into this build).

Everything an agent needs to add or change a webmod, without re-deriving it from
the C++ source and a 7 MB minified bundle.

## The one thing to understand first

**The UI is not in this repo.** `stremio.exe` is a WebView2 shell that navigates
to a remote Stremio web build. `src/core/globals.cpp` lists the candidates, tried
in order by `GetFirstReachableUrl()` (`src/utils/helpers.cpp`):

1. `https://stremio.zarg.me/`
2. `https://zaarrg.github.io/stremio-web-shell-fixes/`
3. `https://web.stremio.com/`

Override with `--webui-url=...`. So a UI feature is **never** a source edit — it
is a script injected into someone else's React app. That app is upstream
`stremio-web` (React + a Rust core compiled to wasm), minified with hashed
CSS-module class names.

## Injection pipeline

`SetupWebMods()` in `src/webview/webview.cpp` scans
`<exeDir>/portable_config/webmods` (recursively), sorts, and registers every
`.js` / `.css` file with `AddScriptToExecuteOnDocumentCreated`, so each one runs
on **every document creation** (including iframes) **before** app scripts.
Wrappers are built in `src/utils/helpers.cpp`
(`MakeInjectJsScript` / `MakeInjectCssScript`): the file is base64-embedded,
decoded as UTF-8, and `eval`ed; CSS is appended as a `<style>` tag. Both retry on
a timer until `document.head` exists. Failures are logged, never fatal.

Consequences every webmod must respect:

- Runs **before** React mounts → nothing you need exists yet. Observe, don't
  assume.
- Runs in **every frame** → start with `if (window.top !== window) return;`.
- Runs on **every navigation** → guard the whole install with a global marker
  (`window.__stremioCommunityXInstalled`) so a re-inject is idempotent.
- Non-`.js`/`.css` files are ignored (that is why `liquid-glass-theme-v1.rar`
  sits there harmlessly).

### Files and deployment

- Source of truth: `utils/webmods/*.js`, `*.css`.
- `deploy_quick.bat` copies just the JS/CSS into
  `dist/win-x64/portable_config/webmods` (no C++ rebuild) — the fast iteration
  loop.
- `build/deploy_windows.js` does the same as part of a full deploy
  (`WEBMODS_FOLDER` → `CONFIG_DIR/webmods`), but it copies **recursively**, and
  `SetupWebMods()` scans **recursively** too. So never park a helper, fixture or
  test `.js` in a subfolder of `utils/webmods/` — it would ship and get injected
  into the page. Non-`.js`/`.css` files still get copied (harmlessly); this
  `AGENTS.md` and the theme archives are shipped that way.
- `dist/` is gitignored; `utils/webmods/` is the tracked copy.

Existing webmods: `stream-search.js` (stream filter + quality tabs),
`episode-scroll.js` (reveal the playing episode in the drawer),
`mark-previous-watched.js` (extra episode context-menu option).

## Reading the upstream app

Do this instead of guessing at the DOM:

```bash
curl -s -o index.html https://stremio.zarg.me/
grep -o 'src="[^"]*"' index.html          # -> <hash>/scripts/main.js
curl -s -o main.js https://stremio.zarg.me/<hash>/scripts/main.js
grep -o -b 'CTX_MARK_REST' main.js        # byte offsets, then:
dd if=main.js bs=1 skip=<offset-2000> count=4000 2>/dev/null
```

`grep -o -b` + `dd` is the workflow that matters: the bundle is one enormous
line, so plain `grep -C` is useless and greedy `.\{0,400\}` regexes hang. Search
for i18n keys (`CTX_*`), CSS-module base names, or prop names
(`onMarkSeasonAsWatched`) — they survive minification even though locals are
renamed to `e,t,a,i,o`.

### Class names

Classes are CSS-module hashed: `video-container-abc12`. Match by **class token**,
not substring — `[class*="watched-container"]` also matches
`upcoming-watched-container-x`, which is a different element. Compare per token:
exact match, or base + `-`/`_` + hash. `mark-previous-watched.js` has
`hasClassToken` / `closestByToken` / `childrenByToken` / `findByToken` ready to
copy.

### Talking to the app's own state

`window.services` is set once services start (`services.core`, `.shell`,
`.chromecast`, ...):

- `window.services.core.transport.dispatch(action)` — fire an app action. Copy
  the exact shape from the bundle, e.g.
  `{action:'MetaDetails', args:{action:'MarkVideoAsWatched', args:[{id, released}, true]}}`.
  The namespace differs per surface: `MetaDetails` on the details page,
  `Player` in the player.
- `window.services.core.transport.getState(model)` → Promise of a model state.
  Models: `meta_details`, `player`, `ctx`, `board`, `discover`, `search`,
  `local_search`, `calendar`, `continue_watching_preview`, `streaming_server`,
  `addon_details`, `installed_addons`, `remote_addons`, `data_export`.
- Loadable nesting differs: `meta_details` → `metaItem.content.content.videos`;
  `player` → `metaItem.content.videos`. Probe both.

Driving the core beats simulating clicks: you get real ids, real watched flags,
and the app's own persistence/sync.

### Useful upstream facts (verified, mid-2026 build)

- **Episode rows** (`Video` component) render `video-container`,
  `title-container` (text is `"<episode>. <title>"`, falling back to the video
  **id** when there is no title), `watched-container` for the watched flag, and
  `upcoming-container` for upcoming. The row's DOM id is **not** set — upstream
  destructures `id` and never applies it, so rows must be identified by rendered
  text, not ids.
- **The context menu is a DOM descendant of its row**, not a portal: `Popup`
  renders `renderMenu()` inside the label container and adds an `active` class.
  So `closest(video-container)` from the menu gives you the row, and the row's
  siblings are the visible episode list.
- The episode menu is `context-menu-content` with `context-menu-option-container`
  children. The **stream** menu shares those base names but also has
  `context-menu-title` — use that (plus the `video-container` ancestor) to tell
  them apart.
- `Popup` closes on a window-level `pointerdown`/`mousedown` whose target is
  outside the row, or on Escape. To close it from injected code, dispatch a
  bubbling `pointerdown` on `document.body` — that is the app's own path.
- Injected nodes should be **appended last** inside a React-rendered container;
  React reconciles its own children by index and leaves trailing extras alone.
- Clone a real sibling (`cloneNode(true)`) to inherit exact classes and
  `tabindex`, then set your label and wire `click` + Enter/Space yourself (the
  clone has no React handlers).
- `Button` renders a `div` (an `a` only with `href`), with `tabIndex=0`.
- Season labels come from the localized `SEASON_NUMBER` key; the season selector
  (`seasons-popup-label-container`, both on the details page and in the drawer)
  keeps the **digits** in every locale, and the details route may carry
  `?season=N`. Use those for season identity, not the label words.

## House style for a webmod

Read `episode-scroll.js` first — it is the reference. The conventions:

- IIFE + `'use strict'`, top-frame guard, install-marker guard.
- A header comment stating the bounded design: how many observers/listeners
  exist, and why there is no feedback loop.
- **Exactly one** `MutationObserver` on `document.body`
  (`childList` + `subtree`), debounced through a single replaceable timer. No
  `setInterval`, no recursive `setTimeout` chains.
- Observer callbacks must be **idempotent** — write only when the value actually
  changes, otherwise your own writes retrigger the observer forever.
- Wrap every DOM/`window` access in `try/catch` and bail out quietly; a throwing
  webmod is invisible to users but breaks the feature.
- `console.log('[Name] Webmod loaded vN')` on install, and log the outcome of
  anything destructive.
- ES5-ish, no build step, no imports. Anything you need must come from the page.
- Prefer refusing to act over acting on a guess when identity is ambiguous
  (wrong-season marking is worse than a missing menu item).

## Testing without a build

The C++ shell is irrelevant to webmod logic, so test in jsdom against a replica
of the upstream DOM (hashed classes included) and a fake
`window.services.core.transport`:

```bash
node --check utils/webmods/<name>.js                   # syntax
node utils/webmods-tests/mark-previous-watched.test.js # behavior (needs jsdom)
```

`utils/webmods-tests/mark-previous-watched.test.js` is the pattern: build the
row/menu DOM, `window.eval` the webmod, wait past the debounce, then assert on
the injected DOM and on captured `dispatch` calls. It covers the ugly cases
worth keeping: first episode, partially watched, toggle back, player drawer vs
details page, stream menu untouched, ambiguous season, missing `window.services`,
and an active search filter. jsdom is not a repo dependency — install it
ad hoc (`npm i jsdom`), and prefer a scratchpad dir, since running `npm i`
in a directory without `package.json` writes to the nearest ancestor's
`node_modules`.

After logic passes, verify in the real app: `deploy_quick.bat`, launch
`dist/win-x64/stremio.exe`, and use the WebView2 devtools console
(`[Name] Webmod loaded`) — the injected `console.log`s go there, not to stdout.

## Rebuild triggers

Upstream is a moving target. If a webmod silently stops working, re-download
`main.js` and re-check the base class names and action shapes before touching
the logic — CSS-module hashes change every build (that is why nothing matches on
the hash), and component structure can change too.
