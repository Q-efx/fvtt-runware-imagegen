# Runware Image Generator Module - Technical Overview

## Module Architecture

This FoundryVTT module integrates Runware AI image generation directly into actor sheets. Here's how it all works together:

### Core Components

#### 1. Module Manifest (`module.json`)
- Defines module metadata and compatibility
- Specifies dependencies (scripts, styles, languages)
- Compatible with FoundryVTT v13+

#### 2. Main Module File (`scripts/module.js`)
- **Initialization**: Calls `registerSettings()` (see `scripts/settings.js`) during the `init` hook
- **Hook Integration**: Adds the button to actor sheets via *two* hooks -
  `getActorSheetHeaderButtons` (AppV1 and custom sheets) and
  `getHeaderControlsApplicationV2` (AppV2 sheets). Both are required; systems ship a mix.
- **Orchestration**: Coordinates between dialog, API, and file handler
- **Output execution**: `executeOutputPlan()` turns the plan from the "Use this image" window into
  files (subject removal, backgrounds, compositing, saving) and `applyActorImages()` writes the
  portrait and token fields - to the prototype token, or to the placed token for unlinked actors

#### 3. Image Generation Dialog (`scripts/dialog.js`)
- **ApplicationV2**: Extends `HandlebarsApplicationMixin(ApplicationV2)`. (This was a
  `FormApplication` before the ApplicationV2 migration.)
- **Runware SDK Integration**: Loads SDK dynamically from CDN
- **User Interface**: Provides form for prompts, models, and parameters
- **API Communication**: Handles image generation requests
- **State Management**: Manages loading states and prevents duplicate requests

#### 4. File Handler (`scripts/file-handler.js`)
- **Image Saving**: Converts base64 to Blob and uploads via FilePicker API. `saveImage()` takes a
  `type`: `avatar`, `token`, `background` (per actor) or `ring` (world-shared)
- **Directory Management**: Creates and manages actor-specific directories
- **Ring Listing**: `listRings()` lists `images/runware/rings/` for the custom-ring picker (newest
  first; a missing folder is just an empty list)
- **File Numbering**: Auto-increments image numbers per actor
- **Utilities**: Base64 conversion and file organization

#### 5. Styles (`styles/module.css`)
- **Button Styling**: Makes the generate button match FoundryVTT's UI
- **Dialog Layout**: Responsive form layout with sections
- **Advanced Options**: Collapsible section with toggle animation
- **Loading States**: Visual feedback during generation

#### 6. Template (`templates/image-dialog.hbs`)
- **Handlebars Template**: Defines the dialog HTML structure
- **Form Fields**: All input fields for prompts, models, and parameters
- **Dynamic Elements**: Model suggestions, advanced options toggle
- **Accessibility**: Proper labels and hints for all inputs

#### 7. Settings (`scripts/settings.js`)
- **`registerSettings()`**: Every world setting and the preset manager menu, called from `init`
- **Fallbacks**: A blank background-removal model or prompt template falls back to its `DEFAULT_*`
  constant in `constants.js`

#### 8. "Use this image" Window (`scripts/output-dialog.js`, `templates/output-dialog.hbs`)
- **ApplicationV2**: `RunwareOutputDialog`, one per actor; `RunwareOutputDialog.wait()` resolves
  `'applied'`, `'back'` (return to the image picker) or `'cancelled'`
- **Portrait card**: Keep original / Remove background / Generate new background
- **Token card**: No ring / Foundry dynamic ring / Custom ring (picker plus "Generate new ring…"),
  and a token background: transparent, solid colour (dynamic ring only), or generated
- **Renders once**: Visibility, the CSS preview and the Apply label are updated through the DOM, so
  a re-render never wipes the user's edits or the generated ring and background previews
