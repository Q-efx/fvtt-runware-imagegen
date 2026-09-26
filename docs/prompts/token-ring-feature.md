# Session prompt: Portrait / Token output step with dynamic token rings, custom rings and generated backgrounds

> Paste everything below the line into a new Claude Code session opened in this repository.

---

You are working in the `runware-imagegen` FoundryVTT v13/v14 module. Read `CLAUDE.md` first; it
is authoritative (ApplicationV2/DialogV2 only, `rejectClose: false`, clamp every paid parameter
against `LIMITS`, FilePicker via `ImageFileHandler._getFilePicker()`, no jQuery, no bundler,
manual testing only, never edit `build/`).

Your job is to implement the feature below. **Orchestrate it with subagents** following the
phase plan at the end. You coordinate, define the interfaces, integrate, and review. Subagents do
the research and the file-scoped implementation.

## 1. The feature (user-facing spec)

Today, once an image is generated and picked, a "Set as Actor Image?" DialogV2 offers
*Portrait + Token / Portrait Only / Token Only / No*, and a single "Remove background" checkbox
in the generation form applies to both outputs. Replace that with a proper **"Use this image"**
step that treats portrait and token as two separate outputs, each with its own options.

### 1.1 "Use this image" step (replaces the consent DialogV2)

One ApplicationV2 window (new class, new `.hbs`, styled in `styles/module.css`) with a live
preview on the left and two output cards on the right. It opens after image selection. It does
**not** remove backgrounds or generate anything until the user presses **Apply**.

**Portrait card** (checkbox "Set as portrait", on by default)
- **Background:** `Keep original` (default) | `Generate new background`.
  - `Keep original` saves the image exactly as generated. The old "Remove background" option
    does not apply to the portrait any more.
  - `Generate new background` shows a prompt textarea prefilled from the background template
    (§1.4). On Apply: remove the subject's background, generate the background image, and
    composite subject over background at the portrait's size.

**Token card** (checkbox "Set as token", on by default)
- The subject's background is always removed for the token (transparent subject). If removal
  fails, the step stays open with an error. It does not silently fall back to the original.
