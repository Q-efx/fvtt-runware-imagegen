# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v1.2.0]

### Added

- **Ring overlap**: with "Keep the character inside the ring" and a dynamic or custom ring, **Paint
  overlap** in the token card lets you paint the parts of the character that should pass over the
  ring (a weapon arm, a wing) while everything else stays inside it. The token preview grows while
  painting and has a brush, an eraser, a brush size, Undo (also Ctrl+Z) and Clear; leave paint mode
  to move or zoom again. The painted area moves and zooms with the character and is shown over the
  ring in the preview. It is applied locally when the token is built on Apply (no Runware call);
  with nothing painted the token is built exactly as before.

## [v1.1.0]

### Added

- **"Use this image" window**: after picking an image, portrait and token are configured as two
  separate outputs with a live preview. Nothing is saved until **Apply**, and nothing is removed or
  generated before it except through the window's labelled paid buttons (Generate ring, Preview
  background). The Apply label lists the paid calls it will make (e.g. "Apply (1 background
  removal, 1 background generation)"). **Back to images** returns to the picker; Cancel or closing the window keeps the
  generation dialog open with its prompt.
- **Portrait background**: Keep original, Remove background, or **Generate new background** (the
  subject is cut out and composited over a newly generated background).
- **Token rings**: the token always gets a transparent subject, with a choice of
  - **No ring**;
  - **Foundry dynamic ring** (default when the system provides one): ring colour, background colour
    and subject scale are written to `prototypeToken.ring.*`. The ring style itself stays the GM's
    world-wide `core.dynamicTokenRing` setting;
  - **Custom ring**: pick a ring previously generated in this world, or generate a new one (paid: one
    image plus one background removal). Its centre is cut out in code, and it is baked into a
    static token image with the dynamic ring turned off, because dynamic ring styles are world-wide.
- **Token framing**: drag the character in the token preview to move it and use the mouse wheel to
  zoom around the cursor; double-click or the reset button re-centres it. The framing is baked into
  the token image on Apply (free, no extra Runware call).
- **Keep the character inside the ring** (default on, dynamic and custom rings): the character is
  clipped just under the ring's band. Foundry's dynamic ring does not mask the token image, so
  before this the character was drawn past the ring onto the map. Untick it for a break-out look.
- **Model for rings & backgrounds**: the "Use this image" window can generate its rings and
  backgrounds with one of the world's generation presets (model, LoRA, VAE, embeddings, steps, CFG
  scale) instead of the generation's own settings. A preset's LoRA trigger word is not added to the
  prompts automatically. GMs can open the preset manager from the window, and preset changes show
  up in an open window without losing its edits. A background is only reused from the cache for the
  same model settings.
- **Background preview**: a paid, labelled **Preview background** button under the portrait's and
  the token's background prompt generates the background in the window (one image, plus the
  subject's background removal if it hasn't been done yet, which Apply needs anyway). The preview
  shows the cut-out character on the new background, and Apply reuses both instead of paying again;
  **Regenerate background** replaces it. After a prompt or model edit the last preview stays,
  dimmed and marked "outdated", and Apply generates a new background. Previewed backgrounds are
  only saved on Apply: **Back to images** keeps them, Cancel discards them.
- **Presets: steps and CFG scale**: GMs can set inference steps and CFG scale per preset (optional,
  clamped to the request limits). Applying a preset without them clears both fields, so the model's
  defaults are used instead of the previous preset's values.