- **Background previews**: "Preview background" under the portrait's and the token's background
  prompt (the portrait's serves both while the token uses the portrait's background) is paid: the
  subject's background removal unless it is cached, plus one background generation. Both are
  stored in `assetCache` under `SUBJECT_CACHE_KEY` and `getBackgroundRequest().key`, the entries
  `executeOutputPlan()` reads, so Apply reuses them and its label drops them. The button shows its
  price and turns into "Regenerate background" once the current request is cached; a regeneration
  stores a new entry object. The preview then shows the real subject, the background behind the
  portrait (the `<img>`'s own cover-fit CSS background) and inside the token's background layer.
  After a prompt or model edit the last background stays visible, dimmed and marked "outdated", and
  Apply generates a new one; reverting the edit makes it current again
- **Model for rings & backgrounds**: a `select[name="assetPreset"]` above the cards: "Same as
  generation" or a generation preset (`loadPresets()`). `_currentModelParams()` reads it at request
  time for "Generate ring", "Preview background" and `_readPlan()` (`plan.modelParams`, always set;
  `executeOutputPlan()` throws without it). The options are rebuilt in the DOM on the
  `runware-imagegen.presetsUpdated` hook; removing or changing the selected preset shows a warning
  instead of silently switching models, and a failed settings read keeps the current list. A
  selected preset that no longer exists, or no model at all, is an error (`_modelError()`) for Apply
  and both paid buttons, checked before anything is paid. GMs get a "Manage presets" button
- **Ring overlap editor**: under "Keep the character inside the ring" (dynamic and custom rings,
  only while that is ticked), "Paint overlap" switches the token preview into paint mode: it grows
  to 320px, and the pointer paints (brush / eraser, size slider, Undo with a 20-step `ImageData`
  stack and Ctrl+Z, Clear) instead of moving and zooming the subject. The mask is a
  `OVERLAP_MASK_SIZE` canvas over the subject's box, shown as a tint while painting; a second
  subject `<img>` above the ring layers with the mask as its CSS `mask-image` shows the painted
  parts over the ring in both modes. Both get the subject's box and transform
  (`_updateFramingPreview()`, `data-framed`), and a pointer maps onto the mask through the
  canvas' bounding rect. Painting is locked while `_isWorking()`; the mask belongs to the window
- **Plan, not work**: `_readPlan()` builds an `OutputPlan`; the `onApply` callback from `module.js`
  does the work. The dialog shows its errors and stays open. X, Escape, Cancel and Back are blocked
  while Apply, a ring generation or a background preview is running (`_isWorking()`)

#### 9. Asset Generation (`scripts/asset-generation.js`)
- **Paid calls**: `removeBackground()`, `generateRing()`, `generateBackground()`. Ring and background
  requests reuse the generation form's model, LoRA, VAE, embeddings, steps and CFG scale (not the
  seed), or those of the preset picked in the window, re-clamped against `LIMITS`
- **Presets**: `presetToModelParams()` turns a stored preset into the same ModelParams a generation
  with that preset sends (without the LoRA trigger); `listPresets()` lists the valid ones (the
  GM's own by name, then the built-ins), and `loadPresets()` reads the setting plus the enabled
  built-in presets (`withBuiltinPresets()`), reporting a failed read separately from "no presets"
- **Model restrictions**: `requestSingleImage()` and the generation dialog pass every request
  through `applyModelRestrictions()` (`model-catalog.js`), which drops the fields a prompt-only
  partner model rejects (steps, CFG scale, LoRA, VAE, embeddings, and usually the negative prompt)
  and refuses an image below the model's minimum pixel count before anything is paid. It also
  sets the most permissive moderation the provider allows (FLUX.2 `safetyTolerance` 5, GPT Image
  `moderation: 'low'`); Runware's own NSFW check is off by default and never requested
- **Background requests**: `getBackgroundRequest(plan, 'portrait'|'token')` is the one place a
  background's prompts, size, model settings and cache key are computed (a token sharing the
  portrait's background gets the portrait's request); the pricing and `executeOutputPlan()` use it
- **Prompt templates**: `fillTemplate()` fills `{material}`, `{scene}` and `{prompt}`; unknown
  placeholders are left as-is so a typo stays visible
- **Pricing**: `summarizePaidCalls()` counts the removals and background generations an Apply will
  make, skipping cached results

#### 10. Image Compositor (`scripts/image-compositor.js`)
- **Pure canvas code**: `compositeLayers()` stacks layers (`cover` / `contain` / `stretch` fit,
  scale, offset, circular clip, and an optional alpha `mask` stretched over the layer's box and
  applied with `destination-in` on a canvas of its own); `punchCircle()` cuts a ring's centre and
  everything outside it
- **No tainted canvas**: base64 and data URIs are decoded locally, same-origin paths are fetched,
  cross-origin URLs are refused
- **Fallback**: `OffscreenCanvas` when available, otherwise a detached `<canvas>`

