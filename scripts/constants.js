export const MODULE_ID = 'runware-imagegen';
export const MODULE_NAME = 'Runware AI Image Generator';

// Request limits, enforced in code before every paid Runware call. The HTML
// min/max attributes are hints only: Generate is a plain button, so the browser
// never validates the form.
export const LIMITS = Object.freeze({
  dimension: { min: 256, max: 2048, step: 64, fallback: 512 },
  numberResults: { min: 1, max: 4, fallback: 1 },
  steps: { min: 1, max: 150 },
  cfgScale: { min: 1, max: 30 },
  weight: { min: -4, max: 4 },
  // Foundry's dynamic ring `subject.scale` has min 0.5 and no max; the upper
  // bound only keeps a typo from blowing the subject far past the token.
  subjectScale: { min: 0.5, max: 3, step: 0.05, fallback: 1 }
});

// How long the Runware SDK waits for a task's result (image generation,
// background removal). The SDK default of 60 s is shorter than a slow
// generation (many steps, large sizes, a queue), after which the result is
// thrown away although Runware still delivers - and bills - it.
export const RUNWARE_RESULT_TIMEOUT_MS = 5 * 60 * 1000;

// How long downloading one finished image from Runware's CDN may take. Results
// arrive as a URL and are downloaded (see runware-client.js), not as base64.
export const RUNWARE_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;

// Mouse framing of the subject inside the token (drag to move, wheel to zoom).
// zoom multiplies the subject's box; offsets are fractions of the token edge.
export const TOKEN_FRAMING = Object.freeze({
  zoom: { min: 0.25, max: 4, fallback: 1 },
  offset: { min: -1, max: 1, fallback: 0 }
});

// Ring overlap mask: the parts of the subject painted in the token preview
// that pass over the ring while the rest stays inside it. The mask covers the
// subject layer's square box (so it follows the framing and fits both ring
// types) at this edge, in px.
export const OVERLAP_MASK_SIZE = 512;
// Overlap brush diameter, in mask px (see OVERLAP_MASK_SIZE).
export const OVERLAP_BRUSH = Object.freeze({ min: 4, max: 128, step: 2, fallback: 32 });

// Composited token edge, in px.
export const TOKEN_SIZE = 512;
// Inner edge of a token ring as a fraction of the token's half-size. Foundry's
// core rings (coreSteel, coreBronze) start their colour band at 0.666.
export const RING_INNER_RADIUS = 2 / 3;
// Edge of the subject's box in a custom-ring token, as a fraction of TOKEN_SIZE,
// so the subject sits inside the ring instead of under it.
export const CUSTOM_RING_SUBJECT_SCALE = 2 / 3;
// A baked-in background (custom ring) or a subject kept inside the ring is
// clipped at RING_INNER_RADIUS + this, so it slides under the ring's opaque
// band instead of leaving a transparent seam.
export const CUSTOM_RING_BACKGROUND_OVERLAP = 0.04;
// Square edge requested for a generated ring. Always passed through
// clampDimension() before it reaches Runware.
export const RING_GENERATION_SIZE = 1024;
// Generated rings are shared by every actor, so they live outside the
// per-actor folders.
export const RINGS_DIRECTORY = 'images/runware/rings';

// Bria RMBG 2.0. The previous default, runware:110@1, was shut down by Runware
// on 2026-06-30. GMs can switch it via the backgroundRemovalModel setting.
export const DEFAULT_BACKGROUND_REMOVAL_MODEL = 'bria:2@1';

// Prompt templates. {material}, {scene}, and {prompt} (the raw generation
// prompt) are filled by fillTemplate() in asset-generation.js; GMs can override
// each template in the module settings.
export const DEFAULT_RING_MATERIAL = 'polished steel and gold filigree';
export const DEFAULT_BACKGROUND_SCENE = 'misty fantasy forest at dusk';
export const DEFAULT_RING_PROMPT_TEMPLATE = 'A single ornate circular token frame, perfectly round ring, centered, viewed straight on, flat 2D tabletop RPG token border, {material} with engraved details, uniform band thickness, band occupies only the outer sixth of the image, completely empty plain center, isolated on a plain solid flat white background, symmetrical, crisp clean edges, high detail, no character';
export const DEFAULT_RING_NEGATIVE_PROMPT_TEMPLATE = 'character, person, face, creature, text, letters, numbers, watermark, perspective, tilted, 3d angle, oval, off-center, cropped, cut off, busy background, pattern in center, shadow, gradient background';
export const DEFAULT_BACKGROUND_PROMPT_TEMPLATE = '{scene}, atmospheric environment backdrop for a character portrait, no people, no characters, soft depth of field, even lighting, painterly, centered composition';
export const DEFAULT_BACKGROUND_NEGATIVE_PROMPT_TEMPLATE = 'people, person, character, face, figure, text, watermark, frame, border';
