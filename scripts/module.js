/**
 * Runware AI Image Generator Module for FoundryVTT
 *
 * This module integrates Runware AI image generation into actor sheets,
 * allowing users to generate character and NPC portraits using AI.
 */

import { RunwareImageDialog, getImageDialogId } from './dialog.js';
import { RunwareOutputDialog, getOutputDialogId } from './output-dialog.js';
import { ImageFileHandler } from './file-handler.js';
import { registerSettings } from './settings.js';
import {
  MODULE_ID,
  MODULE_NAME,
  TOKEN_SIZE,
  RING_INNER_RADIUS,
  CUSTOM_RING_SUBJECT_SCALE,
  CUSTOM_RING_BACKGROUND_OVERLAP
} from './constants.js';
import { getRunwareErrorMessage } from './runware-errors.js';
import { checkRunwareApiKey } from './runware-connection.js';
import {
  removeBackground,
  generateBackground,
  SUBJECT_CACHE_KEY,
  getBackgroundRequest,
  planNeedsSubject
} from './asset-generation.js';
import { compositeLayers, getImageSize, toDataURI } from './image-compositor.js';
import { clampTokenFraming, isNeutralFraming } from './token-ring.js';

// Cache keys for saved portrait/token files (see saveOutputOnce). They never
// hold image data, so the paid-call summary ignores them.
const OUTPUT_CACHE_PREFIX = 'output:';

/**
 * Initialize the module
 */
Hooks.once('init', async function() {
  console.debug(`${MODULE_NAME} | Initializing module`);

  // Register module settings
  registerSettings({ onApiKeyChange: validateApiKey });

  console.debug(`${MODULE_NAME} | Module initialized`);
});

/**
 * Ready hook - module is ready to use
 */
Hooks.once('ready', async function() {
  console.debug(`${MODULE_NAME} | Module ready`);

  // Verify API key is set
  const apiKey = game.settings.get(MODULE_ID, 'apiKey');
  if (!apiKey) {
    ui.notifications.warn(`${MODULE_NAME}: Please configure your Runware API key in module settings.`);
  }
});

/**
 * Add image generation button to ActorSheet header
 */
const RUNWARE_BUTTON_CLASS = 'runware-imagegen-header-button';
const RUNWARE_CONTROL_ID = 'runware-imagegen-control';
const RUNWARE_CONTROL_ACTION = 'runwareGenerateImage';

Hooks.on('getActorSheetHeaderButtons', (app, buttons) => {
  const actor = app.document;
  if (!canUserModifyActor(actor)) return;
  if (buttons.some((btn) => btn.class === RUNWARE_BUTTON_CLASS)) return;

  buttons.unshift(createRunwareHeaderButton(app));
});

Hooks.on('getHeaderControlsApplicationV2', (app, controls) => {
  const DocumentSheetV2 = foundry?.applications?.api?.DocumentSheetV2;
  if (!DocumentSheetV2 || !(app instanceof DocumentSheetV2)) return;

  const actor = app.document;
  if (!isActorDocument(actor) || !canUserModifyActor(actor)) return;
  if (controls.some((control) => control.id === RUNWARE_CONTROL_ID)) return;

  controls.unshift({
    id: RUNWARE_CONTROL_ID,
    action: RUNWARE_CONTROL_ACTION,
    label: 'Generate Image',
    icon: 'fas fa-palette',
    classes: [RUNWARE_BUTTON_CLASS],
    onClick: () => openImageGenerationDialog(app)
  });
});

function isActorDocument(document) {
  if (!document) return false;
  if (document.documentName) return document.documentName === 'Actor';
  if (document.constructor?.name === 'Actor') return true;
  return typeof Actor !== 'undefined' && document instanceof Actor;
}

function canUserModifyActor(actor) {
  if (!actor?.testUserPermission || !game?.user) return false;
  const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 'OWNER';
  try {
    return actor.testUserPermission(game.user, ownerLevel);
  } catch (err) {
    console.warn(`${MODULE_NAME} | Failed to evaluate ownership:`, err);
    return false;
  }
}

/**
 * Check whether the current user may upload *and* browse files. saveImage()
 * needs both: FILES_UPLOAD for the upload itself, FILES_BROWSE to create the
 * folder and find the next free image number. The button itself stays visible
 * to anyone who owns the actor (mirroring the existing apiKey check, which also
 * isn't gated on button visibility) - this is enforced when the dialog is
 * opened instead, see openImageGenerationDialog().
 * @returns {boolean}
 */
