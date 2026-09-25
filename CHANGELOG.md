# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
