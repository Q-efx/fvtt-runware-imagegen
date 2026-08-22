# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A **FoundryVTT v13/v14 module** (`runware-imagegen`) that adds a "Generate Image" button to actor
sheets. The button opens a dialog for generating character/NPC portraits through the
[Runware](https://runware.ai) AI API, saves the results into the Foundry user data directory,
and optionally sets them as the actor portrait and prototype token image.

There is no framework and no bundler. This is plain ES modules loaded directly by Foundry in the
browser, plus Handlebars templates and one CSS file.

## Commands

| Command | What it does |
| --- | --- |
| `npm run build` | Runs `build.mjs`: wipes `build/`, copies `scripts/`, `styles/`, `templates/`, `lang/`, `licenses.md`, `module.json` into it, making `build/` a complete module. No transpiling, no bundling. |
| `npm run lint` / `npm test` | **Stubs** that just `echo`. There is no test suite. |
| `npx eslint .` | Clean (0 errors) as of v0.9.0. The flat config declares Foundry's globals and ignores `build/`, so any finding is real - do not ignore it. `no-unused-vars` runs with `args: "none"` because Foundry's callback signatures have fixed parameter lists. |

**Testing is manual, inside Foundry.** Symlink or copy the repo into `Data/modules/runware-imagegen`,
reload the world, open an actor sheet. There is no way to exercise this code outside the Foundry
browser runtime — do not add tests that pretend otherwise without introducing a real harness first.

`build/` is gitignored and untracked; a local copy may exist from a previous build. Never edit
files under `build/` — edit `scripts/` and rebuild.

## Architecture

Everything lives in `scripts/` (~1500 lines total):

- **`constants.js`** — just `MODULE_ID` (`runware-imagegen`) and `MODULE_NAME`. Import these
  everywhere rather than hardcoding the id; template paths are the one exception (see below).
- **`module.js`** — entry point named in `module.json`'s `esmodules`. Registers settings and the
  preset menu on `init`, injects the sheet button, and orchestrates the whole post-generation flow:
  image selection → optional background removal → save → confirm → `actor.update()`.
- **`dialog.js`** — `RunwareImageDialog`, the generation form. Owns preset application and the
  actual `runware.requestImages()` call.
- **`preset-config.js`** — `RunwarePresetConfig`, the GM-only preset manager registered via
  `game.settings.registerMenu`. Presets are stored in the world setting `generationPresets`.
- **`file-handler.js`** — `ImageFileHandler`, static-only class for base64 → Blob → FilePicker upload,
  recursive directory creation, and filename numbering.

`templates/*.hbs` pair with the two ApplicationV2 classes; `styles/module.css` styles both.

### Generation flow

```
sheet button → openImageGenerationDialog() [module.js]
  → RunwareImageDialog.render() → _onGenerate() → _generateImage() [dialog.js]
    → onImageGenerated callback → handleGeneratedImage() [module.js]
      → showImageSelectionDialog() (only when >1 image)
      → removeBackgroundFromImage() (optional for portrait, always for token)
      → ImageFileHandler.saveImage() ×2 (portrait + token)
      → actor.update({ img, 'prototypeToken.texture.src' })
```

### Where images land

`ImageFileHandler.saveImage()` writes to the Foundry **data** root, not the module folder:

- portrait: `images/runware/<actor_name_slug>/image_N.png`
- token: `images/runware/<actor_name_slug>/tokens/token_N.png`

`N` auto-increments by browsing the directory and taking `max + 1`. The actor slug is
`name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()`.

`_getNextImageNumber()` deliberately does **not** swallow browse failures: returning `1` on an
error would overwrite an existing `image_1.png`. A `getActorImages()` helper used to live here
with a stale path; it was unused and was removed in v0.9.0.

## Foundry conventions to follow

**ApplicationV2, not V1, for new UI.** Both app classes extend
`foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2)`.
Wire buttons by putting `data-action="name"` in the `.hbs` and mapping
`name: ClassName.prototype._onName` in `static DEFAULT_OPTIONS.actions`. Handlers receive
`(event, target)`.

**No ApplicationV1 anywhere.** As of v0.9.0 the two popups in `module.js`
(`showImageSelectionDialog` and the "Set as Actor Image?" prompt) use
`foundry.applications.api.DialogV2`, reached through the `getDialogV2()` helper. There is no
jQuery left in the module - don't reintroduce either. DialogV2 **rejects on dismissal by
default**: both call sites pass `rejectClose: false` and normalise the resulting `null`, and any
new dialog must do the same or an X-click becomes an unhandled rejection.

**Template paths must be literal:** `` `modules/${MODULE_ID}/templates/image-dialog.hbs` ``.
Foundry resolves these against the installed module directory, so the folder name in
`Data/modules/` must be exactly `runware-imagegen`.

**Two button-injection paths, both required.** Systems ship a mix of sheet frameworks:

- `getActorSheetHeaderButtons` — AppV1 and custom sheets (`buttons.unshift(...)`, uses `onclick`)
- `getHeaderControlsApplicationV2` — AppV2 sheets (`controls.unshift(...)`, uses `onClick`)

Both guard with `canUserModifyActor()` (OWNER permission) and a duplicate check. Breaking either one
silently removes the button for a whole class of systems — this was the fix in v0.6.2.

**Access FilePicker through `ImageFileHandler._getFilePicker()`**, never the bare global. v13 moved it
to `foundry.applications.apps.FilePicker.implementation`; the helper falls back to `globalThis.FilePicker`.
The same defensive style (`foundry?.applications?.…` with fallbacks) is used throughout for v13 API surfaces.

**The Runware SDK is loaded from a CDN at runtime**, not bundled:

```js
const { Runware } = await import('https://cdn.jsdelivr.net/npm/@runware/sdk-js@1/+esm');
```

This appears twice — `dialog.js:_generateImage()` and `module.js:getBackgroundRemovalClient()`. The
`@runware/sdk-js` entry in `package.json` is a `peerDependency` for documentation only; it is not
installed into the shipped module. The import is pinned to `@1` (was `@latest`, which let an
upstream release break the module with no commit here) - keep both occurrences in sync. Background removal uses model `runware:110@1` and caches its client keyed
by API key.

## Gotchas

- **Versions can drift out of sync** — as of `v0.9.0`, `module.json`, `package.json`, and the
  CHANGELOG's newest heading are aligned, but nothing enforces that. `module.json` is the
  one Foundry reads; the release workflow overwrites its `manifest`/`download` fields from the git
  tag. Update `module.json`, `package.json`, `CHANGELOG.md`, and the changelog section in
  `README.md` together when releasing; `package.json`'s version is inert for Foundry but keep it
  in sync anyway to avoid confusion.
- **`lang/en.json` is dead weight.** Nothing calls `game.i18n` anywhere — every user-facing string is
  hardcoded in JS and `.hbs`. Its top-level key was corrected to `runware-imagegen` in v0.9.0, but
  the file still has no effect until someone migrates the hardcoded strings.
- **API keys.** Stored in the world setting `apiKey`. Only a GM can edit it, but Foundry ships
  world settings to every client, so **any player can read it from the console** — this is
  documented in `SETUP.md`, don't describe it as GM-only. `.pre-commit-config.yaml` runs
  **gitleaks** — never commit a key, not even in a doc example or a test fixture.
- **Settings are all `scope: 'world'`**, so they are GM-controlled and shared. `generationPresets`
  is `config: false` and edited only through the preset menu; changes fire the custom hook
  `runware-imagegen.presetsUpdated`, which open dialogs listen for.
- **`images/` is gitignored** — generated output must not be committed.

## Releasing

Publishing a GitHub release with tag `vX.Y.Z` triggers `.github/workflows/release.yml`, which
substitutes the versioned manifest/download URLs into `module.json`, runs `npm ci && npm run build`,
zips the **contents of `build/`** as `module.zip` (so `module.json` sits at the archive root —
zipping `build/` itself put the manifest one level down and dropped `styles/`, `templates/`, and
`lang/`, which was the v0.9.0 packaging fix), attaches both to the release, and (for
non-prereleases, if `PACKAGE_TOKEN` is set) publishes to the FoundryVTT package registry.

## Docs

`README.md` (user-facing), `QUICKSTART.md`, `SETUP.md` (install/config), `TECHNICAL.md` (deeper
architecture write-up). All four were brought back in sync with the code in v0.9.0.