function hasFilePermissions() {
  if (!game?.user) return false;
  try {
    if (typeof game.user.hasPermission === 'function') {
      return game.user.hasPermission('FILES_UPLOAD') && game.user.hasPermission('FILES_BROWSE');
    }
  } catch (err) {
    console.warn(`${MODULE_NAME} | Failed to evaluate file permissions:`, err);
    return false;
  }

  // hasPermission() should always exist on modern Foundry User documents. If it's
  // missing, fail closed rather than let a paid generation request through only
  // to fail unsavably afterwards.
  console.warn(`${MODULE_NAME} | game.user.hasPermission is unavailable; denying by default.`);
  return false;
}

function createRunwareHeaderButton(app) {
  return {
    label: 'Generate Image',
    class: RUNWARE_BUTTON_CLASS,
    icon: 'fas fa-palette',
    onclick: () => openImageGenerationDialog(app)
  };
}

/**
 * Open the image generation dialog for an actor sheet
 * @param {ActorSheet} actorSheet - The actor sheet application
 */
async function openImageGenerationDialog(actorSheet) {
  const apiKey = game.settings.get(MODULE_ID, 'apiKey');

  if (!apiKey) {
    ui.notifications.error(`${MODULE_NAME}: Please configure your Runware API key in module settings.`);
    return;
  }

  // Generation costs money and saving the result requires Foundry's file
  // permissions. Check up front so a player who owns the actor but lacks them
  // doesn't pay for a Runware request that can never be saved.
  if (!hasFilePermissions()) {
    ui.notifications.error(`${MODULE_NAME}: You do not have permission to save files. Ask your GM to grant the "Upload New Files" and "Use File Browser" permissions.`);
    return;
  }

  const actor = actorSheet.document;

  // A locked compendium actor can't be updated - fail before the paid request,
  // not after the image has already been generated and uploaded.
  if (actor?.pack && actor.compendium?.locked) {
    ui.notifications.error(`${MODULE_NAME}: This actor is in a locked compendium. Unlock it first.`);
    return;
  }

  // One dialog per actor: bring an open one to the front instead of replacing it.
  // An open "Use this image" window counts too - it still belongs to an earlier
  // generation (whose dialog may have been closed), and a new paid generation
  // couldn't open a second one.
  const existing = foundry.applications.instances?.get(getImageDialogId(actor))
    ?? foundry.applications.instances?.get(getOutputDialogId(actor));
  if (existing) {
    existing.bringToFront?.();
    return;
  }

  const dialog = new RunwareImageDialog({
    actor: actor,
    onImageGenerated: (imageData, options) => handleGeneratedImage(actor, imageData, options)
  });

  dialog.render({ force: true });
}

/**
 * Turn Runware image data into something an <img> can display.
 * @param {Object} image
 * @returns {string}
 */
function getImageSrc(image) {
  return toDataURI(image) || image?.imageURL || '';
}

/**
 * Resolve the DialogV2 API rather than assuming it's present. Legacy `Dialog`
 * (and jQuery) have been fully removed from this module - module.json's v13
 * minimum guarantees DialogV2 exists, but fail with a clear error instead of a
 * mysterious TypeError if that assumption is ever wrong, matching the
 * defensive style of ImageFileHandler._getFilePicker().
 * @returns {typeof foundry.applications.api.DialogV2}
 */
function getDialogV2() {
  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (!DialogV2) {
    throw new Error(`${MODULE_NAME}: DialogV2 API is unavailable.`);
  }
  return DialogV2;
}

/**
 * Handle the generated image(s): pick one, then let the user decide in the
 * "Use this image" window how it becomes the portrait and/or token. Nothing is
 * saved and no paid call is made until that window's Apply (apart from the
 * explicit "Generate ring" and "Preview background" buttons inside it, whose
 * results are only saved on Apply).
 * @param {Actor} actor - The actor document
 * @param {Array<Object>} imagesData - The generated image data from Runware
 * @param {Object} options - Additional options from the generation dialog
 * @param {boolean} [options.removeBackground] - Preselect "Remove background" for the portrait
 * @param {string} [options.prompt] - The generation prompt
 * @param {Object} [options.modelParams] - Model settings reused for rings and backgrounds,
 *   unless the output window picks a preset instead
 * @param {{width: number, height: number}} [options.portraitSize] - The generation request's size
 * @returns {Promise<boolean>} `true` once the images were applied, `false` if
 *   the flow was abandoned or failed - the dialog stays open in that case so
 *   the prompt isn't lost.
 */