- **Token background**: transparent (the ring's default under a dynamic ring), a solid colour
  (dynamic ring only), or a generated background clipped inside the ring. It can reuse the
  portrait's generated background instead of paying for a second one.
- **Settings**: `backgroundRemovalModel`, and editable prompt templates for rings and backgrounds
  (`ringPromptTemplate`, `ringNegativePromptTemplate`, `backgroundPromptTemplate`,
  `backgroundNegativePromptTemplate`) with `{material}`, `{scene}` and `{prompt}` placeholders.
  Clearing a field restores its default.
- New files: `…/backgrounds/background_N.png` per actor, and world-shared rings in
  `images/runware/rings/ring_N.png`.

### Changed

- **Images are saved as WebP** instead of PNG (portraits, tokens, backgrounds and rings), which
  makes them several times smaller. Runware now returns WebP and the in-browser compositing encodes
  WebP; transparency is kept. Existing PNGs are untouched and numbering continues after them.
- **Background removal model**: `runware:110@1` was shut down by Runware on 2026-06-30. The default
  is now `bria:2@1` (Bria RMBG 2.0); `runware:109@1` (RemBG 1.4) is far cheaper but rougher.
- The **"Set as Actor Image?"** prompt is replaced by the new window, and the generation form's
  "Remove Background" checkbox now only preselects "Remove background" for the portrait. Background
  removal no longer runs before you decide how the image is used.
- Choosing **No ring** or a custom ring switches the token's dynamic ring off.
- Paid results (subject cut-out, backgrounds, a generated ring) are kept until the flow ends, so
  pressing Apply again after a failure, or going back to the images and picking again, doesn't pay
  for them twice or upload duplicate files.
- Settings registration moved from `module.js` to `scripts/settings.js`.
- Escape no longer closes the generation dialog while a generation or the "Use this image" step is
  in progress, so cancelling the output step keeps the prompt (the X button still closes it).

### Fixed

- **Generated images never arrived in Foundry** although Runware created (and billed) them.
  Runware never delivers a result whose image is sent inline as base64 once it is large: a
  1344x2048 PNG (about 11 MB of base64) was generated but never arrived, while 512x512 did.
  Generated images, rings, backgrounds and background removals are now returned as a link and
  downloaded from Runware's image server. Results are also awaited for up to 5 minutes instead
  of 60 seconds, a task is never re-sent automatically (the SDK used to pay again and drop the
  first result), and a timeout is reported with a readable message.

## [v1.0.1]

### Fixed

- **Release workflow**: a tag whose files didn't match its version (e.g. a release created from
  the GitHub UI without bumping `module.json`) failed the new version check. That left a published
  release with no `module.json`/`module.zip`, which GitHub still marked "Latest", so the
  `releases/latest/download/module.json` manifest URL returned 404 for every install and update.
  A version mismatch is now a warning; `module.json`'s version is still taken from the tag.

## [v1.0.0]

### Fixed

- **Embeddings with standard model ids were broken**: `civitai:12345@67890` was split at its first
  colon and sent to Runware as model `civitai`. Presets hit the same bug, since they save embeddings
  in that format. Only a `:<number>` after the `@version` is now treated as a weight.
