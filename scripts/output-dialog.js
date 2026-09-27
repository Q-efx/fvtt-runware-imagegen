/**
 * "Use this image" output step
 *
 * An ApplicationV2 that opens after an image was picked and lets the user
 * decide what to make of it: a portrait (keep / remove / replace the
 * background) and a token (no ring, Foundry's dynamic ring, or a custom ring
 * baked into the image, each with an optional background). The token subject
 * can be moved (drag) and zoomed (mouse wheel) on the token preview, and in
 * paint mode the parts that pass over the ring are painted on it (the ring
 * overlap mask).
 *
 * The dialog owns the UI and builds an OutputPlan; module.js owns the work
 * (removal, generation, compositing, saving) through the `onApply` callback.
 * Nothing is paid for or saved before Apply, except the explicit, labelled
 * "Generate ring" and "Preview background" buttons. Their results go into the
 * same assetCache entries Apply reads, so a previewed background is reused,
 * not bought twice; they are only saved on Apply. Rings and backgrounds use
 * the generation's model settings, or a generation preset picked at the top
 * of the window.
 */

import {
  MODULE_ID,
  MODULE_NAME,
  LIMITS,
  TOKEN_FRAMING,
  RING_INNER_RADIUS,
  CUSTOM_RING_BACKGROUND_OVERLAP,
  OVERLAP_MASK_SIZE,
  OVERLAP_BRUSH
} from './constants.js';
import { ImageFileHandler } from './file-handler.js';
import { RunwarePresetConfig } from './preset-config.js';
import {
  generateRing,
  removeBackground,
  generateBackground,
  getBackgroundRequest,
  SUBJECT_CACHE_KEY,
  getDefaultPrompts,
  summarizePaidCalls,
  clampDimension,
  tokenBackgroundSize,
  loadPresets,
  hasImageModel
} from './asset-generation.js';
import {
  getDynamicRingInfo,
  parseHexColor,
  clampSubjectScale,
  clampTokenFraming
} from './token-ring.js';
import { toDataURI } from './image-compositor.js';
import { getRunwareErrorMessage } from './runware-errors.js';

const PORTRAIT_BACKGROUNDS = ['keep', 'remove', 'generate'];
const TOKEN_BACKGROUNDS = ['transparent', 'solid', 'generate'];
const NEW_RING = 'new';
const RING_KEY_PREFIX = 'ring:';
// Ids of windows between wait() and settling; see wait().
const PENDING_IDS = new Set();
// Preview-only fallback for the dynamic ring band when no colour is chosen.
const PREVIEW_RING_COLOR = '#8a8f98';
// Zoom factor per wheel pixel (a typical notch is 100px).
const WHEEL_ZOOM_SPEED = 0.0015;
// Data URI per assetCache entry, so refreshing the preview on every keystroke
// never re-encodes a multi-megabyte image. Entries are replaced, not mutated.
const ENTRY_URIS = new WeakMap();
// The source each preview element was last given, see setImageSource().
const SHOWN_SOURCES = new WeakMap();
// The mask-image each overlap preview was last given, see setMaskImage().
const SHOWN_MASKS = new WeakMap();
// The overlap mask is painted in this colour, which only shows as the tint
// while painting: the compositor and the CSS mask read its alpha alone.
const OVERLAP_PAINT_COLOR = 'rgb(255, 70, 70)';
// Undo steps kept for the overlap mask, one ImageData (1 MB at 512 px) each.
const OVERLAP_UNDO_LIMIT = 20;
const FRAMING_HINT = 'Drag to move, scroll to zoom.';
const FRAMING_TITLE = 'Drag to move, scroll to zoom, double-click to reset';
const PAINTING_HINT = 'Painting. Leave paint mode to move or zoom.';
const PAINTING_TITLE = 'Paint the parts that pass over the ring';
// What each in-dialog paid call blocks closing with, see close().
const ASSET_TASK_MESSAGES = {
  ring: 'Please wait until the ring is generated.',
  background: 'Please wait until the background preview finishes.'
};

/**
 * Application id for an actor's output dialog. Same key as getImageDialogId()
 * in dialog.js, so each actor gets exactly one "Use this image" window.
 * @param {Actor} actor
 * @returns {string}
 */