async function handleGeneratedImage(actor, imagesData, options = {}) {
  try {
    if (!imagesData || imagesData.length === 0) {
      ui.notifications.warn(`${MODULE_NAME}: No images were generated.`);
      return false;
    }

    const { removeBackground: preselectRemoval = false, prompt = '', modelParams = {}, portraitSize = null } = options;
    const canGoBack = imagesData.length > 1;
    const assetCaches = new Map();
    let latestCache = null;

    // "Back to images" in the output window returns here to pick again.
    while (true) {
      const selectedImageData = canGoBack
        ? await showImageSelectionDialog(imagesData)
        : imagesData[0];

      if (!selectedImageData) {
        ui.notifications.info(`${MODULE_NAME}: No image selected.`);
        return false;
      }

      latestCache = getAssetCache(assetCaches, selectedImageData, latestCache);
      const result = await RunwareOutputDialog.wait({
        actor,
        imageData: selectedImageData,
        canGoBack,
        modelParams,
        portraitSize,
        generationPrompt: prompt,
        defaults: { portraitBackground: preselectRemoval ? 'remove' : 'keep' },
        assetCache: latestCache,
        onApply: (plan, context) => executeOutputPlan(actor, selectedImageData, plan, context)
      });

      if (result === 'applied') return true;
      if (result !== 'back') return false;
    }
  } catch (error) {
    console.error(`${MODULE_NAME} | Error handling generated image:`, error);
    ui.notifications.error(`${MODULE_NAME}: Could not apply the generated image - ${getRunwareErrorMessage(error)}`);
    return false;
  }
}

/**
 * The paid-results cache for one picked image. The removed subject belongs to
 * that image; generated rings and backgrounds don't depend on it, so they are
 * shared with every other image's cache (same entry objects, so a savedPath
 * recorded through one cache is seen by all). Going "Back to images" and
 * picking again therefore never pays for the same asset twice.
 * @param {Map<Object, Map>} assetCaches - per-image caches for this generation
 * @param {Object} image - the picked Runware image
 * @param {Map|null} [latest] - the previous window's cache. Its entries win:
 *   "Regenerate background" replaces an entry there with a new object, and
 *   the other caches still hold the old one.
 * @returns {Map<string, {imageData: Object|null, savedPath: string|null}>}
 */
function getAssetCache(assetCaches, image, latest = null) {
  let cache = assetCaches.get(image);
  if (!cache) {
    cache = new Map();
    assetCaches.set(image, cache);
  }
  const isShared = (key) => key !== SUBJECT_CACHE_KEY && !key.startsWith(OUTPUT_CACHE_PREFIX);
  if (latest && latest !== cache) {
    for (const [key, entry] of latest) {
      if (isShared(key)) cache.set(key, entry);
    }
  }
  for (const other of assetCaches.values()) {
    for (const [key, entry] of other) {
      if (isShared(key) && !cache.has(key)) cache.set(key, entry);
    }
  }
  return cache;
}

/**
 * Save an output once per identical request. A retried Apply (say, after the
 * actor update failed) reuses the file it already uploaded instead of leaving
 * an orphaned image_N.webp behind.
 * @param {Map} cache
 * @param {string} key - OUTPUT_CACHE_PREFIX + a description of the output
 * @param {() => Promise<string>} save
 * @returns {Promise<string>} The saved path
 */
async function saveOutputOnce(cache, key, save) {
  const hit = cache.get(key);
  if (hit?.savedPath) return hit.savedPath;

  const savedPath = await save();
  cache.set(key, { imageData: null, savedPath });
  return savedPath;
}

/**
 * Return the cached result for `key`, or produce and cache it. The cache
 * belongs to the output window, so pressing Apply again after a failure
 * doesn't pay for the same removal or background a second time.
 * @param {Map<string, {imageData: Object, savedPath: string|null}>} cache
 * @param {string} key
 * @param {Function} setStatus
 * @param {string} status - Shown only when the asset actually has to be produced
 * @param {() => Promise<Object>} produce
 * @returns {Promise<{imageData: Object, savedPath: string|null}>}
 */
