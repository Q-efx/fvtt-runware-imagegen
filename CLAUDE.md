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
| `npm run lint` | Runs `eslint .`. |
| `npm test` | **Stub** that just `echo`s. There is no test suite. |
| `npx eslint .` | Clean (0 errors) as of v0.9.0. The flat config declares Foundry's globals and ignores `build/`, so any finding is real - do not ignore it. `no-unused-vars` runs with `args: "none"` because Foundry's callback signatures have fixed parameter lists. |

**Testing is manual, inside Foundry.** Symlink or copy the repo into `Data/modules/runware-imagegen`,
reload the world, open an actor sheet. There is no way to exercise this code outside the Foundry
browser runtime — do not add tests that pretend otherwise without introducing a real harness first.

`build/` is gitignored and untracked; a local copy may exist from a previous build. Never edit
files under `build/` — edit `scripts/` and rebuild.

## Architecture

Everything lives in `scripts/` (~1900 lines total):

- **`constants.js`** — `MODULE_ID` (`runware-imagegen`), `MODULE_NAME`, and `LIMITS` (request
  bounds). Import these everywhere rather than hardcoding the id; template paths are the one
  exception (see below).
- **`module.js`** — entry point named in `module.json`'s `esmodules`. Registers settings and the
  preset menu on `init`, injects the sheet button, and orchestrates the whole post-generation flow:
  image selection → optional background removal → confirm → save → `actor.update()` (or the placed
  token's texture for unlinked token actors). `handleGeneratedImage()` returns `false` when the
  flow was abandoned or failed, and the dialog stays open in that case.
- **`dialog.js`** — `RunwareImageDialog`, the generation form. Owns preset application, clamping
  every numeric parameter to `LIMITS`, and the actual `runware.requestImages()` call. One dialog
  per actor: its id comes from `getImageDialogId(actor)`, and `openImageGenerationDialog()` brings
  an open one to the front instead of creating another.
- **`runware-client.js`** — the single shared SDK client (`getRunwareClient(apiKey)`), used by both
  generation and background removal. It caches the connection promise per key and disconnects the
  old client when the key changes.
- **`runware-connection.js`** / **`runware-errors.js`** — the fast standalone API-key check (works
  around an SDK auth-timeout bug) and normalisation of the SDK's non-`Error` rejections.
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
      → removeBackgroundFromImage() (optional for portrait)
      → "Set as Actor Image?" consent (nothing is saved before this)
      → saveImage() for the portrait / saveTokenImage() (removes background, or reuses the
        already background-free portrait file)
      → applyActorImages()
```

### Where images land

`ImageFileHandler.saveImage()` writes to the Foundry **data** root, not the module folder:

- portrait: `images/runware/<slug>_<actorId>/image_N.png`
- token: `images/runware/<slug>_<actorId>/tokens/token_N.png`

`ImageFileHandler.getActorFolderName()` builds the folder name: a transliterated slug plus the actor
id, so actors with the same name no longer share a folder (before v1.0.0 it was the bare slug).
`N` is `max + 1` over the listing that `_ensureDirectory()` returns, so each save browses once.

`_ensureDirectory()` deliberately does **not** swallow a failed final browse: treating it as an
empty folder would restart at `1` and overwrite an existing `image_1.png`. A `getActorImages()` helper used to live here
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

**The Runware SDK is loaded from a CDN at runtime**, not bundled. The URL lives in one place,
`RUNWARE_SDK_URL` in `runware-client.js`, and is pinned to an **exact** version (`@1.3.2`). A
dynamic `import()` can't carry an SRI hash, so a floating range would run any new or hijacked
upstream release unreviewed. Bump it deliberately, after testing. The `@runware/sdk-js` entry in
`package.json` is a `peerDependency` for documentation only; it is not installed into the shipped
module. Background removal uses model `runware:110@1`.

**Never trust the form's HTML `min`/`max`.** Generate is a `data-action` button, not a submit, so
the browser never validates. Any new numeric request parameter must be clamped in
`_generateImage()` against `LIMITS`, because every request costs money.

## Gotchas

- **Versions must stay in sync.** The release workflow *warns* (it does not fail) when
  `module.json`, `package.json`, or a `## [vX.Y.Z]` CHANGELOG heading don't match the tag. It must
  never fail before assets are attached: a published release without `module.json` still becomes
  "Latest", and the `releases/latest/download/module.json` manifest URL then 404s for every
  install (this happened with v1.0.1). `module.json` is the
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
warns if the versions don't match the tag, substitutes the versioned manifest/download URLs into `module.json`, runs `node build.mjs` (no `npm ci` - see the workflow comments),
zips the **contents of `build/`** as `module.zip` (so `module.json` sits at the archive root —
zipping `build/` itself put the manifest one level down and dropped `styles/`, `templates/`, and
`lang/`, which was the v0.9.0 packaging fix), attaches both to the release, and (for
non-prereleases, if `PACKAGE_TOKEN` is set) publishes to the FoundryVTT package registry.

## Docs

`README.md` (user-facing), `QUICKSTART.md`, `SETUP.md` (install/config), `TECHNICAL.md` (deeper
architecture write-up). All four were brought back in sync with the code in v0.9.0.
