# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