async function getCachedAsset(cache, key, setStatus, status, produce) {
  const hit = cache.get(key);
  if (hit?.imageData) return hit;

  setStatus(status);
  const entry = { imageData: await produce(), savedPath: null };
  cache.set(key, entry);
  return entry;
}

/**
 * Build, save, and apply the portrait and token described by an output plan.
 * Called by the output window's Apply. Throws on any failure (the window shows
 * the error and stays open) and never notifies by itself.
 *
 * Layers per output (bottom to top):
 * - portrait keep: original; remove: subject; generate: background (cover) + subject
 * - token no ring: [background clipped to a circle] + subject
 * - token dynamic ring: [background clipped to the ring's inner edge] + subject,
 *   used as the ring's subject texture. The core ring doesn't mask the subject,
 *   so a baked-in background must stop at the ring or it would cover it.
 * - token custom ring: [background] + subject in the inner two thirds + ring,
 *   baked into one WebP with the dynamic ring off (ring styles are world-wide).
 * The token subject is additionally zoomed and shifted by `token.framing`
 * (dragged and wheeled on the preview), and with `token.clipSubject` clipped
 * just under the ring's band so it can't stick out of the ring. Either one
 * forces a composited token. With `token.clipSubject`, `token.overlapMask`
 * (painted on the preview) exempts parts of the subject from that clip, so
 * they pass over the ring: drawn once more, masked, above the custom ring; for
 * the dynamic ring (which Foundry draws under its subject texture) the one
 * subject layer keeps what is inside the clip or painted.
 * @param {Actor} actor
 * @param {Object} original - The selected Runware image
 * @param {Object} plan - The OutputPlan built by RunwareOutputDialog
 * @param {Object} context
 * @param {(text: string) => void} context.setStatus
 * @param {Map} context.cache
 */