#### 11. Token Ring Helpers (`scripts/token-ring.js`)
- **`getDynamicRingInfo()`**: Whether the world has a core dynamic ring (`CONFIG.Token.ring`
  spritesheet) and its label; the option is hidden if not
- **Validation**: Hex colour parsing and subject-scale clamping (`LIMITS.subjectScale`)

## Data Flow

### 1. User Opens Actor Sheet
```
User opens actor sheet
    ↓
getActorSheetHeaderButtons hook fires
    ↓
Module adds "Generate Image" button
```

### 2. User Clicks Generate Button
```
User clicks button
    ↓
openImageGenerationDialog() called
    ↓
RunwareImageDialog instantiated
    ↓
Dialog renders with Handlebars template
```

### 3. User Submits Form
```
User fills form and clicks "Generate Image"
    ↓
_onGenerate() validates input
    ↓
_generateImage() called
    ↓
Runware SDK loaded (if not already)
    ↓
runware.requestImages() with parameters (outputType URL)
    ↓
API returns an image URL
    ↓
downloadRunwareImage() fetches it as base64
```

### 4. Image Chosen, Built, and Applied
```
Image data received
    ↓
handleGeneratedImage() called
    ↓
User picks one image (DialogV2, only when >1)
    ↓
RunwareOutputDialog: portrait + token options (nothing paid or saved yet,
except an explicit "Generate ring" or "Preview background", whose results
Apply reuses; Cancel discards them)
    ↓
Apply → executeOutputPlan()
    ↓
removeBackground() once, if any output needs the bare subject
    ↓
generateBackground() for the portrait and/or token (or one shared)
    ↓
compositeLayers() builds the portrait and token WebPs in the browser
    ↓
ImageFileHandler.saveImage(): ring, backgrounds, portrait, token
    ↓
applyActorImages() updates img and prototypeToken (or the placed token)
```

Any failure keeps the window open with the error, and `handleGeneratedImage()` returns `false`
when the user cancels, so the generation dialog keeps its prompt.

### 5. How Each Output Is Built

Composited tokens are `TOKEN_SIZE` (512px) squares. Transparent tokens without a baked-in
background, custom ring or framing are the removed subject at its native size.

The token subject's framing (`token.framing`: `zoom`, `offsetX`, `offsetY`, clamped to
`TOKEN_FRAMING` by `clampTokenFraming()`) is set by dragging and wheeling on the token preview. The
compositor multiplies the subject box by `zoom` and shifts it by the offsets (fractions of the token
edge). With `token.clipSubject` ("Keep the character inside the ring", dynamic and custom rings)
the subject is clipped at `RING_INNER_RADIUS + CUSTOM_RING_BACKGROUND_OVERLAP` (divided by the
dynamic ring's `subject.scale`), just under the band: the core ring does not mask its subject, so
anything outside it would be drawn over the map. Without it, a custom-ring subject is still clipped
to the token circle. A dynamic ring's `subject.scale` still applies on top, in Foundry.

The ring overlap (`token.overlapMask`, only with `token.clipSubject` and a dynamic or custom ring)
exempts painted parts from that clip. It is `null` when nothing is painted or it doesn't apply,
else `{ key, src }`: `src` a PNG data URI of the `OVERLAP_MASK_SIZE` mask, `key` a hash of its
alpha channel. The mask covers the subject layer's box (the square the subject is `contain`-fitted
into), so it follows the framing and fits both rings. `executeOutputPlan()` accepts only a
`data:image/png` source. For the custom ring it adds the subject once more, masked, above the ring
(still clipped to the token circle). For the dynamic ring, which Foundry draws under its subject
texture, the single subject layer is kept where it is inside the clip or painted
(`maskExemptsClip`: the mask unioned with the clip circle), so no pixel is drawn twice. The saved-token key uses `key` instead of the data
URI. Since the mask needs `clipSubject`, which already forces a composited token, an empty mask
leaves the output exactly as before.