- **Unbounded paid requests**: image count, width/height, steps, CFG scale and LoRA/embedding
  weights are clamped in code before every request (the HTML `min`/`max` never applied, because
  Generate doesn't submit the form). Width/height snap to multiples of 64, and an invalid or
  oversized seed is rejected instead of being silently rounded to a different one.
- **LoRA weight 0 was sent as 1** (`parseFloat(x) || 1.0`).
- **Portrait saved before consent**: answering "No" or "Token Only" still left an `image_N.png` on
  disk. Images are now saved only after the choice.
- **Generated images lost on cancel**: cancelling the image picker, or a failed save or actor
  update, closed the dialog and discarded the prompt. The dialog now stays open.
- **Two dialogs shared one id**: opening the dialog for a second actor could replace the first
  actor's dialog mid-generation. Dialogs are now per actor, and reopening brings the existing one to
  the front. The preset manager is reused instead of stacked. Form element ids are scoped per
  dialog.
- **Actors with the same name overwrote each other's images**: folders are now
  `images/runware/<name>_<actor id>/`, and accented names are transliterated instead of collapsing
  to underscores. Existing images stay where they are.
- **Unlinked token actors**: the token image is now applied to the placed token instead of the
  synthetic actor's (meaningless) prototype token.
- **Missing permission checks before paying**: locked compendium actors and users without
  "Use File Browser" permission (saving needs it) are now stopped before the request.
- **Background removal returning no image** silently saved the original as if removal had worked.
- **Token save failures** were silent when background removal was enabled.
- **The advanced-options panel collapsed** on every re-render (spinner, failure, preset update).
- **Release workflow**: the Foundry package-registry publish step was always skipped (its `if:`
  read an env var only defined on that same step).

### Changed

- **One shared Runware connection** (`scripts/runware-client.js`) for generation and background
  removal, instead of one websocket per dialog that was never closed. It disconnects the old client
  when the API key changes, and the key is read at generation time, so a fixed key takes effect
  without reopening the dialog.
- **Runware SDK pinned to exactly `1.3.2`** instead of `@1`: a runtime `import()` can't be checked
  with SRI, so a floating range would run any future (or hijacked) release unreviewed.
- **Release workflow hardened**: actions pinned to commit SHAs, `persist-credentials: false`, no
  `npm ci` in the release job (the build uses only Node built-ins), least-privilege permissions, a
  random changelog delimiter, removal of an unused step that interpolated the module title into
  shell, and a check that fails the release if `package.json`, `module.json` and `CHANGELOG.md`
  don't match the tag.
- The presets hook now follows the ApplicationV2 lifecycle (`_onFirstRender` / `_onClose`), and
  `render(true/false)` calls use the AppV2 option form.
- The width/height settings now have a range; `module.json` has its `url`; `npm run lint` runs
  ESLint.
- Faster base64 decoding, one directory listing per save instead of two, anchored and
  case-insensitive file numbering, and debug logging moved to `console.debug`.

### Docs

- The install folder must be named `runware-imagegen`; SETUP, QUICKSTART and TECHNICAL said
  `runware-image-generator`, which produced a broken install.
- README no longer calls the API key "stored securely" or says the token is generated
  automatically.

## [v0.9.0]

### Added

- **API key validation**: saving the Runware API key now verifies it immediately and notifies the
  GM whether it's valid, instead of only being discovered on the next generation attempt.

### Fixed

- **Unhelpful errors on generation failure**: the Runware SDK doesn't always reject with a real
  `Error` (an invalid API key rejects with the server's raw `{ errors: [...] }` payload), so
  failures previously surfaced as "Image generation failed - undefined". Errors are now normalised
  into a readable message, and an invalid API key gets a specific, actionable notification. The
  same normalisation applies to background-removal failures.
- **Invalid API key took up to a minute to report**: `@runware/sdk-js@1.3.2`'s own connection-failure
  detection fails to match the server's auth-error payload (its `taskUUID` is the literal string
  `"N/A"`, which never matches the pending `"authentication"` listener), so it fell through to a
  hardcoded ~60s connection timeout instead of failing fast. Key validation, image generation, and
  background removal now run a lightweight standalone check first and report an invalid key within
  seconds.
- **Release packaging**: `module.zip` previously placed `module.json` and `scripts/` under a
  `build/` directory while `styles/`, `templates/`, and `lang/` sat beside it, so no single
  directory in the archive was a complete module. Foundry treats the directory holding
  `module.json` as the package root, so installing from a release produced a module with no
  templates and no stylesheet - both dialogs failed to render. `build.mjs` now assembles the
  full module and the workflow zips its contents.
- **Preset manager discarded unsaved edits**: adding or removing a preset or an embedding
  re-rendered from stale in-memory state, wiping every unsaved field in every row.
- **Generation dialog wiped the prompt**: the re-render that shows the progress spinner reset
  every field, so a failed generation destroyed whatever the user had typed. Form values now
  survive re-renders.
- **Prototype token was replaced without consent**: the confirmation dialog asked only about
  the portrait but always overwrote the token, and declining still paid for a background-removal
  API call. It now offers portrait, token, both, or neither.
- **Wasted API calls**: generation is blocked up front when the user lacks Foundry's
  `FILES_UPLOAD` permission, instead of failing after a paid request.
- **Silent overwrites**: a failed directory listing no longer falls back to `image_1.png`,
  which could overwrite a previously generated image.
- **Nested `<form>` elements**: both dialogs declared `tag: 'form'` and also opened a `<form>`
  in their template, so the root form owned no controls and `FormData` returned nothing.
- Preset weights left blank saved as `0` (silently disabling a LoRA) instead of defaulting to `1`.
- Applying a preset from the dropdown fired twice, duplicating its notification.
- `_ensureDirectory` threw a `TypeError` when an error carried no `message`, turning a benign
  "already exists" race into a hard failure.
- Corrected Runware SDK response field names (`imageURL`, not `img`/`url`).

### Changed

- **Replaced the last ApplicationV1 code with `DialogV2`**: the image picker and the confirmation
  prompt no longer use the deprecated `Dialog` class or jQuery. Both now build their content with
  DOM APIs rather than interpolated HTML strings.
- **Pinned the Runware SDK CDN import** from `@latest` to `@1`, so a future 2.x cannot break the
  module without a commit here. Behaviour is unchanged today.
- The advanced-options toggle is a real `<button>`, so it can be operated from the keyboard.
- `engines.foundryvtt` now matches `module.json`'s v13-v14 compatibility range.

### Removed

- `getActorImages()`, which was unused and pointed at a path nothing writes to.

### Developer

- ESLint now declares Foundry's globals and ignores `build/`, taking the lint output from 172
  errors (almost entirely noise, which contributors were told to ignore) to 0. Real findings
  are now visible.
- `lang/en.json`'s top-level key matches `MODULE_ID`. Nothing reads this file yet; every
  user-facing string is still hardcoded.

## [v0.8.1]

### Changed

- Verified compatibility with FoundryVTT V14 (tested against build 14.367); bumped
  `compatibility.maximum` to `14` and `compatibility.verified` to `14.367` in `module.json`.
  `compatibility.minimum` stays at `13` — no V13-breaking changes were needed.

No source changes were required: the module already avoided every API removed in V14
(`ApplicationV2#bringToTop`, the `colorPicker`/`select` Handlebars helpers, and the `nameAttr`
option of `selectOptions`), and both actor sheet header-button hooks
(`getActorSheetHeaderButtons` for AppV1 sheets, `getHeaderControlsApplicationV2` for AppV2 sheets)
remain supported in V14.

## [v0.8.0]

### Security

- Bumped `js-yaml` to 4.3.1, fixing quadratic-CPU-consumption DoS in `!!omap` resolution ([GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj)).
- Bumped `ajv` to 6.15.0, fixing a ReDoS in the `$data` option ([GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6)).
- Bumped `brace-expansion` to 1.1.18, fixing unbounded-expansion/array DoS issues ([GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg), [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895)).
- Bumped `yaml` to 2.9.0, fixing a stack-overflow DoS on deeply nested collections ([GHSA-48c2-rrv3-qjmp](https://github.com/advisories/GHSA-48c2-rrv3-qjmp)).
- Added an `overrides` entry pinning `uuid` to `^11.1.1`, fixing a missing buffer bounds check ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)) pulled in transitively via the `@runware/sdk-js` peer dependency.

All of the above are development/tooling dependencies only; none are shipped in the built module, since the Runware SDK is loaded from a CDN at runtime rather than bundled.

## [v0.7.0]

### Changed

- Routine dependency maintenance: bumped `minimatch`, `flatted`, `picomatch`, and `ws` (dev dependencies).

## [v0.6.2]

### Fixed

Rendering of button in old appv1 systems or custom actor sheets

## [v0.6.0]

### Added

- Optional background removal.
- Width and height settings for image generation.

### Fixed

- Path problem in file handler.
- Filepicker warning.

### Changed

- Updated CSS styles.
- Updated dropdown menus.

## [v0.5.0]

### Changed

- API updates for application framework compatibility.
- Replaced outdated select with `selectOptions`.
- Changed text color to black.
- Bumped `js-yaml` dependency.

## [v0.1.0]

### Added

- preset management to configure VAE, LoRAs, etc. and save them as presets.

## [v0.0.8]

### Added

 - Images are created and then the background is removed

## [v0.0.7]

### Added

-  Enabled and added multiple image selection

## [v0.0.6]

### Fixed

- Fixed dialog and button issues