async function executeOutputPlan(actor, original, plan, { setStatus, cache }) {
  // The dialog's model selection (a preset, or the generation's settings) is
  // always set; never guess another model for a paid request.
  if (!plan?.modelParams) throw new Error('The output plan has no model settings.');
  const { portrait, token } = plan;

  // One background removal serves every output that needs the bare subject.
  let subject = null;
  if (planNeedsSubject(plan)) {
    const entry = await getCachedAsset(cache, SUBJECT_CACHE_KEY, setStatus, 'Removing background…',
      () => removeBackground(original));
    subject = entry.imageData;
  }

  // A token that shares the portrait's background gets the portrait's request,
  // so the second lookup is a cache hit on the same entry.
  const portraitRequest = getBackgroundRequest(plan, 'portrait');
  const tokenRequest = getBackgroundRequest(plan, 'token');
  const getBackground = ({ key, ...request }) =>
    getCachedAsset(cache, key, setStatus, 'Generating background…', () => generateBackground(request));

  const portraitBackground = portraitRequest ? await getBackground(portraitRequest) : null;
  const tokenBackground = tokenRequest ? await getBackground(tokenRequest) : null;

  let ringEntry = null;
  let ringSource = null;
  if (token?.ring === 'custom') {
    if (token.custom?.source === 'generated') {
      ringEntry = cache.get(token.custom.cacheKey) ?? null;
      if (!ringEntry?.imageData) throw new Error('The generated ring is no longer available. Generate it again.');
      ringSource = ringEntry.imageData;
    } else if (token.custom?.ringPath) {
      ringSource = token.custom.ringPath;
    } else {
      throw new Error('Choose a custom ring first.');
    }
  }

  setStatus('Compositing…');

  let portraitImage = null;
  if (portrait?.background === 'keep') {
    portraitImage = original;
  } else if (portrait?.background === 'remove') {
    portraitImage = subject;
  } else if (portrait?.background === 'generate') {
    const { width, height } = await getImageSize({ imageBase64Data: original.imageBase64Data });
    portraitImage = await compositeLayers({
      width,
      height,
      layers: [
        { src: portraitBackground.imageData, fit: 'cover' },
        { src: subject, fit: 'contain' }
      ]
    });
  }

  let tokenImage = null;
  // A plain transparent token is the same file as a background-removed
  // portrait: reuse it instead of uploading a duplicate.
  let tokenReusesPortrait = false;
  if (token) {
    const backgroundLayer = (clipCircle) => tokenBackground && {
      src: tokenBackground.imageData,
      fit: 'cover',
      clipCircle
    };
    const framing = clampTokenFraming(token.framing);
    const overlapMask = getOverlapMaskSource(token);
    const subjectLayer = (scale, extra = {}) => ({
      src: subject,
      fit: 'contain',
      scale: scale * framing.zoom,
      offsetX: framing.offsetX,
      offsetY: framing.offsetY,
      ...extra
    });

    if (token.ring === 'custom') {
      tokenImage = await compositeLayers({
        width: TOKEN_SIZE,
        height: TOKEN_SIZE,
        layers: [
          // Slightly larger than the punched centre so no gap shows at the band's inner edge.
          backgroundLayer(RING_INNER_RADIUS + CUSTOM_RING_BACKGROUND_OVERLAP),
          // At least clipped to the token circle, so it never spills into the corners.
          subjectLayer(CUSTOM_RING_SUBJECT_SCALE, {
            clipCircle: token.clipSubject ? RING_INNER_RADIUS + CUSTOM_RING_BACKGROUND_OVERLAP : 1
          }),
          { src: ringSource, fit: 'stretch' },
          // The painted overlap over the ring, clipped to the token circle
          // like an unclipped subject.
          overlapMask && subjectLayer(CUSTOM_RING_SUBJECT_SCALE, { clipCircle: 1, mask: overlapMask })
        ]
      });
    } else if (tokenBackground || !isNeutralFraming(framing) || token.clipSubject) {
      // subject.scale shrinks or grows the core ring relative to the texture,
      // so its inner edge sits at RING_INNER_RADIUS / scale in texture space.
      // The core ring doesn't mask its subject: without a clip, anything
      // outside the ring is drawn over the map.
      const dynamicScale = token.ring === 'dynamic' ? token.dynamic.subjectScale : 1;
      const clipCircle = token.ring === 'dynamic' ? Math.min(1, RING_INNER_RADIUS / dynamicScale) : 1;
      const subjectClip = token.clipSubject
        ? Math.min(1, (RING_INNER_RADIUS + CUSTOM_RING_BACKGROUND_OVERLAP) / dynamicScale)
        : null;
      tokenImage = await compositeLayers({
        width: TOKEN_SIZE,
        height: TOKEN_SIZE,
        layers: [
          backgroundLayer(clipCircle),
          // One subject layer: inside the clip, or painted (overlapMask needs
          // clipSubject, which already forces this branch). Drawing it twice
          // would thicken semi-transparent edges where the two overlap.
          overlapMask
            ? subjectLayer(1, { clipCircle: subjectClip, mask: overlapMask, maskExemptsClip: true })
            : subjectLayer(1, { clipCircle: subjectClip })
        ]
      });
    } else {
      tokenImage = subject;
      tokenReusesPortrait = portrait?.background === 'remove';
    }
  }

  setStatus('Saving…');

  // Paid assets are kept on disk so they can be reused: a generated ring in
  // the world-wide rings folder (offered by every actor's ring picker), a
  // generated background next to the actor's portraits. savedPath stops a
  // retried Apply from uploading them twice.
  if (ringEntry && !ringEntry.savedPath) {
    ringEntry.savedPath = await ImageFileHandler.saveImage(null, ringEntry.imageData, { type: 'ring' });
  }
  for (const entry of new Set([portraitBackground, tokenBackground].filter(Boolean))) {
    if (!entry.savedPath) {
      entry.savedPath = await ImageFileHandler.saveImage(actor, entry.imageData, { type: 'background' });
    }
  }

  // The background belongs in these keys: the plan alone doesn't say which
  // model painted it, nor (for a shared background) the portrait's prompt. Its
  // saved path tells a regenerated background ("Regenerate background" after
  // a failed Apply) from the one an earlier attempt composited.
  const backgroundKey = (request, entry) => `${request?.key ?? ''}:${entry?.savedPath ?? ''}`;
  const portraitPath = portraitImage
    ? await saveOutputOnce(cache,
      `${OUTPUT_CACHE_PREFIX}portrait:${JSON.stringify(portrait)}:${backgroundKey(portraitRequest, portraitBackground)}`,
      () => ImageFileHandler.saveImage(actor, portraitImage))
    : null;
  let tokenPath = null;
  if (tokenImage) {
    // The overlap mask's content hash stands in for its data URI (a PNG of
    // up to a few hundred KB), so equal masks still share the saved file.
    const tokenKey = JSON.stringify({ ...token, overlapMask: token.overlapMask?.key ?? null });
    tokenPath = tokenReusesPortrait && portraitPath
      ? portraitPath
      : await saveOutputOnce(cache,
        `${OUTPUT_CACHE_PREFIX}token:${tokenKey}:${backgroundKey(tokenRequest, tokenBackground)}`,
        () => ImageFileHandler.saveImage(actor, tokenImage, { type: 'token' }));
  }

  setStatus('Updating actor…');
  await applyActorImages(actor, {
    portraitPath,
    token: tokenPath
      ? { path: tokenPath, ring: token.ring === 'dynamic' ? token.dynamic : null }
      : null
  });
}

