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

Everything lives in `scripts/` (~4100 lines total):

- **`constants.js`** — `MODULE_ID` (`runware-imagegen`), `MODULE_NAME`, `LIMITS` (request
  bounds), the token geometry (`TOKEN_SIZE`, `RING_INNER_RADIUS`, `CUSTOM_RING_SUBJECT_SCALE`,
  `CUSTOM_RING_BACKGROUND_OVERLAP`, `RING_GENERATION_SIZE`), `RINGS_DIRECTORY`, and the `DEFAULT_*`
  removal model and prompt templates. Import these everywhere rather than hardcoding the id or a
  magic number; template paths are the one exception (see below).
- **`settings.js`** — `registerSettings()`, called from `init`: every world setting plus the preset
  menu. `module.js` passes in the API-key `onChange` handler.
- **`module.js`** — entry point named in `module.json`'s `esmodules`. Injects the sheet button and
  orchestrates the post-generation flow: image selection → `RunwareOutputDialog` →
  `executeOutputPlan()` (removal, backgrounds, compositing, saving) → `applyActorImages()` (the
  prototype token, or the placed token for unlinked token actors). `handleGeneratedImage()` returns
  `false` when the flow was abandoned or failed, and the dialog stays open in that case.
- **`output-dialog.js`** — `RunwareOutputDialog`, the "Use this image" window (portrait and token
  cards). It only builds an `OutputPlan`; `module.js` does the work through its `onApply` callback.
  It renders **once** - every later change is DOM work, because a re-render would wipe edits and
  previews. Its "Model for rings & backgrounds" select (`assetPreset`) picks a generation preset or
  "Same as generation"; `_currentModelParams()` reads it at request time (ring generation and
  `plan.modelParams`), and the `presetsUpdated` hook rebuilds its options in the DOM. A removed or
  changed selected preset is warned about, never silently swapped for another model; a selection
  that no longer exists, or no model at all, is a `_modelError()` that blocks Apply and both paid
  buttons before anything is paid. Its `assetCache` comes from `handleGeneratedImage()` (one per picked image, rings and
  backgrounds shared between them), so retried Applies and "Back to images" never pay twice and
  final images are saved once per identical plan and background (`saveOutputOnce()`; the key
  includes the background's request key and saved path). Its two paid buttons, "Generate ring"
  and "Preview background" (portrait / token), fill that same cache: a previewed subject and
  background are exactly the entries Apply reads, so Apply doesn't pay for them again. "Regenerate
  background" `set`s a **new** entry object (never mutate a shared one); `getAssetCache()` lets the
  last window's entries win when another image is picked. Once cached, the removed subject and
  backgrounds are shown in the preview (data URIs cached per entry in a `WeakMap`, `src` only set
  on change); after a prompt/model edit the last background stays, dimmed as `data-stale`.
  `_isWorking()` (`_busy` = Apply, `_assetTask` = `'ring'`/`'background'`) blocks close, Back,
  Apply, framing and the other paid button.
- **`asset-generation.js`** — the paid calls behind that window: `removeBackground()`,
  `generateRing()`, `generateBackground()`, plus prompt templating (`fillTemplate()`),
  `presetToModelParams()` / `listPresets()` / `loadPresets()` (the last tells a failed settings
  read from "no presets"), `hasImageModel()` (a free pre-check), and `summarizePaidCalls()` for the
  Apply label (if it throws, the label says the paid calls could not be estimated).
  `getBackgroundRequest(plan, 'portrait'|'token')` is the **only** place a background's request and
  cache key are computed (the key includes the clamped model settings, so a preset switch never
  reuses another model's background); the pricing, the dialog and `executeOutputPlan()` all go
  through it. Never notifies; callers report its errors.
- **`image-compositor.js`** — pure canvas code (no Foundry/Runware imports): `compositeLayers()`,
  `punchCircle()`, `loadBitmap()`. Only same-origin or data sources, so the canvas never taints.
- **`token-ring.js`** — `getDynamicRingInfo()` (is a core dynamic ring available, and its label),
  colour parsing and `subject.scale` clamping.
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
  recursive directory creation, filename numbering, and `listRings()` for the custom-ring picker.

`templates/*.hbs` pair with the three ApplicationV2 classes; `styles/module.css` styles all of them.

### Generation flow

```
sheet button → openImageGenerationDialog() [module.js]
  → RunwareImageDialog.render() → _onGenerate() → _generateImage() [dialog.js]
    → onImageGenerated(images, { removeBackground, prompt, modelParams, portraitSize })
      (modelParams: the default for rings/backgrounds; the output window may pick a preset instead)
    → handleGeneratedImage() [module.js]
      → showImageSelectionDialog() (only when >1 image)
      → RunwareOutputDialog.wait() [output-dialog.js] → 'applied' | 'back' (re-pick) | 'cancelled'
          "Generate ring" / "Preview background" buttons: the only paid calls before Apply
            (removal + background into the same assetCache entries Apply reuses, saved on Apply)
        → Apply → executeOutputPlan() [module.js]  (plan.modelParams = the window's model choice)
          → removeBackground() once for every output that needs the subject (cached)
          → generateBackground() per getBackgroundRequest(): portrait / token, or one shared (cached)
          → compositeLayers() [image-compositor.js]
          → saveImage(): ring, backgrounds, portrait, token
          → applyActorImages()
```

A throw from `executeOutputPlan()` keeps the output window open with the error; the window, not the
executor, notifies. The Apply label lists the paid calls still to make (`summarizePaidCalls()`),
which replaces the old "Set as Actor Image?" consent prompt. The generation form's "Remove
Background" checkbox only preselects "Remove background" for the portrait. Generated rings and
previewed backgrounds (and the removed subject) are only saved on Apply: "Back to images" keeps
them in the cache, but Cancel or closing the window discards those paid results.

### Token rings

- **Dynamic ring**: the token file is set as both `texture.src` and `ring.subject.texture`, plus
  `ring.enabled`, `ring.subject.scale`, `ring.colors.ring/background`. The ring **style** is the
  world-wide `core.dynamicTokenRing` GM setting; the option is hidden when `CONFIG.Token.ring` has
  no spritesheet. The core ring does **not** mask the subject, so a baked-in background is clipped
  to `RING_INNER_RADIUS / subjectScale` or it would cover the ring.
- **Custom ring**: generated, background-removed, centre punched (`punchCircle`), then **baked**
  into a static `TOKEN_SIZE` WebP with `ring.enabled = false`. Registering it as a world ring was
  rejected: ring styles are world-global and registration only happens at startup, needing a reload.
- No ring / custom ring set `ring.enabled = false`, so "No ring" switches off an existing ring.
- The world setting `core.prototypeTokenOverrides` can force ring settings per actor type and beats
  our update. Documented in the dialog; don't fight it.

### Where images land

`ImageFileHandler.saveImage(actor, imageData, { type })` writes to the Foundry **data** root, not
the module folder:

- `avatar` (portrait): `images/runware/<slug>_<actorId>/image_N.webp`
- `token`: `images/runware/<slug>_<actorId>/tokens/token_N.webp` (or the dynamic ring's subject texture)
- `background`: `images/runware/<slug>_<actorId>/backgrounds/background_N.webp` (raw, kept for reuse)
- `ring`: `images/runware/rings/ring_N.webp` — world-shared, `actor` is ignored; every actor's picker
  lists them

A transparent token with a "Remove background" portrait reuses the portrait file instead of
uploading a duplicate.

**Everything is saved as WebP.** Runware returns WebP (`outputFormat: 'WEBP'` in
`RUNWARE_OUTPUT_PARAMS`), the compositor encodes WebP (quality 0.92, alpha lossless), and
`saveImage()` re-encodes anything else through `convertToWebp()`. The extension comes from the
bytes (`detectImageMimeType()`), never assumed: a browser without a WebP encoder falls back to PNG
and that file is saved as `.png`. Numbering counts `.webp`, `.png` and `.jpg`, so pre-WebP PNGs
aren't overwritten or restarted from 1.

`ImageFileHandler.getActorFolderName()` builds the folder name: a transliterated slug plus the actor
id, so actors with the same name no longer share a folder (before v1.0.0 it was the bare slug).
`N` is `max + 1` over the listing that `_ensureDirectory()` returns, so each save browses once.

`_ensureDirectory()` deliberately does **not** swallow a failed final browse: treating it as an
empty folder would restart at `1` and overwrite an existing `image_1.webp`. A `getActorImages()` helper used to live here
with a stale path; it was unused and was removed in v0.9.0.

## Foundry conventions to follow

**ApplicationV2, not V1, for new UI.** All three app classes extend
`foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2)`.
Wire buttons by putting `data-action="name"` in the `.hbs` and mapping
`name: ClassName.prototype._onName` in `static DEFAULT_OPTIONS.actions`. Handlers receive
`(event, target)`.

**No ApplicationV1 anywhere.** The image picker in `module.js` (`showImageSelectionDialog`) uses
`foundry.applications.api.DialogV2`, reached through the `getDialogV2()` helper. There is no
jQuery left in the module - don't reintroduce either. DialogV2 **rejects on dismissal by
default**: the call site passes `rejectClose: false` and normalises the resulting `null`, and any
new dialog must do the same or an X-click becomes an unhandled rejection. `RunwareOutputDialog.wait()`
resolves instead of rejecting, and blocks `close()` while Apply or a ring generation runs.

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
module. `Runware.initialize()` gets `timeoutDuration: RUNWARE_RESULT_TIMEOUT_MS` (5 min) and
`globalMaxRetries: 1`: with the SDK defaults (60 s, 2 attempts) a slow generation timed out, was
re-sent and billed again, and its result never reached Foundry. Don't drop either option.
**Never request `outputType: 'base64Data'` (or `dataURI`).** Runware silently never delivers a
websocket result with a large inline image - a 1344x2048 PNG (~11 MB of base64) produced no
result and no error frame, while the same request as `URL` answered in seconds. Every image task
spreads `RUNWARE_OUTPUT_PARAMS` (`outputType: 'URL'`) and passes its result through
`downloadRunwareImage()` (`runware-client.js`), which fetches only `https://*.runware.ai` (the CDN
sends `Access-Control-Allow-Origin: *`) and adds `imageBase64Data`, the shape everything
downstream uses.
Background removal uses the model in the `backgroundRemovalModel` world setting
(`getBackgroundRemovalModel()`, default `bria:2@1`). The old `runware:110@1` was shut down by
Runware on 2026-06-30.

**Never trust the form's HTML `min`/`max`.** Generate is a `data-action` button, not a submit, so
the browser never validates. Any new numeric request parameter must be clamped in
`_generateImage()` against `LIMITS`, because every request costs money. Ring and background
requests inherit the clamped `modelParams` and re-clamp them in `asset-generation.js`, with sizes
through `clampDimension()`.

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
- **`lang/en.json` is dead weight.** Every user-facing string is hardcoded in JS and `.hbs`; the
  only `game.i18n` call localizes Foundry's own core ring label in `token-ring.js`. Its top-level key was corrected to `runware-imagegen` in v0.9.0, but
  the file still has no effect until someone migrates the hardcoded strings.
- **API keys.** Stored in the world setting `apiKey`. Only a GM can edit it, but Foundry ships
  world settings to every client, so **any player can read it from the console** — this is
  documented in `SETUP.md`, don't describe it as GM-only. `.pre-commit-config.yaml` runs
  **gitleaks** — never commit a key, not even in a doc example or a test fixture.
- **Settings are all `scope: 'world'`**, registered in `settings.js`, so they are GM-controlled and
  shared. `backgroundRemovalModel` and the four prompt templates (`ringPromptTemplate`,
  `ringNegativePromptTemplate`, `backgroundPromptTemplate`, `backgroundNegativePromptTemplate`;
  placeholders `{material}`, `{scene}`, `{prompt}`) fall back to their `DEFAULT_*` constant when
  blank. `{scene}` is deliberately a neutral default, not the character prompt, which would paint
  the character into its own background. `generationPresets`
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