export function getOutputDialogId(actor) {
  const key = String(actor?.uuid ?? actor?.id ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');
  return `runware-output-dialog-${key}`;
}

/**
 * Display name for a ring file: the decoded basename of its data path.
 */
function getRingName(path) {
  const basename = String(path).split('/').pop() ?? '';
  try {
    return decodeURIComponent(basename);
  } catch {
    return basename;
  }
}

/**
 * One line describing ModelParams for the model note, e.g.
 * "civitai:4384@128713 · 30 steps · CFG 7 · LoRA civitai:1@2 (0.8)".
 */
function describeModelParams(modelParams) {
  const params = modelParams ?? {};
  const parts = [params.model || 'No model set'];
  if (params.steps !== undefined && params.steps !== null) parts.push(`${params.steps} steps`);
  if (params.CFGScale !== undefined && params.CFGScale !== null) parts.push(`CFG ${params.CFGScale}`);
  for (const lora of Array.isArray(params.lora) ? params.lora : []) {
    parts.push(`LoRA ${lora?.model} (${lora?.weight})`);
  }
  if (params.vae) parts.push(`VAE ${params.vae}`);
  const embeddings = Array.isArray(params.embeddings) ? params.embeddings.length : 0;
  if (embeddings > 0) parts.push(`${embeddings} embedding${embeddings === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/**
 * parseHexColor() without the throw, for the preview: invalid input just
 * falls back to the ring default there. _readPlan() reports the real error.
 */
function tryParseHexColor(value) {
  try {
    return parseHexColor(value);
  } catch {
    return null;
  }
}

/** Data URI of an assetCache entry's image, or '' (see ENTRY_URIS). */
function getEntryURI(entry) {
  if (!entry?.imageData) return '';
  let uri = ENTRY_URIS.get(entry);
  if (uri === undefined) {
    uri = toDataURI(entry.imageData);
    ENTRY_URIS.set(entry, uri);
  }
  return uri;
}

/**
 * Set the portrait preview's background layer (a CSS variable its <img>
 * paints as a cover background, see module.css), or clear it. Same
 * change-only rule as setImageSource().
 */
function setBackgroundVariable(element, uri) {
  if (SHOWN_SOURCES.get(element) === uri) return;
  SHOWN_SOURCES.set(element, uri);
  if (uri) {
    element.style.setProperty('--runware-preview-bg', `url("${uri}")`);
  } else {
    element.style.removeProperty('--runware-preview-bg');
  }
}

/**
 * Point an <img> at `source`, or clear it. Only touches src when it changes,
 * so typing doesn't reload the image; the comparison is against the string
 * last set (SHOWN_SOURCES), not the multi-megabyte attribute read back.
 */
function setImageSource(img, source) {
  if (SHOWN_SOURCES.get(img) === source) return;
  SHOWN_SOURCES.set(img, source);
  if (source) {
    img.src = source;
  } else {
    img.removeAttribute('src');
  }
}

/**
 * Set an overlap preview's CSS mask to `uri`, or clear it. Same change-only
 * rule as setImageSource().
 */
function setMaskImage(element, uri) {
  if (SHOWN_MASKS.get(element) === uri) return;
  SHOWN_MASKS.set(element, uri);
  for (const property of ['mask-image', '-webkit-mask-image']) {
    if (uri) {
      element.style.setProperty(property, `url("${uri}")`);
    } else {
      element.style.removeProperty(property);
    }
  }
}

/** Overlap brush diameter in mask px, clamped to OVERLAP_BRUSH. */
function clampBrushSize(value) {
  const { min, max, fallback } = OVERLAP_BRUSH;
  const number = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/**
 * Content key of the overlap mask: a 53-bit hash (cyrb53) of its alpha
 * channel, or null when nothing is painted. Equal masks get equal keys; the
 * colour is ignored like everywhere else the mask is used.
 * @param {Uint8ClampedArray} data - RGBA pixels
 * @returns {string|null}
 */
function hashMaskAlpha(data) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  let painted = false;
  for (let i = 3; i < data.length; i += 4) {
    const alpha = data[i];
    if (alpha) painted = true;
    h1 = Math.imul(h1 ^ alpha, 2654435761);
    h2 = Math.imul(h2 ^ alpha, 1597334677);
  }
  if (!painted) return null;
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export class RunwareOutputDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  constructor(options = {}) {
    super({ id: getOutputDialogId(options.actor), ...options });

    // Keep the caller's references (ApplicationV2 clones plain option objects).
    this.actor = options.actor;
    this.imageData = options.imageData ?? null;
    this.canGoBack = !!options.canGoBack;
    // The generation's settings: the default for rings and backgrounds, see
    // _currentModelParams().
    this.modelParams = options.modelParams ?? null;
    this.portraitSize = options.portraitSize ?? null;
    this.generationPrompt = typeof options.generationPrompt === 'string' ? options.generationPrompt : '';
    this.defaults = options.defaults ?? {};
    this.onApply = options.onApply;

    // Paid results (subject removal, backgrounds, generated rings) and their
    // saved paths, keyed like asset-generation.js's cache keys. It outlives a
    // failed Apply, so a retry never pays for the same thing twice. module.js
    // passes one in so the results also survive "Back to images".
    this.assetCache = options.assetCache instanceof Map ? options.assetCache : new Map();

    this._busy = false;            // Apply is running
    // The in-dialog paid call that is running: 'ring' ("Generate ring"),
    // 'background' ("Preview background"), or null. See _isWorking().
    this._assetTask = null;
    // Data URI of the last background each preview showed from the cache. It
    // stays on screen, marked outdated, once the prompt or model no longer
    // matches it; see _getBackgroundPreview().
    this._lastBackgroundURIs = { portrait: '', token: '' };
    this._originalURI = '';        // the picked image, set on first render
    this._ringCounter = 0;
    this._generatedRingKey = null;
    this._generatedRingURI = '';
    this._restoreGeneratedRing();
    this._result = null;
    this._resolve = null;
    this._settled = false;
    this._listenersBound = false;
    // The world's generation presets offered by the model select, see loadPresets().
    this._presets = [];
    this._presetsHookId = null;
    this._handlePresetsUpdated = this._handlePresetsUpdated.bind(this);
    // Where the subject sits in the token, see TOKEN_FRAMING. Edited with the
    // mouse on the token preview, baked into the token image on Apply.
    this._tokenFraming = clampTokenFraming(null);
    this._drag = null;
    this._framingTarget = null;
    this._handleFormChange = this._handleFormChange.bind(this);
    this._onFramingPointerDown = this._onFramingPointerDown.bind(this);
    this._onFramingPointerMove = this._onFramingPointerMove.bind(this);
    this._onFramingPointerUp = this._onFramingPointerUp.bind(this);
    this._onFramingWheel = this._onFramingWheel.bind(this);
    this._onFramingDoubleClick = this._onFramingDoubleClick.bind(this);
    this._onFramingPointerLeave = this._onFramingPointerLeave.bind(this);
    // Ring overlap mask: painted in paint mode on the token preview's mask
    // canvas (OVERLAP_MASK_SIZE, the subject's box), see _getOverlapMask().
    this._painting = false;
    this._overlapTool = 'brush';       // 'brush' | 'eraser'
    this._stroke = null;               // the stroke being painted
    this._overlapUndo = [];            // ImageData before each change, newest last
    this._overlapRevision = 0;         // bumped on every change of the mask
    this._overlapMask = null;          // {revision, key, src} of the last read
    this._onOverlapKeyDown = this._onOverlapKeyDown.bind(this);
    this._setStatus = this._setStatus.bind(this);
  }

  static DEFAULT_OPTIONS = {
    classes: ['runware-output-dialog'],
    tag: 'form',
    window: {
      title: 'Use this image',
      frame: true,
      positioned: true,
      resizable: true,
      minimizable: false
    },
    actions: {
      apply: RunwareOutputDialog.prototype._onApply,
      back: RunwareOutputDialog.prototype._onBack,
      cancel: RunwareOutputDialog.prototype._onCancel,
      clearOverlap: RunwareOutputDialog.prototype._onClearOverlap,
      generateRing: RunwareOutputDialog.prototype._onGenerateRing,
      managePresets: RunwareOutputDialog.prototype._onManagePresets,
      previewBackground: RunwareOutputDialog.prototype._onPreviewBackground,
      resetTokenFraming: RunwareOutputDialog.prototype._onResetTokenFraming,
      setOverlapTool: RunwareOutputDialog.prototype._onSetOverlapTool,
      toggleOverlapPaint: RunwareOutputDialog.prototype._onToggleOverlapPaint,
      undoOverlap: RunwareOutputDialog.prototype._onUndoOverlap
    },
    form: {
      handler: RunwareOutputDialog.prototype._onSubmit,
      closeOnSubmit: false,
      submitOnChange: false
    },
    position: {
      width: 880,
      height: 'auto'
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/output-dialog.hbs`
    }
  };

  /**
   * Open the output step for an actor and wait for the user's decision.
   * If the actor already has one open, that window is brought to the front
   * and this call resolves 'cancelled'.
   * @param {Object} options
   * @param {Actor} options.actor
   * @param {Object} options.imageData - the picked Runware image `{ imageBase64Data, imageUUID?, imageURL? }`
   * @param {boolean} [options.canGoBack] - show "Back to images"
   * @param {Object} options.modelParams - the generation's ModelParams: the default
   *   for rings and backgrounds, unless a preset is picked in the window
   * @param {{width: number, height: number}} options.portraitSize
   * @param {string} [options.generationPrompt]
   * @param {{portraitBackground?: 'keep'|'remove'}} [options.defaults]
   * @param {(plan: Object, context: {setStatus: Function, cache: Map}) => Promise} options.onApply
   *   does the work; a rejection keeps the dialog open with the error shown
   * @returns {Promise<'applied'|'back'|'cancelled'>}
   */
  static wait(options = {}) {
    const id = getOutputDialogId(options.actor);
    const existing = foundry.applications.instances?.get(id);
    if (existing) {
      existing.bringToFront?.();
      return Promise.resolve('cancelled');
    }

    // The window only shows up in foundry.applications.instances once its
    // async first render has finished, so also track ids being opened: a
    // second app with the same id would replace the first one's DOM without
    // ever settling its promise.
    if (PENDING_IDS.has(id)) return Promise.resolve('cancelled');
    PENDING_IDS.add(id);

    return new Promise((resolve) => {
      const dialog = new RunwareOutputDialog({
        ...options,
        id,
        window: { title: `Use this image: ${options.actor?.name ?? 'Unknown actor'}` }
      });
      dialog._resolve = (result) => {
        PENDING_IDS.delete(id);
        resolve(result);
      };
      dialog.render({ force: true }).catch((error) => {
        console.error(`${MODULE_NAME} | Failed to open the output dialog:`, error);
        ui.notifications.error(`${MODULE_NAME}: Could not open the "Use this image" window - ${getRunwareErrorMessage(error)}`);
        dialog._settle('cancelled');
        if (dialog.rendered) dialog.close({ runwareForce: true }).catch(() => {});
      });
    });
  }

  async _prepareContext(options) {
    const dynamicRing = getDynamicRingInfo();
    const { presets, loaded: presetsLoaded } = loadPresets();
    this._presets = presets;

    let ringPaths = [];
    try {
      ringPaths = await ImageFileHandler.listRings();
    } catch (error) {
      // listRings() already swallows its own failures; an empty picker is fine.
      console.debug(`${MODULE_NAME} | Could not list rings:`, error);
    }
    const rings = (Array.isArray(ringPaths) ? ringPaths : [])
      .filter((path) => typeof path === 'string' && path)
      .map((path) => ({ path, name: getRingName(path) }));

    const defaultPortraitBackground = PORTRAIT_BACKGROUNDS.includes(this.defaults?.portraitBackground)
      ? this.defaults.portraitBackground
      : 'keep';
    const defaultTokenRing = dynamicRing.available ? 'dynamic' : 'none';

    const portraitBackgroundOptions = [
      { value: 'keep', label: 'Keep original' },
      { value: 'remove', label: 'Remove background' },
      { value: 'generate', label: 'Generate new background' }
    ].map((option) => ({ ...option, checked: option.value === defaultPortraitBackground }));

    const tokenRingOptions = [
      { value: 'none', label: 'No ring' },
      dynamicRing.available ? { value: 'dynamic', label: 'Foundry dynamic ring' } : null,
      { value: 'custom', label: 'Custom ring' }
    ]
      .filter(Boolean)
      .map((option) => ({ ...option, checked: option.value === defaultTokenRing }));

    return {
      actorName: this.actor?.name ?? '',
      canGoBack: this.canGoBack,
      dynamicRing,
      rings,
      defaultPortraitBackground,
      defaultTokenRing,
      portraitBackgroundOptions,
      tokenRingOptions,
      transparentLabel: defaultTokenRing === 'dynamic' ? 'Ring default' : 'Transparent',
      ...getDefaultPrompts({ generationPrompt: this.generationPrompt }),
      generationPrompt: this.generationPrompt.trim(),
      subjectScale: LIMITS.subjectScale,
      overlapBrush: OVERLAP_BRUSH,
      generationModel: this.modelParams?.model ?? '',
      assetPresets: this._presets.map(({ id, name }) => ({ id, name })),
      presetsLoaded,
      canManagePresets: !!game.user?.isGM
    };
  }

  /*
   * The window renders exactly once. Every later change (visibility,
   * preview, Apply label, generated ring) is plain DOM work, because a
   * re-render would wipe the user's edits and the generated previews.
   */
  async _onRender(context, options) {
    if (super._onRender) await super._onRender(context, options);
    if (this.element instanceof HTMLFormElement) {
      this.element.setAttribute('autocomplete', 'off');
    }
    if (this._listenersBound || !(this.element instanceof HTMLElement)) return;

    this.element.addEventListener('change', this._handleFormChange);
    this.element.addEventListener('input', this._handleFormChange);
    this.element.addEventListener('keydown', this._onOverlapKeyDown);
    this._bindFramingListeners(this.element.querySelector('[data-token-framing]'));
    this._listenersBound = true;
    // Sizing a canvas clears it, so only here, before anything is painted.
    const maskCanvas = this._overlapCanvas();
    if (maskCanvas) {
      maskCanvas.width = OVERLAP_MASK_SIZE;
      maskCanvas.height = OVERLAP_MASK_SIZE;
    }
    if (this._presetsHookId === null) {
      this._presetsHookId = Hooks.on('runware-imagegen.presetsUpdated', this._handlePresetsUpdated);
    }

    // Base64 previews are set through the DOM, never through template HTML
    // (_updatePreview() fills the portrait and token from this and the cache).
    // The Runware URL is only a fallback for display; nothing is drawn from it.
    this._originalURI = toDataURI(this.imageData) || this.imageData?.imageURL || '';
    if (this._generatedRingURI) {
      this._showGeneratedRing();
      const newRingRadio = this.element.querySelector(`input[name="customRing"][value="${NEW_RING}"]`);
      if (newRingRadio) newRingRadio.checked = true;
    }
    this._refresh();
  }

  _onClose(options) {
    super._onClose(options);
    if (this._listenersBound && this.element instanceof HTMLElement) {
      this.element.removeEventListener('change', this._handleFormChange);
      this.element.removeEventListener('input', this._handleFormChange);
      this.element.removeEventListener('keydown', this._onOverlapKeyDown);
    }
    this._bindFramingListeners(null);
    this._listenersBound = false;
    if (this._presetsHookId !== null) {
      Hooks.off('runware-imagegen.presetsUpdated', this._presetsHookId);
      this._presetsHookId = null;
    }
    this._settle(this._result ?? 'cancelled');
  }

  /**
   * Whether Apply, a ring generation or a background preview is running.
   * Each blocks the others, closing, "Back to images", the token framing and
   * the overlap painting.
   */
  _isWorking() {
    return this._busy || this._assetTask !== null;
  }

  /**
   * Block X, Escape, Cancel and Back while Apply, a ring generation or a
   * background preview is running: the work would carry on without anyone
   * to report it to. Internal closes pass `runwareForce`.
   */
  async close(options = {}) {
    if (this._isWorking() && !options?.runwareForce) {
      const message = this._busy
        ? 'Please wait until Apply finishes.'
        : ASSET_TASK_MESSAGES[this._assetTask];
      ui.notifications.warn(`${MODULE_NAME}: ${message}`);
      return this;
    }
    return super.close(options);
  }

  _settle(result) {
    if (this._settled) return;
    this._settled = true;
    this._resolve?.(result);
  }

  async _onApply(event, target) {
    event.preventDefault();
    if (this._isWorking()) return;

    const { plan, errors } = this._readPlan();
    if (errors.length > 0) {
      this._showError(errors[0]);
      return;
    }

    this._busy = true;
    this._setControlsDisabled(true);
    this._showError(null);
    this._setStatus('Applying…');

    try {
      if (typeof this.onApply !== 'function') {
        throw new Error('Nothing to apply the image with.');
      }
      await this.onApply(plan, { setStatus: this._setStatus, cache: this.assetCache });
    } catch (error) {
      console.error(`${MODULE_NAME} | Applying the image failed:`, error);
      // The executor never notifies; reporting is this dialog's job.
      const message = getRunwareErrorMessage(error);
      this._busy = false;
      if (this.rendered) {
        this._showError(message);
        this._setControlsDisabled(false);
        this._setStatus(null);
        this._refresh(); // The cache may now hold paid results, which changes the Apply label
      }
      ui.notifications.error(`${MODULE_NAME}: ${message}`);
      return;
    }

    this._result = 'applied';
    try {
      await this.close({ runwareForce: true });
    } finally {
      this._settle(this._result);
    }
  }

  async _onBack(event, target) {
    event.preventDefault();
    if (this._isWorking()) return;
    this._result = 'back';
    await this.close();
  }

  async _onCancel(event, target) {
    event.preventDefault();
    await this.close();
  }

  /**
   * One of the two paid calls this dialog makes itself (with
   * _onPreviewBackground): one image generation plus one background removal
   * (see generateRing() in asset-generation.js). The ring stays in
   * assetCache; module.js saves it on Apply.
   */
  async _onGenerateRing(event, target) {
    event.preventDefault();
    if (this._isWorking()) return;

    const prompt = this._value('ringPrompt').trim();
    const invalid = prompt ? this._modelError() : 'Enter a ring prompt.';
    if (invalid) {
      this._showError(invalid);
      return;
    }

    this._assetTask = 'ring';
    this._setControlsDisabled(true);
    this._showError(null);
    this._setStatus('Generating ring…');

    try {
      const ring = await generateRing({
        prompt,
        negativePrompt: this._value('ringNegativePrompt').trim(),
        modelParams: this._currentModelParams(),
        onStatus: this._setStatus
      });

      // A regenerated ring gets a fresh key, so a path saved for the previous
      // one by a failed Apply is never reused for the new image.
      if (this._generatedRingKey) this.assetCache.delete(this._generatedRingKey);
      const key = `${RING_KEY_PREFIX}${++this._ringCounter}`;
      this.assetCache.set(key, { imageData: ring, savedPath: null });
      this._generatedRingKey = key;
      this._generatedRingURI = toDataURI(ring);
      this._showGeneratedRing();
    } catch (error) {
      console.error(`${MODULE_NAME} | Ring generation failed:`, error);
      const message = getRunwareErrorMessage(error);
      if (this.rendered) this._showError(message);
      ui.notifications.error(`${MODULE_NAME}: ${message}`);
    } finally {
      this._assetTask = null;
      if (this.rendered) {
        this._setControlsDisabled(false);
        this._setStatus(null);
        this._refresh();
      }
    }
  }

  /**
   * "Preview background" / "Regenerate background" for the portrait or the
   * token (`data-target`). Paid: the subject's background removal unless it
   * is already cached (Apply needs it for any generated background anyway),
   * plus one background generation. Both land in the assetCache entries Apply
   * reads, so a previewed background is reused on Apply, not bought again;
   * like a generated ring, it is only saved on Apply.
   */
  async _onPreviewBackground(event, target) {
    event.preventDefault();
    if (this._isWorking()) return;

    const output = target?.dataset?.target === 'token' ? 'token' : 'portrait';
    // Read once: the result is stored under this key even if the form
    // changes meanwhile (it is disabled, but a preset update can still land).
    const request = getBackgroundRequest(this._readPlan().plan, output);
    if (!request) return;
    // Both checks are free; refuse before the paid removal, not after it.
    const invalid = request.prompt ? this._modelError() : `Enter a background prompt for the ${output}.`;
    if (invalid) {
      this._showError(invalid);
      return;
    }

    this._assetTask = 'background';
    this._setControlsDisabled(true);
    this._showError(null);

    try {
      if (!this.assetCache.get(SUBJECT_CACHE_KEY)?.imageData) {
        this._setStatus('Removing background…');
        const subject = await removeBackground(this.imageData);
        this.assetCache.set(SUBJECT_CACHE_KEY, { imageData: subject, savedPath: null });
      }

      this._setStatus('Generating background…');
      const { key, ...params } = request;
      const background = await generateBackground(params);
      // Always a new entry object: a replaced one may be shared with the other
      // images' caches (see module.js getAssetCache()) and carry the saved
      // path of the previous image.
      this.assetCache.set(key, { imageData: background, savedPath: null });
    } catch (error) {
      console.error(`${MODULE_NAME} | Background preview failed:`, error);
      const message = getRunwareErrorMessage(error);
      if (this.rendered) this._showError(message);
      ui.notifications.error(`${MODULE_NAME}: ${message}`);
    } finally {
      this._assetTask = null;
      if (this.rendered) {
        this._setControlsDisabled(false);
        this._setStatus(null);
        // Also after a failure: a removed subject may be cached by now.
        this._refresh();
      }
    }
  }

  /**
   * Open the GM's preset manager, or bring an open one to the front (a second
   * copy would discard the first one's unsaved edits). Saving there fires
   * `presetsUpdated`, which refreshes the model select.
   */
  async _onManagePresets(event, target) {
    event.preventDefault();
    if (!game.user?.isGM) return;
    const existing = foundry.applications.instances?.get(RunwarePresetConfig.DEFAULT_OPTIONS.id);
    if (existing) {
      existing.bringToFront?.();
      return;
    }
    try {
      await new RunwarePresetConfig().render({ force: true });
    } catch (error) {
      console.error(`${MODULE_NAME} | Failed to open the preset manager:`, error);
      ui.notifications.error(`${MODULE_NAME}: Could not open the preset manager - ${getRunwareErrorMessage(error)}`);
    }
  }

  /**
   * The GM changed the presets: rebuild the select's options in place (no
   * re-render), keeping the selection while that preset still exists. A
   * removed or changed selected preset is reported, never swapped silently
   * for another model. A failed read keeps the current list and selection.
   * The refresh reprices Apply, since background cache keys include the model.
   * @param {Array<Object>} value - the new `generationPresets` setting
   */
  _handlePresetsUpdated(value) {
    const { presets, loaded } = loadPresets(value);
    const root = this.element;
    const loadError = root?.querySelector?.('[data-asset-presets-error]');
    if (loadError) loadError.hidden = loaded;
    if (!loaded) {
      this._refresh();
      return;
    }

    const previous = this._selectedPreset();
    this._presets = presets;

    let warning = null;
    const select = this._field('assetPreset');
    if (select instanceof HTMLSelectElement) {
      const selected = select.value;
      for (const option of Array.from(select.options)) {
        if (option.value) option.remove();
      }
      for (const preset of this._presets) select.add(new Option(preset.name, preset.id));
      const current = this._presets.find((preset) => preset.id === selected) ?? null;
      select.value = current ? selected : '';

      if (previous && !current) {
        warning = `The preset "${previous.name}" was removed; rings and backgrounds now use the generation's model.`;
      } else if (previous && JSON.stringify(previous.modelParams) !== JSON.stringify(current.modelParams)) {
        // Their cache keys include the model, so they no longer match.
        warning = `The preset "${current.name}" was changed; background previews made with it are outdated.`;
      }
    }
    const empty = root?.querySelector?.('[data-asset-presets-empty]');
    if (empty) empty.hidden = this._presets.length > 0;

    this._refresh();
    if (warning) {
      ui.notifications.warn(`${MODULE_NAME}: ${warning}`);
      if (!this._isWorking()) this._showError(warning);
    }
  }

  /** The preset picked in the model select, or null for "Same as generation". */
  _selectedPreset() {
    const id = this._value('assetPreset');
    return id ? this._presets.find((preset) => preset.id === id) ?? null : null;
  }

  /**
   * ModelParams for everything this window generates, read at request time:
   * the picked preset's, or the generation's. Never null; check _modelError()
   * before paying for anything with them.
   * @returns {Object}
   */
  _currentModelParams() {
    return this._selectedPreset()?.modelParams ?? this.modelParams ?? {};
  }

  /**
   * Why rings and backgrounds can't be generated with the current model
   * selection, or null: a picked preset that no longer exists (never fall
   * back to another model silently), or no model at all.
   * @returns {string|null}
   */
  _modelError() {
    if (this._value('assetPreset') && !this._selectedPreset()) {
      return 'The selected preset no longer exists. Pick another model.';
    }
    if (!hasImageModel(this._currentModelParams())) {
      return 'No image model is set for rings and backgrounds. Pick a preset.';
    }
    return null;
  }

  /** Describe the model selection under the select (DOM only). */
  _updateModelNote() {
    const root = this.element;
    const preset = this._selectedPreset();

    const note = root.querySelector('[data-asset-model-note]');
    if (note) {
      note.textContent = this._value('assetPreset') && !preset
        ? 'The selected preset no longer exists.'
        : describeModelParams(this._currentModelParams());
    }

    // The generation form prepends a preset's trigger; asset prompts are the user's own.
    const hint = root.querySelector('[data-asset-lora-hint]');
    if (hint) {
      hint.textContent = preset?.loraTrigger
        ? `The LoRA trigger "${preset.loraTrigger}" is not added automatically - add it to the ring and background prompts if you want it.`
        : '';
      hint.hidden = !preset?.loraTrigger;
    }
  }

  /**
   * Pick up the newest ring generated in an earlier window for the same
   * images (the cache survives "Back to images"), and continue its key
   * numbering so a new ring can't overwrite it.
   */
  _restoreGeneratedRing() {
    for (const [key, entry] of this.assetCache) {
      if (!key.startsWith(RING_KEY_PREFIX) || !entry?.imageData) continue;
      const number = Number(key.slice(RING_KEY_PREFIX.length));
      if (!Number.isFinite(number) || number <= this._ringCounter) continue;
      this._ringCounter = number;
      this._generatedRingKey = key;
      this._generatedRingURI = toDataURI(entry.imageData);
    }
  }

  /** Show the generated ring in the generator preview (DOM only, no re-render). */
  _showGeneratedRing() {
    if (!this._generatedRingURI) return;
    const preview = this.element?.querySelector?.('img[data-preview="generated-ring"]');
    if (preview) {
      preview.src = this._generatedRingURI;
      preview.hidden = false;
    }
    const button = this.element?.querySelector?.('[data-action="generateRing"] [data-generate-ring-label]');
    if (button) button.textContent = 'Regenerate ring (paid: 1 image + 1 background removal)';
  }

  // -------------------------------------------------------------------------
  // Token framing: drag to move, wheel to zoom, double-click to reset. In
  // paint mode the same pointer listeners paint the overlap mask instead.
  // -------------------------------------------------------------------------

  /**
   * Attach the framing (and painting) listeners to the token preview, or
   * detach them from the previous one with `null`. The wheel listener must
   * not be passive, or it couldn't stop the window from scrolling.
   * @param {HTMLElement|null} target
   */
  _bindFramingListeners(target) {
    const previous = this._framingTarget;
    if (previous) {
      previous.removeEventListener('pointerdown', this._onFramingPointerDown);
      previous.removeEventListener('pointermove', this._onFramingPointerMove);
      previous.removeEventListener('pointerup', this._onFramingPointerUp);
      previous.removeEventListener('pointercancel', this._onFramingPointerUp);
      previous.removeEventListener('wheel', this._onFramingWheel);
      previous.removeEventListener('dblclick', this._onFramingDoubleClick);
      previous.removeEventListener('pointerleave', this._onFramingPointerLeave);
    }
    this._framingTarget = target instanceof HTMLElement ? target : null;
    this._drag = null;
    this._stroke = null;
    if (!this._framingTarget) return;
    target.addEventListener('pointerdown', this._onFramingPointerDown);
    target.addEventListener('pointermove', this._onFramingPointerMove);
    target.addEventListener('pointerup', this._onFramingPointerUp);
    target.addEventListener('pointercancel', this._onFramingPointerUp);
    target.addEventListener('wheel', this._onFramingWheel, { passive: false });
    target.addEventListener('dblclick', this._onFramingDoubleClick);
    target.addEventListener('pointerleave', this._onFramingPointerLeave);
  }

  /** Framing is frozen while Apply, a ring generation or a background preview runs. */
  _isFramingLocked() {
    return this._isWorking();
  }

  /**
   * Preview geometry: its edge in px, and the dynamic ring's subject scale,
   * which Foundry applies on top of the baked-in framing.
   */
  _framingGeometry() {
    const size = this._framingTarget?.clientWidth || 1;
    const ringScale = this._radioValue('tokenRing') === 'dynamic'
      ? clampSubjectScale(this._value('subjectScale'))
      : 1;
    return { size, ringScale };
  }

  _onFramingPointerDown(event) {
    if (this._painting) {
      this._onPaintPointerDown(event);
      return;
    }
    if (event.button !== 0 || this._isFramingLocked()) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    target.classList.add('dragging');
    this._drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: this._tokenFraming.offsetX,
      offsetY: this._tokenFraming.offsetY,
      ...this._framingGeometry()
    };
  }

  _onFramingPointerMove(event) {
    if (this._painting || this._stroke) {
      this._onPaintPointerMove(event);
      return;
    }
    const drag = this._drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (this._isFramingLocked()) {
      this._onFramingPointerUp(event);
      return;
    }
    // Screen px -> token fraction; the dynamic ring's scale magnifies the movement.
    const unit = drag.size * drag.ringScale;
    this._setTokenFraming({
      ...this._tokenFraming,
      offsetX: drag.offsetX + (event.clientX - drag.startX) / unit,
      offsetY: drag.offsetY + (event.clientY - drag.startY) / unit
    });
  }

  _onFramingPointerUp(event) {
    if (this._stroke) {
      this._endStroke(event);
      return;
    }
    if (!this._drag || event.pointerId !== this._drag.pointerId) return;
    const target = event.currentTarget ?? this._framingTarget;
    if (target?.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
    target?.classList.remove('dragging');
    this._drag = null;
  }

  /**
   * Zoom around the cursor: the subject point under it stays put.
   */
  _onFramingWheel(event) {
    // Paint mode doesn't zoom; let the window scroll.
    if (this._painting) return;
    event.preventDefault();
    if (this._isFramingLocked() || !event.deltaY) return;

    // deltaMode 1 = lines, 2 = pages; normalise to px.
    const pixels = event.deltaY * ([1, 16, 400][event.deltaMode] ?? 1);
    const { zoom, offsetX, offsetY } = this._tokenFraming;
    const { min, max } = TOKEN_FRAMING.zoom;
    const nextZoom = Math.min(max, Math.max(min, zoom * Math.exp(-pixels * WHEEL_ZOOM_SPEED)));
    if (nextZoom === zoom) return;

    const { size, ringScale } = this._framingGeometry();
    const rect = event.currentTarget.getBoundingClientRect();
    // Cursor relative to the token centre, in unscaled token fractions.
    const cursorX = (event.clientX - rect.left - rect.width / 2) / (size * ringScale);
    const cursorY = (event.clientY - rect.top - rect.height / 2) / (size * ringScale);
    const ratio = nextZoom / zoom;
    this._setTokenFraming({
      zoom: nextZoom,
      offsetX: cursorX - ratio * (cursorX - offsetX),
      offsetY: cursorY - ratio * (cursorY - offsetY)
    });
  }

  _resetTokenFraming() {
    if (this._isFramingLocked()) return;
    this._setTokenFraming(null);
  }

  /** A double-click in paint mode is two dots, not a reset. */
  _onFramingDoubleClick() {
    if (!this._painting) this._resetTokenFraming();
  }

  async _onResetTokenFraming(event, target) {
    event.preventDefault();
    this._resetTokenFraming();
  }

  _setTokenFraming(framing) {
    this._tokenFraming = clampTokenFraming(framing);
    this._updateFramingPreview();
  }

  /**
   * Position the preview subject like the compositor will: zoomed and shifted
   * inside the token, then (dynamic ring) scaled by Foundry's subject.scale.
   * The overlap subject and the mask canvas (`data-framed`) share the
   * subject's box and get the same transform, so the mask follows the framing.
   * Also cheap enough to run on every pointer move.
   */
  _updateFramingPreview() {
    const root = this.element;
    if (!(root instanceof HTMLElement)) return;
    const { zoom, offsetX, offsetY } = this._tokenFraming;
    const { ringScale } = this._framingGeometry();

    // cqw/cqh are the token preview's edge (a size container, see module.css).
    const transform = `scale(${ringScale}) `
      + `translate(${offsetX * 100}cqw, ${offsetY * 100}cqh) scale(${zoom})`;
    for (const layer of root.querySelectorAll('.runware-token-preview [data-framed]')) {
      layer.style.transform = transform;
    }
    const zoomLabel = root.querySelector('[data-framing-zoom]');
    if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  // -------------------------------------------------------------------------
  // Ring overlap: paint the parts of the subject that pass over the ring
  // -------------------------------------------------------------------------

  /**
   * Whether the overlap mask applies, and its editor is shown: only a subject
   * kept inside a dynamic or custom ring has anything to break out of.
   * @param {Object} state - from _readState()
   */
  _isOverlapOffered(state) {
    return state.tokenEnabled
      && state.clipSubject
      && (state.tokenRing === 'dynamic' || state.tokenRing === 'custom');
  }

  /** The mask canvas, also shown as the tint while painting. */
  _overlapCanvas() {
    return this.element?.querySelector?.('canvas[data-preview="token-overlap-mask"]') ?? null;
  }

  _overlapContext() {
    return this._overlapCanvas()?.getContext('2d', { willReadFrequently: true }) ?? null;
  }

  /**
   * The mask as the plan carries it: `key` is a content hash (null when
   * nothing is painted), `src` a PNG data URI. Read again only after the mask
   * changed, since _readPlan() runs on every keystroke.
   * @returns {{key: string|null, src: string}}
   */
  _getOverlapMask() {
    if (this._overlapMask?.revision === this._overlapRevision) return this._overlapMask;
    const ctx = this._overlapContext();
    if (!ctx) return { key: null, src: '' };
    const key = hashMaskAlpha(ctx.getImageData(0, 0, OVERLAP_MASK_SIZE, OVERLAP_MASK_SIZE).data);
    this._overlapMask = {
      revision: this._overlapRevision,
      key,
      src: key ? ctx.canvas.toDataURL('image/png') : ''
    };
    return this._overlapMask;
  }

  /** Keep the mask as it is now for Undo (bounded, oldest dropped). */
  _pushOverlapUndo(ctx) {
    this._overlapUndo.push(ctx.getImageData(0, 0, OVERLAP_MASK_SIZE, OVERLAP_MASK_SIZE));
    if (this._overlapUndo.length > OVERLAP_UNDO_LIMIT) this._overlapUndo.shift();
  }

  _brushSize() {
    return clampBrushSize(this._value('overlapBrushSize'));
  }

  /**
   * A pointer position in mask px. The mask canvas is only scaled and
   * translated, so its bounding rect maps linearly onto the mask, whatever
   * the zoom, offset, ring scale or custom-ring box.
   * @returns {{x: number, y: number}|null}
   */
  _maskPoint(event) {
    const rect = this._overlapCanvas()?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return null;
    return {
      x: (event.clientX - rect.left) / rect.width * OVERLAP_MASK_SIZE,
      y: (event.clientY - rect.top) / rect.height * OVERLAP_MASK_SIZE
    };
  }

  /**
   * Paint (or erase) a round dot at `from`, or a round line from `from` to
   * `to`, so a fast stroke leaves no gaps between pointer events.
   */
  _paintOverlap(ctx, from, to, size) {
    ctx.save();
    ctx.globalCompositeOperation = this._overlapTool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.fillStyle = OVERLAP_PAINT_COLOR;
    ctx.strokeStyle = OVERLAP_PAINT_COLOR;
    ctx.beginPath();
    if (from === to) {
      ctx.arc(from.x, from.y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.restore();
    this._overlapRevision++;
  }

  _onPaintPointerDown(event) {
    if (event.button !== 0 || this._isWorking() || this._stroke) return;
    const ctx = this._overlapContext();
    const point = this._maskPoint(event);
    if (!ctx || !point) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    // For Ctrl+Z (see _onOverlapKeyDown); keyboard events go to the focus.
    target.focus?.({ preventScroll: true });

    this._pushOverlapUndo(ctx);
    this._stroke = { pointerId: event.pointerId, last: point, size: this._brushSize() };
    this._paintOverlap(ctx, point, point, this._stroke.size);
  }

  _onPaintPointerMove(event) {
    this._moveBrushCursor(event);
    const stroke = this._stroke;
    if (!stroke || event.pointerId !== stroke.pointerId) return;
    if (this._isWorking() || !this._painting) {
      this._endStroke(event);
      return;
    }
    const ctx = this._overlapContext();
    const point = this._maskPoint(event);
    if (!ctx || !point) return;
    this._paintOverlap(ctx, stroke.last, point, stroke.size);
    stroke.last = point;
  }

  /**
   * Finish the stroke and bring the overlap preview and the plan up to date
   * (the masked subject is only refreshed here, not on every move).
   */
  _endStroke(event) {
    if (!this._stroke || event.pointerId !== this._stroke.pointerId) return;
    this._cancelStroke();
    this._refresh();
  }

  /** Stop the stroke where it is; what was painted stays (and can be undone). */
  _cancelStroke() {
    const stroke = this._stroke;
    if (!stroke) return;
    const target = this._framingTarget;
    if (target?.hasPointerCapture?.(stroke.pointerId)) target.releasePointerCapture(stroke.pointerId);
    this._stroke = null;
  }

  _onFramingPointerLeave(event) {
    const cursor = this.element?.querySelector?.('[data-preview="token-overlap-cursor"]');
    if (cursor) cursor.hidden = true;
  }

  /** The brush outline under the pointer, at the brush's size on screen. */
  _moveBrushCursor(event) {
    const cursor = this.element?.querySelector?.('[data-preview="token-overlap-cursor"]');
    if (!cursor) return;
    const target = this._framingTarget;
    const rect = this._overlapCanvas()?.getBoundingClientRect();
    if (!this._painting || this._isWorking() || !target || !rect?.width) {
      cursor.hidden = true;
      return;
    }
    // Screen px -> the preview's own CSS px, in case the window is scaled
    // (ApplicationV2 position.scale, CSS zoom).
    const preview = target.getBoundingClientRect();
    const scale = preview.width / (target.offsetWidth || preview.width || 1) || 1;
    const diameter = this._brushSize() * rect.width / OVERLAP_MASK_SIZE / scale;
    cursor.style.left = `${(event.clientX - preview.left) / scale - target.clientLeft}px`;
    cursor.style.top = `${(event.clientY - preview.top) / scale - target.clientTop}px`;
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.hidden = false;
  }

  /**
   * Enter or leave paint mode. While painting, the preview grows and the
   * pointer paints instead of framing; leaving it is the way to reframe.
   */
  _setPainting(painting) {
    this._cancelStroke();
    this._drag = null;
    this._painting = !!painting;
    if (!this._painting) {
      const cursor = this.element?.querySelector?.('[data-preview="token-overlap-cursor"]');
      if (cursor) cursor.hidden = true;
    }
  }

  async _onToggleOverlapPaint(event, target) {
    event.preventDefault();
    if (this._isWorking()) return;
    this._setPainting(!this._painting);
    this._refresh();
  }

  async _onSetOverlapTool(event, target) {
    event.preventDefault();
    if (this._isWorking()) return;
    this._overlapTool = target?.dataset?.tool === 'eraser' ? 'eraser' : 'brush';
    this._refresh();
  }

  async _onUndoOverlap(event, target) {
    event.preventDefault();
    this._undoOverlap();
  }

  _undoOverlap() {
    if (this._isWorking() || this._stroke) return;
    const ctx = this._overlapContext();
    const previous = this._overlapUndo.pop();
    if (!ctx || !previous) return;
    ctx.putImageData(previous, 0, 0);
    this._overlapRevision++;
    this._refresh();
  }

  async _onClearOverlap(event, target) {
    event.preventDefault();
    if (this._isWorking() || this._stroke) return;
    const ctx = this._overlapContext();
    if (!ctx || !this._getOverlapMask().key) return;
    this._pushOverlapUndo(ctx);
    ctx.clearRect(0, 0, OVERLAP_MASK_SIZE, OVERLAP_MASK_SIZE);
    this._overlapRevision++;
    this._refresh();
  }

  /**
   * Ctrl+Z (Cmd+Z) undoes a stroke while painting. Stopped here so Foundry's
   * own undo doesn't also act on the canvas; a text field keeps its own undo.
   */
  _onOverlapKeyDown(event) {
    if (!this._painting || this._isWorking()) return;
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
    if (String(event.key).toLowerCase() !== 'z') return;
    const target = event.target;
    const editsText = target instanceof HTMLTextAreaElement
      || (target instanceof HTMLElement && target.isContentEditable)
      || (target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'color'].includes(target.type));
    if (editsText) return;
    event.preventDefault();
    event.stopPropagation();
    this._undoOverlap();
  }

  /** Sync the overlap editor and the preview's paint mode (DOM only). */
  _updateOverlapControls() {
    const root = this.element;
    const painting = this._painting;

    const token = root.querySelector('.runware-token-preview');
    if (token) {
      token.toggleAttribute('data-painting', painting);
      token.title = painting ? PAINTING_TITLE : FRAMING_TITLE;
    }
    const hint = root.querySelector('[data-framing-hint]');
    if (hint) hint.textContent = painting ? PAINTING_HINT : FRAMING_HINT;

    const toggle = root.querySelector('[data-action="toggleOverlapPaint"]');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(painting));
      const label = toggle.querySelector('[data-overlap-paint-label]');
      if (label) label.textContent = painting ? 'Done painting' : 'Paint overlap';
    }
    const tools = root.querySelector('[data-overlap-tools]');
    if (tools) tools.hidden = !painting;
    for (const button of root.querySelectorAll('[data-action="setOverlapTool"]')) {
      button.setAttribute('aria-pressed', String(button.dataset.tool === this._overlapTool));
    }

    const painted = !!this._getOverlapMask().key;
    const undo = root.querySelector('[data-action="undoOverlap"]');
    if (undo) undo.disabled = this._overlapUndo.length === 0;
    const clear = root.querySelector('[data-action="clearOverlap"]');
    if (clear) clear.disabled = !painted;

    const status = root.querySelector('[data-overlap-status]');
    if (status) {
      const parts = [painted
        ? 'The painted parts are drawn over the ring.'
        : 'Nothing painted: the whole character stays inside the ring.'];
      // Same size as the removed subject, so the mask still fits it on Apply.
      if (!this.assetCache.get(SUBJECT_CACHE_KEY)?.imageData) {
        parts.push('The preview shows the original image; its background is removed on Apply.');
      }
      status.textContent = parts.join(' ');
    }
  }

  async _onSubmit(event, form, formData) {
    event?.preventDefault();
    event?.stopPropagation();

    // Apply is a data-action button; this only swallows an Enter-key submit.
    return;
  }

  /**
   * The single change/input listener: sync the colour swatches, then run the
   * refresh pipeline.
   */
  _handleFormChange(event) {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.colorSwatch) {
      // Swatch -> its text input (the text input is the source of truth).
      const text = this._field(target.dataset.colorSwatch);
      if (text) text.value = target.value;
    } else if (target instanceof HTMLInputElement && target.dataset.colorText !== undefined) {
      // Text input -> swatch, whenever it holds a valid colour.
      const parsed = tryParseHexColor(target.value);
      const swatch = this.element?.querySelector?.(`input[data-color-swatch="${target.name}"]`);
      if (parsed && swatch) swatch.value = parsed;
    }

    // Show the value that will actually be used instead of silently clamping it.
    if (event.type === 'change' && target instanceof HTMLInputElement && target.name === 'subjectScale') {
      target.value = String(clampSubjectScale(target.value));
    }

    if (!this._isWorking()) this._showError(null);
    this._refresh();
  }

  _refresh() {
    if (!(this.element instanceof HTMLElement)) return;
    this._normalizeForm();
    const state = this._readState();
    // Paint mode ends with its editor: the mask is kept, just not applied.
    if (this._painting && !this._isOverlapOffered(state)) this._setPainting(false);
    const { plan } = this._readPlan();
    this._syncVisibility(state);
    this._updateOverlapControls();
    this._updatePreview(state, plan);
    this._updateModelNote();
    this._updateBackgroundButtons(plan);
    this._updateApplyLabel(plan);
  }

  /**
   * A solid token background is a dynamic ring feature (ring.colors.background);
   * fall back to transparent when the user switches to another ring.
   */
  _normalizeForm() {
    if (this._radioValue('tokenBackground') === 'solid' && this._radioValue('tokenRing') !== 'dynamic') {
      const transparent = this.element.querySelector('input[name="tokenBackground"][value="transparent"]');
      if (transparent) transparent.checked = true;
    }
  }

  _readState() {
    return {
      portraitEnabled: this._checked('portraitEnabled'),
      portraitBackground: this._radioValue('portraitBackground'),
      portraitBackgroundPrompt: this._value('portraitBackgroundPrompt'),
      portraitBackgroundNegativePrompt: this._value('portraitBackgroundNegativePrompt'),
      tokenEnabled: this._checked('tokenEnabled'),
      tokenRing: this._radioValue('tokenRing'),
      clipSubject: this._checked('clipSubject'),
      ringColor: this._value('ringColor'),
      subjectScale: this._value('subjectScale'),
      customRing: this._radioValue('customRing'),
      tokenBackground: this._radioValue('tokenBackground'),
      tokenBackgroundColor: this._value('tokenBackgroundColor'),
      sameBackgroundAsPortrait: this._checked('sameBackgroundAsPortrait'),
      tokenBackgroundPrompt: this._value('tokenBackgroundPrompt'),
      tokenBackgroundNegativePrompt: this._value('tokenBackgroundNegativePrompt')
    };
  }

  /**
   * Whether "Use the portrait's background" is offered at all: both outputs
   * must be generating a background.
   */
  _isSameBackgroundOffered(state) {
    return state.tokenBackground === 'generate'
      && state.portraitEnabled
      && state.portraitBackground === 'generate';
  }

  _syncVisibility(state) {
    const sameBackgroundOffered = this._isSameBackgroundOffered(state);
    const visible = {
      'portrait-body': state.portraitEnabled,
      'portrait-bg-prompt': state.portraitEnabled && state.portraitBackground === 'generate',
      'token-body': state.tokenEnabled,
      'dynamic-options': state.tokenRing === 'dynamic',
      'clip-subject': state.tokenRing === 'dynamic' || state.tokenRing === 'custom',
      'overlap': this._isOverlapOffered(state),
      'custom-options': state.tokenRing === 'custom',
      'ring-generator': state.tokenRing === 'custom' && state.customRing === NEW_RING,
      'bg-solid-option': state.tokenRing === 'dynamic',
      'bg-solid-color': state.tokenRing === 'dynamic' && state.tokenBackground === 'solid',
      'same-bg': sameBackgroundOffered,
      'token-bg-prompt': state.tokenBackground === 'generate'
        && !(sameBackgroundOffered && state.sameBackgroundAsPortrait)
    };
    for (const element of this.element.querySelectorAll('[data-section]')) {
      element.hidden = !visible[element.dataset.section];
    }

    // Under a dynamic ring "transparent" means the ring's own default background.
    const transparentLabel = this.element.querySelector('[data-label="token-bg-transparent"]');
    if (transparentLabel) {
      transparentLabel.textContent = state.tokenRing === 'dynamic' ? 'Ring default' : 'Transparent';
    }
  }

  /**
   * The background a preview shows for one output: the cached background of
   * its current request ('fresh', reused on Apply), else the last one it
   * showed, now outdated because the prompt or model changed ('stale', Apply
   * generates a new one), else none. Reverting the edit makes it fresh again.
   * @param {Object} plan - from _readPlan()
   * @param {'portrait'|'token'} output
   * @returns {{state: 'fresh'|'stale'|'none', uri: string}}
   */
  _getBackgroundPreview(plan, output) {
    const request = getBackgroundRequest(plan, output);
    if (!request) return { state: 'none', uri: '' };
    const uri = getEntryURI(this.assetCache.get(request.key));
    if (uri) {
      this._lastBackgroundURIs[output] = uri;
      return { state: 'fresh', uri };
    }
    const last = this._lastBackgroundURIs[output];
    return last ? { state: 'stale', uri: last } : { state: 'none', uri: '' };
  }

  /**
   * Approximate CSS preview: the real images are only built on Apply. The
   * removed subject and generated backgrounds are shown once they are in the
   * cache (a background preview, or a failed Apply).
   * @param {Object} state - from _readState()
   * @param {Object} plan - from _readPlan()
   */
  _updatePreview(state, plan) {
    const root = this.element;
    const subjectURI = getEntryURI(this.assetCache.get(SUBJECT_CACHE_KEY));

    const portraitBlock = root.querySelector('[data-preview-block="portrait"]');
    if (portraitBlock) portraitBlock.hidden = !state.portraitEnabled;

    // The composite is the background cover-fit behind the subject at the
    // original's size: the portrait <img> paints it as its own CSS background.
    const portraitShowsSubject = !!subjectURI && state.portraitBackground !== 'keep';
    const portraitBackground = portraitShowsSubject
      ? this._getBackgroundPreview(plan, 'portrait')
      : { state: 'none', uri: '' };
    const portraitImage = root.querySelector('img[data-preview="portrait"]');
    if (portraitImage) setImageSource(portraitImage, portraitShowsSubject ? subjectURI : this._originalURI);
    const portraitPreview = root.querySelector('.runware-portrait-preview');
    if (portraitPreview) {
      setBackgroundVariable(portraitPreview, portraitBackground.uri);
      portraitPreview.toggleAttribute('data-stale', portraitBackground.state === 'stale');
    }

    const portraitCaption = root.querySelector('[data-preview-caption="portrait"]');
    if (portraitCaption) {
      portraitCaption.textContent = {
        keep: 'Saved as generated',
        remove: subjectURI ? 'Background removed' : 'Background removed on Apply',
        generate: {
          fresh: 'Background previewed, reused on Apply',
          stale: 'Preview outdated: new background generated on Apply',
          none: 'New background generated on Apply'
        }[portraitBackground.state]
      }[state.portraitBackground] ?? '';
    }

    const tokenBlock = root.querySelector('[data-preview-block="token"]');
    if (tokenBlock) tokenBlock.hidden = !state.tokenEnabled;

    const token = root.querySelector('.runware-token-preview');
    if (!token) return;
    const ring = state.tokenRing;
    const background = state.tokenBackground;
    token.dataset.ring = ring;
    token.dataset.background = background;

    const tokenSubject = root.querySelector('img[data-preview="token-subject"]');
    if (tokenSubject) setImageSource(tokenSubject, subjectURI || this._originalURI);

    const tokenBackground = background === 'generate'
      ? this._getBackgroundPreview(plan, 'token')
      : { state: 'none', uri: '' };
    token.toggleAttribute('data-stale', tokenBackground.state === 'stale');

    const tokenBackgroundLayer = root.querySelector('[data-preview="token-bg"]');
    if (tokenBackgroundLayer) {
      tokenBackgroundLayer.hidden = background === 'transparent';
      tokenBackgroundLayer.style.backgroundColor = background === 'solid'
        ? tryParseHexColor(state.tokenBackgroundColor) ?? ''
        : '';
    }
    const placeholder = root.querySelector('[data-preview="token-bg-placeholder"]');
    if (placeholder) placeholder.hidden = !!tokenBackground.uri;
    const tokenBackgroundImage = root.querySelector('img[data-preview="token-bg-image"]');
    if (tokenBackgroundImage) {
      setImageSource(tokenBackgroundImage, tokenBackground.uri);
      tokenBackgroundImage.hidden = !tokenBackground.uri;
      // Covers the whole token like the compositor's layer; the layer's circle
      // clips it. Foundry magnifies a dynamic ring's texture by subject.scale.
      const scale = ring === 'dynamic' ? clampSubjectScale(state.subjectScale) : 1;
      tokenBackgroundImage.style.transform = `translate(-50%, -50%) scale(${scale})`;
    }

    this._updateFramingPreview();

    // The painted overlap: the subject once more, unclipped and masked, above
    // the ring layers (like the compositor's masked layer). The mask canvas
    // itself is shown as a tint while painting.
    const overlapMask = plan.token?.overlapMask ?? null;
    const overlapSubject = root.querySelector('img[data-preview="token-subject-overlap"]');
    if (overlapSubject) {
      setImageSource(overlapSubject, subjectURI || this._originalURI);
      setMaskImage(overlapSubject, overlapMask?.src ?? '');
      overlapSubject.hidden = !overlapMask;
    }
    const maskCanvas = this._overlapCanvas();
    if (maskCanvas) maskCanvas.hidden = !this._painting;

    // Same clip as the compositor. The dynamic ring clips the texture at
    // min(1, radius / subject.scale), and the preview shows the texture scaled
    // by subject.scale, so on screen that is min(subject.scale, radius): the
    // scale cancels out unless the texture's own edge is nearer.
    const ringScale = ring === 'dynamic' ? clampSubjectScale(state.subjectScale) : 1;
    const subjectClip = root.querySelector('[data-preview="token-subject-clip"]');
    if (subjectClip) {
      const clipped = state.clipSubject && (ring === 'dynamic' || ring === 'custom');
      const radius = Math.min(ringScale, RING_INNER_RADIUS + CUSTOM_RING_BACKGROUND_OVERLAP);
      subjectClip.style.clipPath = clipped ? `circle(${radius * 50}% at 50% 50%)` : '';
    }
    // The unclipped overlap still ends at the texture's edge, which a
    // subject.scale below 1 pulls inside the preview.
    const overlap = root.querySelector('[data-preview="token-overlap"]');
    if (overlap) overlap.style.clipPath = ringScale < 1 ? `inset(${(1 - ringScale) * 50}%)` : '';

    const dynamicRing = root.querySelector('[data-preview="token-ring-dynamic"]');
    if (dynamicRing) {
      dynamicRing.hidden = ring !== 'dynamic';
      dynamicRing.style.setProperty(
        '--runware-ring-color',
        tryParseHexColor(state.ringColor) ?? PREVIEW_RING_COLOR
      );
    }

    const customRing = root.querySelector('img[data-preview="token-ring"]');
    if (customRing) {
      let source = '';
      if (ring === 'custom') {
        source = state.customRing === NEW_RING ? this._generatedRingURI : state.customRing;
      }
      // Only touch src when it changes, so typing doesn't reload the image.
      if (!source) {
        customRing.removeAttribute('src');
      } else if (customRing.getAttribute('src') !== source) {
        customRing.src = source;
      }
      customRing.hidden = !source;
    }

    const tokenCaption = root.querySelector('[data-preview-caption="token"]');
    if (tokenCaption) {
      const parts = [subjectURI ? 'Subject background removed' : 'Subject background removed on Apply'];
      if (ring === 'dynamic') parts.push('ring drawn by Foundry');
      if (ring === 'custom') parts.push('ring baked into the image');
      if (background === 'generate') {
        if (this._isSameBackgroundOffered(state) && state.sameBackgroundAsPortrait) {
          parts.push("portrait's background reused");
        } else {
          parts.push({
            fresh: 'background previewed, reused on Apply',
            stale: 'preview outdated: new background generated on Apply',
            none: 'new background generated on Apply'
          }[tokenBackground.state]);
        }
      }
      tokenCaption.textContent = parts.join('; ');
    }
  }

  /**
   * Price the "Preview background" buttons like the Apply label: the subject's
   * removal only while it isn't cached, and "Regenerate" once a background
   * for the current request is. Like the Apply label, a price that can't be
   * worked out says so instead of keeping a stale one.
   * @param {Object} plan - from _readPlan()
   */
  _updateBackgroundButtons(plan) {
    const subjectCached = !!this.assetCache.get(SUBJECT_CACHE_KEY)?.imageData;
    const cost = subjectCached ? '1 image' : '1 image + 1 background removal';
    for (const button of this.element.querySelectorAll('[data-action="previewBackground"]')) {
      const label = button.querySelector('[data-preview-background-label]');
      if (!label) continue;
      try {
        const request = getBackgroundRequest(plan, button.dataset.target);
        if (!request) continue;
        const verb = this.assetCache.get(request.key)?.imageData ? 'Regenerate background' : 'Preview background';
        label.textContent = `${verb} (paid: ${cost})`;
      } catch (error) {
        console.error(`${MODULE_NAME} | Could not price the background preview:`, error);
        label.textContent = 'Preview background (paid calls could not be estimated)';
      }
    }
  }

  /**
   * The Apply label is the user's consent to its paid calls, so a summary
   * that fails says so rather than showing a bare "Apply".
   * @param {Object} plan - from _readPlan()
   */
  _updateApplyLabel(plan) {
    const label = this.element.querySelector('[data-apply-label]');
    if (!label) return;

    let full;
    try {
      const text = summarizePaidCalls(plan, this.assetCache)?.text ?? '';
      full = text ? `Apply (${text})` : 'Apply';
    } catch (error) {
      console.error(`${MODULE_NAME} | Could not summarise paid calls:`, error);
      full = 'Apply (paid calls could not be estimated)';
    }
    label.textContent = full;
    label.closest('button')?.setAttribute('title', full);
  }

  /**
   * Build the OutputPlan (see module.js executeOutputPlan) from the form.
   * Never throws: problems are collected in `errors`, and `plan` is filled in
   * as far as possible so the paid-call summary still works. `plan.modelParams`
   * is the model selection for its backgrounds (see getBackgroundRequest()).
   * @returns {{plan: Object, errors: string[]}}
   */
  _readPlan() {
    const errors = [];
    const state = this._readState();
    const portraitSize = this.portraitSize ?? {};

    const parseColor = (value, label) => {
      try {
        return parseHexColor(value);
      } catch (error) {
        errors.push(`${label}: ${getRunwareErrorMessage(error)}`);
        return null;
      }
    };

    let portrait = null;
    if (state.portraitEnabled) {
      const background = PORTRAIT_BACKGROUNDS.includes(state.portraitBackground) ? state.portraitBackground : 'keep';
      const generate = background === 'generate';
      const backgroundPrompt = generate ? state.portraitBackgroundPrompt.trim() : '';
      if (generate && !backgroundPrompt) errors.push('Enter a background prompt for the portrait.');
      portrait = {
        background,
        backgroundPrompt,
        backgroundNegativePrompt: generate ? state.portraitBackgroundNegativePrompt.trim() : '',
        backgroundSize: {
          width: clampDimension(portraitSize.width),
          height: clampDimension(portraitSize.height)
        }
      };
    }

    let token = null;
    if (state.tokenEnabled) {
      const dynamicAvailable = !!this.element?.querySelector?.('input[name="tokenRing"][value="dynamic"]');
      let ring = ['none', 'dynamic', 'custom'].includes(state.tokenRing) ? state.tokenRing : 'none';
      if (ring === 'dynamic' && !dynamicAvailable) ring = 'none';

      let background = TOKEN_BACKGROUNDS.includes(state.tokenBackground) ? state.tokenBackground : 'transparent';
      if (background === 'solid' && ring !== 'dynamic') background = 'transparent';

      let dynamic = null;
      if (ring === 'dynamic') {
        dynamic = {
          ringColor: parseColor(state.ringColor, 'Ring colour'),
          backgroundColor: background === 'solid'
            ? parseColor(state.tokenBackgroundColor, 'Background colour')
            : null,
          subjectScale: clampSubjectScale(state.subjectScale)
        };
        // A blank solid colour would silently mean "ring default".
        if (background === 'solid' && !String(state.tokenBackgroundColor ?? '').trim()) {
          errors.push('Pick a background colour, or choose "Ring default".');
        }
      }

      let custom = null;
      if (ring === 'custom') {
        if (state.customRing === NEW_RING) {
          if (this._generatedRingKey && this.assetCache.get(this._generatedRingKey)?.imageData) {
            custom = { source: 'generated', cacheKey: this._generatedRingKey };
          } else {
            errors.push('Generate a ring first, or pick an existing one.');
          }
        } else if (state.customRing) {
          custom = { source: 'existing', ringPath: state.customRing };
        } else {
          errors.push('Pick a custom ring, or generate a new one.');
        }
      }

      const sameBackgroundAsPortrait = state.sameBackgroundAsPortrait
        && background === 'generate'
        && portrait?.background === 'generate';
      const ownBackground = background === 'generate' && !sameBackgroundAsPortrait;
      const backgroundPrompt = ownBackground ? state.tokenBackgroundPrompt.trim() : '';
      if (ownBackground && !backgroundPrompt) errors.push('Enter a background prompt for the token.');

      // Only a subject kept inside the ring has parts to let out over it.
      const clipSubject = ring !== 'none' && state.clipSubject;
      const overlapMask = clipSubject ? this._getOverlapMask() : null;

      token = {
        ring,
        dynamic,
        custom,
        background,
        backgroundPrompt,
        backgroundNegativePrompt: ownBackground ? state.tokenBackgroundNegativePrompt.trim() : '',
        backgroundSize: tokenBackgroundSize(portraitSize),
        sameBackgroundAsPortrait,
        clipSubject,
        framing: clampTokenFraming(this._tokenFraming),
        // {key, src}: see _getOverlapMask(). module.js keys the saved token by `key`.
        overlapMask: overlapMask?.key ? { key: overlapMask.key, src: overlapMask.src } : null
      };
    }

    // Apply would otherwise pay for the subject's removal before failing on
    // the model (a generated ring is already in the cache and needs none).
    if (portrait?.background === 'generate' || token?.background === 'generate') {
      const modelError = this._modelError();
      if (modelError) errors.push(modelError);
    }

    if (!portrait && !token) errors.unshift('Choose at least one output.');

    return { plan: { portrait, token, modelParams: this._currentModelParams() }, errors };
  }

  /**
   * Show a progress line, or hide it with a null/empty text.
   * Handed to onApply and generateRing() as their status callback.
   */
  _setStatus(text) {
    const status = this.element?.querySelector?.('.runware-output-status');
    if (!status) return;
    const label = status.querySelector('[data-status-text]');
    if (label) label.textContent = text ?? '';
    status.hidden = !text;
  }

  _showError(message) {
    const error = this.element?.querySelector?.('.runware-output-error');
    if (!error) return;
    error.textContent = message ?? '';
    error.hidden = !message;
  }

  _setControlsDisabled(disabled) {
    const root = this.element;
    if (!(root instanceof HTMLElement)) return;
    const fieldset = root.querySelector('fieldset[data-output-fieldset]');
    if (fieldset) fieldset.disabled = disabled;
    for (const button of root.querySelectorAll('.runware-actions button')) {
      button.disabled = disabled;
    }
  }

  _field(name) {
    const form = this.element;
    if (!(form instanceof HTMLElement)) return null;
    return form.querySelector(`[name="${name}"]`);
  }

  _value(name) {
    const field = this._field(name);
    return typeof field?.value === 'string' ? field.value : '';
  }

  _checked(name) {
    const field = this._field(name);
    return !!(field && field.checked);
  }

  /**
   * The checked radio's value, or ''. Not RadioNodeList.value: namedItem()
   * returns a lone radio itself, whose .value is set even when unchecked.
   */
  _radioValue(name) {
    const checked = this.element?.querySelector?.(`input[type="radio"][name="${name}"]:checked`);
    return checked?.value ?? '';
  }
}