/**
 * The token's ring overlap mask as a compositor source, or null when it
 * doesn't apply: it only exempts parts of a subject kept inside a dynamic or
 * custom ring, and only a PNG data URI (what the output window exports) is
 * accepted - never a path or URL.
 * @param {Object} token - plan.token
 * @returns {string|null}
 */
function getOverlapMaskSource(token) {
  if (!token?.clipSubject || (token.ring !== 'dynamic' && token.ring !== 'custom')) return null;
  const src = token.overlapMask?.src;
  if (typeof src !== 'string' || !token.overlapMask?.key) return null;
  return /^data:image\/png;base64,/i.test(src) ? src : null;
}

/**
 * Token document fields for a saved token image. Without a dynamic ring the
 * ring is switched off, so a custom ring baked into the image isn't drawn
 * inside a second, core ring.
 * @param {{path: string, ring: {ringColor: string|null, backgroundColor: string|null, subjectScale: number}|null}} token
 * @returns {Object} Flattened update keys relative to the token document
 */
function getTokenImageFields({ path, ring }) {
  if (!ring) {
    return { 'texture.src': path, 'ring.enabled': false, 'ring.subject.texture': null };
  }
  return {
    'texture.src': path,
    'ring.enabled': true,
    'ring.subject.texture': path,
    'ring.subject.scale': ring.subjectScale,
    'ring.colors.ring': ring.ringColor ?? null,
    'ring.colors.background': ring.backgroundColor ?? null
  };
}

/**
 * Point the actor's portrait and token at the saved files.
 * For an unlinked (synthetic) token actor the placed token itself is updated:
 * its prototype token is meaningless and changing it has no effect.
 * @param {Actor} actor
 * @param {Object} images
 * @param {string|null} images.portraitPath
 * @param {{path: string, ring: Object|null}|null} images.token
 */
async function applyActorImages(actor, { portraitPath, token }) {
  const syntheticToken = actor.isToken ? actor.token : null;
  const tokenFields = token ? getTokenImageFields(token) : null;

  const actorUpdates = {};
  if (portraitPath) actorUpdates.img = portraitPath;
  if (tokenFields && !syntheticToken) {
    for (const [key, value] of Object.entries(tokenFields)) {
      actorUpdates[`prototypeToken.${key}`] = value;
    }
  }

  if (Object.keys(actorUpdates).length > 0) {
    await actor.update(actorUpdates);
  }
  if (tokenFields && syntheticToken) {
    await syntheticToken.update(tokenFields);
  }

  if (portraitPath) ui.notifications.info(`${MODULE_NAME}: Actor image updated`);
  if (token) ui.notifications.info(`${MODULE_NAME}: Token image updated`);
}

/**
 * Verify a Runware API key and notify the caller's client of the result.
 * Called from the `apiKey` setting's `onChange` (see settings.js), which
 * guards on `game.user.isGM` before calling this.
 *
 * Uses checkRunwareApiKey() rather than the SDK's own `Runware.initialize()`
 * - see runware-connection.js for why that path can take up to a minute to
 * report an invalid key instead of failing fast.
 * @param {string} apiKey
 */
async function validateApiKey(apiKey) {
  if (!apiKey) return;

  try {
    await checkRunwareApiKey(apiKey);
    ui.notifications.info(`${MODULE_NAME}: Runware API key verified successfully.`);
  } catch (error) {
    console.error(`${MODULE_NAME} | Runware API key validation failed:`, error);
    ui.notifications.error(`${MODULE_NAME}: Runware API key could not be verified - ${getRunwareErrorMessage(error)}`);
  }
}

/**
 * Shows a dialog to select one from multiple generated images.
 * @param {Array<Object>} imagesData - Array of generated image data.
 * @returns {Promise<Object|null>} The selected image data, or null if none selected.
 */