| Output | Layers (bottom → top) | Document fields |
| --- | --- | --- |
| Portrait, keep | original | `img` |
| Portrait, remove | subject | `img` |
| Portrait, new background | background (cover) → subject, at the original's size | `img` |
| Token, no ring | [background clipped to a circle] → subject | `texture.src`, `ring.enabled=false` |
| Token, dynamic ring | [background clipped to `RING_INNER_RADIUS / subjectScale`] → subject (clip, or clip ∪ overlap mask) | `texture.src` and `ring.subject.texture` = the file, `ring.enabled=true`, `ring.subject.scale`, `ring.colors.ring/background` |
| Token, custom ring | [background clipped to `RING_INNER_RADIUS + CUSTOM_RING_BACKGROUND_OVERLAP`] → subject in the inner ⅔ (`CUSTOM_RING_SUBJECT_SCALE`) → ring (stretch) → [subject masked by the overlap] | `texture.src`, `ring.enabled=false` |

- **The dynamic ring doesn't mask the subject**: Foundry draws the subject texture over the ring,
  so a baked-in background has to stop at the ring's inner edge. `subject.scale` scales the ring
  relative to the texture, hence the division.
- **Custom rings are baked**: the dynamic ring style (`core.dynamicTokenRing`) is one world-wide
  spritesheet, and registering new ones only works at startup and needs a reload. A per-actor ring
  is therefore composited into a static image with the dynamic ring off.
- **Generated rings** are 1024x1024 (`RING_GENERATION_SIZE`), background-removed, and punched with
  `punchCircle(RING_INNER_RADIUS, { outerRadius: 1 })`, because removal often keeps the centre.
- A transparent token with a "Remove background" portrait reuses the portrait file.
- `core.prototypeTokenOverrides` can force ring settings per actor type and beats this update.

### 6. Caching Paid Results

Each output window gets an `assetCache` (`Map`) of `{ imageData, savedPath }` entries from
`handleGeneratedImage()`, which keeps one cache per picked image for as long as that generation's
flow runs (Cancel ends it):

- `subject`: the background-removed subject, shared by portrait and token (at most one removal per
  picked image)
- `background:<width>x<height>:<model settings>…<prompt>…`: each generated background, keyed by
  size, clamped model settings and prompts (`getBackgroundRequest()`), so identical portrait and
  token requests are paid once and a background is never reused for another model or preset