- **Ring:** radio group
  - `No ring`: transparent subject only (today's behaviour).
  - `Foundry dynamic ring` (default when the core ring is available): uses the world's active
    dynamic ring. Offers ring colour, background colour, and subject scale fields that map 1:1
    to `prototypeToken.ring.*`. A note explains that the ring style is a world-wide setting
    (`core.dynamicTokenRing`) chosen by the GM.
  - `Custom ring`: a picker listing rings previously generated into this world (thumbnails from
    the rings folder, §1.5) plus a **"Generate new ring…"** tile. Choosing "Generate new ring…"
    shows a prompt textarea prefilled with the ring template (§1.4) and a "Generate ring" button
    with its own preview. The generated ring is background-removed **and** has its centre
    punched out in code, so it is transparent inside and outside the band. The user can
    regenerate before applying. Each generation is a paid call, so the button shows that.
- **Token background:** `Transparent` (default) | `Solid colour` (dynamic ring only, maps to
  `ring.colors.background`) | `Generate background`. The generated background is clipped to the
  ring's inner circle and sits **between the subject and the ring**.

**Footer:** `Apply` (primary) · `Back to images` (if more than one was generated) · `Cancel`.
While Apply runs, controls are disabled and each step is shown ("Removing background…",
"Generating ring…", "Compositing…", "Saving…"). Closing via X or Escape is the same as Cancel,
and nothing is saved before Apply. The existing `handleGeneratedImage()` contract stays the same:
return `false` if the user abandons or anything fails, so the generation dialog stays open with
its prompt.

Before any paid call on Apply, list the paid calls in the Apply button's tooltip or in a
summary line, for example "Apply (2 background removals, 1 background generation)". This
replaces the consent that the old dialog gave.

### 1.2 How each output is built

| Output | Layers (bottom → top) | Token document fields |
| --- | --- | --- |
| Portrait, keep | original | `img` |
| Portrait, new bg | generated bg (cover-fit) → transparent subject | `img` |
| Token, no ring | [bg clipped to circle] → subject | `texture.src`, `ring.enabled=false` |
| Token, dynamic ring | [bg clipped to ring inner circle] → subject, saved as the **subject texture** | `ring.enabled=true`, `ring.subject.texture`, `ring.subject.scale`, `ring.colors.ring/background`; `texture.src` = the same file |
| Token, custom ring | [bg clipped to inner circle] → subject (fitted to the inner ⅔) → ring PNG, **baked into one PNG** | `texture.src`, `ring.enabled=false` |

Apply this to `actor.prototypeToken` for linked actors and to the placed `TokenDocument` for
unlinked (synthetic) token actors, as `applyActorImages()` already does for `texture.src`.

### 1.3 Why custom rings are baked (a research finding; verify it in Phase 0)

Foundry's dynamic ring **style is world-global**. `core.dynamicTokenRing` selects one
`DynamicRingData` spritesheet that every ring-enabled token uses. Rings are registered through
the `initializeDynamicTokenRingConfig` hook with `ringConfig.addConfig(id, new DynamicRingData({label, effects, spritesheet}))`.
The spritesheet is a multi-resolution atlas with a JSON `config` that defines colour bands
(`defaultColorBand.startRadius/endRadius`). That can't give each actor its own ring, and
generating a valid atlas (ring, background and mask frames at several sizes) from one AI image
is fragile. So a per-actor custom ring is **composited into a static token image** with the
dynamic ring turned off. The dynamic ring's background is also only a solid colour, so a
generated background has to be baked into the subject texture.

*Stretch goal, not in scope unless Phase 0 shows it is cheap:* a GM-only "Register as world ring"
action that builds a spritesheet and JSON from a generated ring.

### 1.4 Prompt templates (editable defaults)

Store these as world settings (`ringPromptTemplate`, `ringNegativePromptTemplate`,
`backgroundPromptTemplate`, `backgroundNegativePromptTemplate`). They should be GM-editable in
the settings menu and prefilled into the textareas, where the user can edit them for each use.
Tune these defaults in Phase 0 (research) and Phase 4 (manual test):

- **Ring, positive:** `A single ornate circular token frame, perfectly round ring, centered,
  viewed straight on, flat 2D tabletop RPG token border, {material} with engraved details,
  uniform band thickness, band occupies only the outer sixth of the image, completely empty
  plain center, isolated on a plain solid flat white background, symmetrical, crisp clean edges,
  high detail, no character`
  (`{material}` defaults to "polished steel and gold filigree". Keep the placeholder
  substitution simple.)
- **Ring, negative:** `character, person, face, creature, text, letters, numbers, watermark,
  perspective, tilted, 3d angle, oval, off-center, cropped, cut off, busy background, pattern in
  center, shadow, gradient background`
- **Background, positive:** `{scene}, atmospheric environment backdrop for a character
  portrait, no people, no characters, soft depth of field, even lighting, painterly, centered
  composition` (`{scene}` should be prefilled from the generation prompt when possible, and
  otherwise "misty fantasy forest at dusk".)
- **Background, negative:** `people, person, character, face, figure, text, watermark, frame,
  border`

Generate ring images square (1024×1024 by default, clamped through `LIMITS.dimension`) with the
model and settings currently selected in the generation dialog. Pass these through, don't
re-read the form. Generate backgrounds at the portrait's dimensions, or square for the token.

### 1.5 Files

Everything is written through `ImageFileHandler.saveImage()` numbering. Extend its `type`:

- `images/runware/<slug>_<actorId>/image_N.png`: portrait (unchanged)
- `…/tokens/token_N.png`: final token or subject texture (unchanged)
- `…/backgrounds/background_N.png`: raw generated background (kept so it can be reused)
- `images/runware/rings/ring_N.png`: custom rings are **world-shared**, not per-actor, so the
  "Custom ring" picker can offer every ring anyone has generated

## 2. Technical constraints and gotchas for implementers

- **Compositing** happens in the browser with `OffscreenCanvas`, or a detached
  `<canvas>` as a fallback, and `createImageBitmap`. Output is a PNG base64 in the same shape
  `ImageFileHandler.saveImage()` already accepts (`imageBase64Data`). Load images from data URIs
  or blobs, never from remote URLs without CORS, because a tainted canvas can't export. Prefer
  `outputType: 'base64Data'` on every Runware call, as `removeBackgroundFromImage()` does.
- **Background removal doesn't clear a ring's centre.** The model keeps the "object", and a
  ring's interior often survives. After removal, punch the inner circle with
  `globalCompositeOperation = 'destination-out'`, using a radius set by one constant
  (`RING_INNER_RADIUS`). Match it to the ⅔ rule and the core ring's inner radius from Phase 0.
- **⅔ rule:** subject art fills the inner two thirds and the ring the outer third. Put the
  subject scale, inner-circle radius, and output token size (default 512, power of two) in
  `constants.js` next to `LIMITS`. Don't scatter magic numbers.
- **Costs:** every generation and removal is paid. No call before Apply, except the explicit
  "Generate ring" button. Reuse results: the portrait-with-new-bg path and the token path share
  one subject removal, and one generated background can serve both outputs if the user ticks
  "Use same background for token". Clamp all new numeric params against `LIMITS`.
- **DialogV2 and ApplicationV2 rules from CLAUDE.md** apply to the new window. Actions go through
  `data-action` with handlers in `DEFAULT_OPTIONS.actions`. Build preview images with DOM APIs,
  not HTML strings, from base64. One window per actor: reuse the id pattern from
  `getImageDialogId()`.
- **v13 vs v14 API paths:** access `DynamicRingData`, `TokenRingConfig`, and the ring
  settings defensively (`foundry?.canvas?.placeables?.tokens?.… ?? foundry?.canvas?.tokens?.…`),
  like the rest of the codebase. Detect whether dynamic rings are available and hide that option
  if not.
- `lang/en.json` is unused. Keep hardcoding strings like the rest of the module, or else migrate
  everything, and that is out of scope.
- Run `npx eslint .` and keep it at 0 errors. Run `npm run build` at the end.

## 3. Orchestration: phases and subagents

Use the Agent tool. Run agents in parallel when they don't depend on each other. Give each one
the relevant part of this prompt, CLAUDE.md's rules, and the **exact files it owns**. Parallel
implementers must never edit the same file.

### Phase 0: Research (parallel, read-only, `Explore` or `general-purpose` agents)

1. **Foundry ring internals.** Read the v13 and v14 API docs and, if available, the Foundry
   client source (`resources/app/client/canvas/placeables/tokens/ring*.mjs`,
   `public/canvas/tokens/rings-*.json`). Report:
   - the exact `TokenDocument.ring` schema (`enabled`, `colors.ring`, `colors.background`,
     `effects` bitmask, `subject.texture`, `subject.scale`)
   - whether the subject texture is masked to the inner circle
   - the core ring's inner and outer radius as a fraction of token size
   - the spritesheet JSON format
   - how to read the active ring (`game.settings.get('core','dynamicTokenRing')`)
   - any v13 vs v14 differences in class paths

   Also say whether the "Register as world ring" stretch goal is realistic.
   Sources to start from: <https://foundryvtt.com/article/dynamic-token-rings/>,
   <https://foundryvtt.com/api/v13/classes/foundry.canvas.placeables.tokens.DynamicRingData.html>,
   <https://foundryvtt.com/api/classes/foundry.canvas.placeables.tokens.TokenRingConfig.html>,
   <https://rpgs.wtf/2025/06/22/registering-custom-dynamic-token-rings-in-foundry-vtt/>.
2. **Runware SDK @1.3.2 capabilities.** Check `requestImages` params for square ring generation,
   `removeImageBackground` options (alpha matting, `outputFormat`), and whether an
   inpainting or outpainting call could replace a background in one step more cheaply than
   removing it and then compositing. Report which calls return base64.
3. **Codebase map.** Map `handleGeneratedImage()`, `saveTokenImage()`, `applyActorImages()`,
   `showImageSelectionDialog()`, the `removeBackground` option through `dialog.js` and
   `image-dialog.hbs`, `ImageFileHandler.saveImage()`/`type`, and settings registration. List
   every place the old consent dialog and `removeBackground` checkbox are referenced.

**Checkpoint:** merge the findings. Update §1.2–§1.4 if the research contradicts them, for
example if the dynamic ring doesn't mask the subject. **Ask the user** only about decisions the
research leaves genuinely open. The likely one is whether the generation-form "Remove
background" checkbox is removed or repurposed.

### Phase 1: Design (one `Plan` agent)

Produce the interfaces before any code is written:
- `scripts/image-compositor.js`: pure functions, for example
  `compositeLayers({ size, layers: [{ src, fit, clipCircle }] }) → { imageBase64Data }`,
  `punchCircle(src, radiusFraction)`, `loadBitmap(src)`
- `scripts/asset-generation.js`: `generateRing({ prompt, negativePrompt, modelParams })`,
  `generateBackground({…})`, `removeBackground(imageData)` (moved from `module.js`), and
  template substitution
- `scripts/output-dialog.js` + `templates/output-dialog.hbs`: the "Use this image" window.
  It resolves to a plan object, `{ portrait: {...}|null, token: { ring: 'none'|'dynamic'|'custom', ... }|null }`
- the new `module.js` flow that executes the plan and the extended `applyActorImages()`
  signature with ring data
- new `constants.js` entries and new settings

### Phase 2: Implementation (parallel, one agent per file group; consider `isolation: "worktree"`)

- **Agent A, compositor:** `scripts/image-compositor.js` only.
- **Agent B, generation:** `scripts/asset-generation.js`, plus the `constants.js` additions.
- **Agent C, UI:** `scripts/output-dialog.js`, `templates/output-dialog.hbs`, and the
  `styles/module.css` additions.
- **Agent D, storage and settings:** `scripts/file-handler.js` (new `type`s, the shared rings
  folder, and listing existing rings for the picker) and settings registration for the templates.

After they finish, **you** integrate `module.js` and `dialog.js`, because they touch every
interface: replace the consent dialog, execute the plan, and extend `applyActorImages()`.

### Phase 3: Review (parallel)

- One agent runs `npx eslint .` and `npm run build` and fixes what it finds.
- One agent reviews correctness against §2. It checks for:
  - paid calls before Apply
  - an unhandled DialogV2 rejection
  - canvas taint
  - synthetic-token handling
  - `false` return paths
  - files saved on Cancel
- One agent updates `README.md`, `TECHNICAL.md`, `SETUP.md` (settings), `QUICKSTART.md`,
  `CLAUDE.md` (architecture list and generation flow diagram), and a `CHANGELOG.md` entry.
  Release version bumps are a separate step, so don't bump.

### Phase 4: Manual test checklist (hand this to the user; you can't run Foundry)

Write the checklist into the final message. It should cover:
- every row of the §1.2 table
- a linked actor and an unlinked token
- v13 and v14
- a world with dynamic rings disabled
- Cancel and X at every stage
- background-removal failure
- regenerating a ring
- reusing a previously generated ring
- the ring centre being fully transparent
- a background that stays inside the ring and never bleeds outside it

Don't commit or open a PR unless the user asks.