async function showImageSelectionDialog(imagesData) {

  // Build the picker via DOM APIs (property assignment) instead of an HTML
  // string, so each thumbnail's `previewSrc` (a data: URI or an SDK-provided
  // URL) is never interpolated into markup.
  const content = document.createElement('div');

  const intro = document.createElement('p');
  intro.textContent = 'Please select an image to keep:';
  content.appendChild(intro);

  const grid = document.createElement('div');
  grid.className = 'runware-image-selection';
  grid.style.display = 'flex';
  grid.style.flexWrap = 'wrap';
  grid.style.gap = '10px';
  grid.style.justifyContent = 'center';

  imagesData.forEach((img, index) => {
    const previewSrc = getImageSrc(img);
    const isDisabled = !previewSrc;

    const card = document.createElement('div');
    card.className = `image-choice${isDisabled ? ' disabled' : ''}`;
    card.dataset.index = String(index);
    card.style.textAlign = 'center';
    card.style.cursor = isDisabled ? 'not-allowed' : 'pointer';
    if (isDisabled) card.style.opacity = '0.6';

    if (previewSrc) {
      const thumb = document.createElement('img');
      thumb.src = previewSrc;
      thumb.style.maxWidth = '200px';
      thumb.style.maxHeight = '200px';
      thumb.style.border = '2px solid transparent';
      card.appendChild(thumb);
    } else {
      const placeholder = document.createElement('div');
      placeholder.textContent = 'No preview';
      placeholder.style.width = '200px';
      placeholder.style.height = '200px';
      placeholder.style.display = 'flex';
      placeholder.style.alignItems = 'center';
      placeholder.style.justifyContent = 'center';
      placeholder.style.border = '2px dashed #999';
      card.appendChild(placeholder);
    }

    card.appendChild(document.createElement('br'));

    const label = document.createElement('span');
    label.textContent = `Image ${index + 1}`;
    card.appendChild(label);

    grid.appendChild(card);
  });

  content.appendChild(grid);

  let selectedImageData = null;

  // rejectClose: false makes dismissal (X / Escape) resolve to null directly,
  // matching the old `close: () => resolve(null)` handler - the 'cancel'
  // button's callback below also returns null for symmetry when a button is
  // used instead. The old V1 `callback` returning `false` from 'ok' never
  // actually blocked the dialog from closing; the real guard is the confirm
  // button starting disabled (via `disabled: true` below) and only being
  // enabled once a thumbnail is clicked, in the `render` callback.
  const result = await getDialogV2().wait({
    window: { title: 'Select an Image' },
    position: { width: 'auto', height: 'auto' },
    classes: ['runware-image-selection-dialog'],
    content,
    rejectClose: false,
    buttons: [
      {
        action: 'ok',
        icon: 'fas fa-check',
        label: 'Confirm Selection',
        disabled: true,
        callback: () => selectedImageData,
      },
      {
        // Preserve the previous default-to-cancel behavior: Enter does nothing
        // destructive until an image has actually been picked.
        action: 'cancel',
        icon: 'fas fa-times',
        label: 'Cancel',
        default: true,
        callback: () => null,
      },
    ],
    render: (event, dialog) => {
      // DialogV2 passes the application instance here, so the root element is
      // `dialog.element`. Fall back to `dialog` itself in case a future version
      // hands the element directly - without a root we silently lose the
      // click-to-select bindings and the picker becomes unusable.
      const root = dialog?.element ?? dialog;
      if (!(root instanceof HTMLElement)) {
        console.error(`${MODULE_NAME} | Could not resolve the image picker root element.`);
        return;
      }
      const confirmButton = root.querySelector('[data-action="ok"]');
      const choices = root.querySelectorAll('.image-choice:not(.disabled)');

      choices.forEach((choice) => {
        choice.addEventListener('click', () => {
          const index = Number(choice.dataset.index);
          selectedImageData = imagesData[index];

          // Visual indicator for selection
          root.querySelectorAll('.image-choice img').forEach((thumb) => {
            thumb.style.borderColor = 'transparent';
          });
          const chosenImg = choice.querySelector('img');
          if (chosenImg) chosenImg.style.borderColor = '#ff6400';

          if (confirmButton) confirmButton.disabled = false;
        });
      });
    },
  });

  return result ?? null;
}