- `ring:<n>`: the last generated ring (regenerating replaces it)
- `output:portrait:…` / `output:token:…`: the saved path of a final image for an identical plan
  and background request (the token's overlap mask counts by its `key`, not its data URI)

Rings and backgrounds are shared between the caches of all picked images, so **Back to images** and
picking again never pays for them twice. If Apply fails (for example a failed upload or actor
update), pressing it again reuses the cached images, and `savedPath` stops a ring, background,
portrait or token from being uploaded twice. The Apply label is recomputed from the cache, so it
only lists calls that are still to be paid.

## Key Technologies

### FoundryVTT APIs Used
- **Hooks System**: `init`, `ready`, `getActorSheetHeaderButtons`, `getHeaderControlsApplicationV2`
- **ApplicationV2**: Extended for the generation dialog, the "Use this image" window, and the preset manager
- **FilePicker API**: For directory creation and file uploads
- **Settings API**: For module configuration
- **DialogV2 API**: For the multi-image picker. The deprecated ApplicationV1 `Dialog` class was
  removed in v0.9.0.
- **Dynamic Token Rings**: `CONFIG.Token.ring` and the `core.dynamicTokenRing` setting are read,
  never changed; `prototypeToken.ring.*` is written
- **Notifications**: For user feedback

### Runware SDK
- **Dynamic Import**: Loaded from CDN via ES modules
- **Async Initialization**: `Runware.initialize()` with API key
- **Image Generation**: `runware.requestImages()` method (portraits, rings, backgrounds)
- **Background Removal**: `runware.removeImageBackground()` with the `backgroundRemovalModel`
  setting (default `bria:2@1`)
- **Parameters**: Supports prompts, models, LoRA, CFG, steps, seed, etc.
- **Output**: Base64 image data for local storage

### Web Standards
- **ES6 Modules**: Import/export syntax
- **Async/Await**: For asynchronous operations
- **FormData API**: For form data extraction
- **Blob API**: For image data conversion
- **File API**: For creating file objects
- **Canvas**: `OffscreenCanvas` (or `<canvas>`) and `createImageBitmap` for compositing

## Configuration Options

### Module Settings (World-Level)
```javascript
game.settings.register(MODULE_ID, 'apiKey', {...})        // Required
game.settings.register(MODULE_ID, 'defaultModel', {...})  // Optional
game.settings.register(MODULE_ID, 'imageWidth', {...})    // Optional
game.settings.register(MODULE_ID, 'imageHeight', {...})   // Optional
game.settings.register(MODULE_ID, 'numberResults', {...}) // Optional
game.settings.register(MODULE_ID, 'backgroundRemovalModel', {...})           // Optional, default bria:2@1
game.settings.register(MODULE_ID, 'ringPromptTemplate', {...})               // Optional
game.settings.register(MODULE_ID, 'ringNegativePromptTemplate', {...})       // Optional
game.settings.register(MODULE_ID, 'backgroundPromptTemplate', {...})         // Optional
game.settings.register(MODULE_ID, 'backgroundNegativePromptTemplate', {...}) // Optional
```

All are registered by `registerSettings()` in `scripts/settings.js`. A blank model or template
restores its default. Templates support `{material}`, `{scene}` and `{prompt}`.

### Generation Parameters
- **Required**: Positive prompt, model
- **Optional**: Negative prompt, dimensions, LoRA, steps, CFG, seed

### Supported Models
- **Runware Models**: `runware:MODEL_ID@VERSION`
- **CivitAI Models**: `civitai:MODEL_ID@VERSION_ID`
- **LoRA Models**: Added via `lora` parameter array

## File Structure

### Module Directory
```
runware-imagegen/
├── module.json              # Manifest
├── README.md               # User documentation
├── SETUP.md                # Installation guide
├── LICENSE                 # MIT License
├── package.json            # NPM metadata
├── .gitignore             # Git ignore rules
├── scripts/
│   ├── module.js          # Main module entry point
│   ├── settings.js        # Module settings
│   ├── dialog.js          # Image generation dialog
│   ├── output-dialog.js   # "Use this image" window
│   ├── asset-generation.js # Background removal, rings, backgrounds
│   ├── image-compositor.js # Canvas compositing
│   ├── token-ring.js      # Dynamic ring helpers
│   ├── preset-config.js   # GM-only preset manager
│   ├── model-catalog.js   # Built-in presets, partner-model request rules
│   ├── file-handler.js    # File operations
│   ├── runware-client.js  # Shared Runware SDK client
│   ├── runware-connection.js # Fast API-key check
│   ├── runware-errors.js  # Error normalisation
│   └── constants.js       # MODULE_ID, LIMITS, token geometry, defaults
├── styles/
│   └── module.css         # Module styles
├── templates/
│   ├── image-dialog.hbs   # Dialog template
│   ├── output-dialog.hbs  # "Use this image" template
│   └── preset-config.hbs  # Preset manager template
├── lang/
│   └── en.json           # Unused; every string is hardcoded in JS/HBS
```

Generated images are auto-created separately in the Foundry data root:

```
Data/
└── images/
    └── runware/
        ├── [actor-name]_[actor-id]/
        │   ├── image_N.webp
        │   ├── tokens/
        │   │   └── token_N.webp
        │   └── backgrounds/
        │       └── background_N.webp
        └── rings/
            └── ring_N.webp     # shared by every actor
```

## Security Considerations

1. **API Key Storage**: Stored in a world-scope setting, which only a GM can *edit*.
   Note that Foundry sends world settings to every connected client, so any player can
   read the key from the browser console. This is inherent to letting players generate
   images directly. If that is not acceptable for your table, do not distribute the key
   this way - see SETUP.md.
2. **File Permissions**: Uses FoundryVTT's FilePicker API (respects user permissions)
3. **Input Validation**: Validates all form inputs before API calls
4. **Error Handling**: Catches and displays errors gracefully
5. **XSS Prevention**: Uses FoundryVTT's built-in template rendering

## Performance Optimizations

1. **Lazy Loading**: Runware SDK loaded only when needed
2. **URL Output, Downloaded**: Images are requested as a URL and downloaded as base64
   (`downloadRunwareImage()`); Runware never delivers a large inline base64 result over the
   websocket, and its image CDN allows cross-origin downloads
3. **Sequential Numbering**: Efficient file naming without conflicts
4. **Async Operations**: Non-blocking UI during generation
5. **State Management**: Prevents multiple simultaneous requests
6. **Paid-Result Cache**: A retried Apply, or a new pick after Back to images, reuses what was already paid for
7. **Local Compositing**: Backgrounds and rings are combined on a canvas, not with extra paid calls

## Extensibility

### Adding New Features
The module is designed to be extensible:

1. **New Parameters**: Add to dialog template and `_generateImage()`
2. **Custom Models**: Update model suggestions in `getData()`
3. **Batch Operations**: Extend to support multiple actors
4. **Image Variants**: Add image-to-image or editing features
5. **Presets**: Create preset prompt templates

### Hooks for Other Modules
Other modules could potentially hook into:
- File saving process
- Image generation completion
- Dialog rendering

## Testing Checklist

### Basic Functionality
- [ ] Module loads without errors
- [ ] Settings are saved correctly
- [ ] Button appears on actor sheets
- [ ] Dialog opens and renders properly
- [ ] Image generation works with default settings

### Advanced Features
- [ ] LoRA models apply correctly
- [ ] Advanced parameters (steps, CFG, seed) work
- [ ] Multiple images generate correctly
- [ ] Negative prompts are applied

### "Use this image"
- [ ] Every portrait option and every ring / token background combination
- [ ] Linked actor (prototype token) and unlinked token (placed token)
- [ ] A world or system without dynamic rings hides that option
- [ ] Cancel / X / Back at every stage save nothing; Apply after a failure doesn't pay twice
- [ ] Generated ring has a fully transparent centre; backgrounds never bleed outside the ring

### Error Handling
- [ ] Invalid API key shows error
- [ ] Missing prompt shows error
- [ ] Network errors are caught
- [ ] File save errors are handled

### Edge Cases
- [ ] Actor names with special characters
- [ ] Very long prompts
- [ ] Large image dimensions
- [ ] Rapid button clicks (duplicate prevention)

## Common Customizations

### Change Default Dimensions
Edit in `module.js`:
```javascript
game.settings.register(MODULE_ID, 'imageWidth', {
  default: 768, // Change from 512
});
```

### Add More Model Suggestions
Edit in `dialog.js`:
```javascript
modelSuggestions: [
  { value: 'your-model-id', label: 'Your Model Name' },
  // ... existing suggestions
]
```

### Modify Button Position
Edit the hook in `module.js`:
```javascript
buttons.unshift({...})  // Start of array
// or
buttons.push({...})     // End of array
```

### Custom Image Naming
Edit in `file-handler.js`:
```javascript
const filename = `custom_name_${imageNumber}.${FILE_EXTENSIONS[mimeType]}`;
```

## Troubleshooting Development

### Module Not Loading
1. Check browser console for syntax errors
2. Verify `module.json` is valid JSON
3. Ensure all files are in correct locations
4. Check FoundryVTT version compatibility

### Dialog Not Rendering
1. Verify template file exists and is valid Handlebars
2. Check `getData()` returns correct object structure
3. Ensure CSS file is loaded

### API Calls Failing
1. Verify API key is valid and has credits
2. Check network tab in DevTools for API responses
3. Ensure Runware SDK loads correctly from CDN
4. Verify CORS is not blocking requests

### Images Not Saving
1. Check file permissions on Data directory
2. Verify FilePicker.upload() has correct parameters
3. Ensure directory creation succeeds
4. Check for disk space issues

## Future Enhancement Ideas

1. **Image History**: Browse previously generated images
2. **Batch Generation**: Generate for multiple actors at once
3. **Image Variants**: Generate variations of existing images
4. **Prompt Templates**: Save and reuse prompt templates
5. **Image Editing**: Inpainting, upscaling
6. **Style Presets**: Predefined style configurations
7. **Gallery View**: Visual browser for all generated images
8. **Import/Export**: Share prompts and settings
9. **Automatic Prompts**: Generate prompts from actor stats/traits

## Resources

### FoundryVTT Development
- [FoundryVTT API Documentation](https://foundryvtt.com/api/v13/)
- [FoundryVTT Discord](https://discord.gg/foundryvtt)
- [Module Development Guide](https://foundryvtt.com/article/module-development/)

### Runware API
- [Runware Documentation](https://docs.runware.ai/)
- [Runware SDK GitHub](https://github.com/runware/sdk-js)
- [Runware Dashboard](https://runware.ai)

### Model Resources
- [CivitAI Model Browser](https://civitai.com)
- [Stable Diffusion Models](https://huggingface.co/models?pipeline_tag=text-to-image)

---

**Module Version**: 1.0.1
**FoundryVTT Version**: v13-v14 (verified v14.367)
**Last Updated**: 2026
