/**
 * "Use this image" output step
 *
 * An ApplicationV2 that opens after an image was picked and lets the user
 * decide what to make of it: a portrait (keep / remove / replace the
 * background) and a token (no ring, Foundry's dynamic ring, or a custom ring
 * baked into the image, each with an optional background).
 *
 * The dialog owns the UI and builds an OutputPlan; module.js owns the work
 * (removal, generation, compositing, saving) through the `onApply` callback.
 * Nothing is paid for or saved before Apply, except the explicit, labelled
 * "Generate ring" button.
 */

import { MODULE_ID, MODULE_NAME, LIMITS } from './constants.js';
import { ImageFileHandler } from './file-handler.js';
import {
  generateRing,
  getDefaultPrompts,
  summarizePaidCalls,
  clampDimension,
  tokenBackgroundSize
} from './asset-generation.js';
import { getDynamicRingInfo, parseHexColor, clampSubjectScale } from './token-ring.js';
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

export class RunwareOutputDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  constructor(options = {}) {
    super({ id: getOutputDialogId(options.actor), ...options });

    // Keep the caller's references (ApplicationV2 clones plain option objects).
    this.actor = options.actor;
    this.imageData = options.imageData ?? null;
    this.canGoBack = !!options.canGoBack;
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
    this._generatingRing = false;  // the in-dialog "Generate ring" call is running
    this._ringCounter = 0;
    this._generatedRingKey = null;
    this._generatedRingURI = '';
    this._restoreGeneratedRing();
    this._result = null;
    this._resolve = null;
    this._settled = false;
    this._listenersBound = false;
    this._handleFormChange = this._handleFormChange.bind(this);
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
      generateRing: RunwareOutputDialog.prototype._onGenerateRing
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
   * @param {Object} options.modelParams - ModelParams for "Generate ring"
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
      subjectScale: LIMITS.subjectScale
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
    this._listenersBound = true;

    // Base64 previews are set through the DOM, never through template HTML.
    // The Runware URL is only a fallback for display; nothing is drawn from it.
    const source = toDataURI(this.imageData) || this.imageData?.imageURL || '';
    for (const img of this.element.querySelectorAll('img[data-preview="portrait"], img[data-preview="token-subject"]')) {
      if (source) img.src = source;
    }
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
    }
    this._listenersBound = false;
    this._settle(this._result ?? 'cancelled');
  }

  /**
   * Block X, Escape, Cancel and Back while Apply or a ring generation is
   * running: the work would carry on without anyone to report it to.
   * Internal closes pass `runwareForce`.
   */
  async close(options = {}) {
    if ((this._busy || this._generatingRing) && !options?.runwareForce) {
      const message = this._busy
        ? 'Please wait until Apply finishes.'
        : 'Please wait until the ring is generated.';
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
    if (this._busy || this._generatingRing) return;

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
    if (this._busy || this._generatingRing) return;
    this._result = 'back';
    await this.close();
  }

  async _onCancel(event, target) {
    event.preventDefault();
    await this.close();
  }

  /**
   * The only paid call this dialog makes itself: one image generation plus
   * one background removal (see generateRing() in asset-generation.js). The
   * ring stays in assetCache; module.js saves it on Apply.
   */
  async _onGenerateRing(event, target) {
    event.preventDefault();
    if (this._generatingRing || this._busy) return;

    const prompt = this._value('ringPrompt').trim();
    if (!prompt) {
      this._showError('Enter a ring prompt.');
      return;
    }

    this._generatingRing = true;
    this._setControlsDisabled(true);
    this._showError(null);
    this._setStatus('Generating ring…');

    try {
      const ring = await generateRing({
        prompt,
        negativePrompt: this._value('ringNegativePrompt').trim(),
        modelParams: this.modelParams,
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
      this._generatingRing = false;
      if (this.rendered) {
        this._setControlsDisabled(false);
        this._setStatus(null);
        this._refresh();
      }
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

    if (!this._busy && !this._generatingRing) this._showError(null);
    this._refresh();
  }

  _refresh() {
    if (!(this.element instanceof HTMLElement)) return;
    this._normalizeForm();
    const state = this._readState();
    this._syncVisibility(state);
    this._updatePreview(state);
    this._updateApplyLabel();
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
   * Approximate CSS preview: the real images are only built on Apply.
   */
  _updatePreview(state) {
    const root = this.element;

    const portraitBlock = root.querySelector('[data-preview-block="portrait"]');
    if (portraitBlock) portraitBlock.hidden = !state.portraitEnabled;
    const portraitCaption = root.querySelector('[data-preview-caption="portrait"]');
    if (portraitCaption) {
      portraitCaption.textContent = {
        keep: 'Saved as generated',
        remove: 'Background removed on Apply',
        generate: 'New background generated on Apply'
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

    const tokenBackgroundLayer = root.querySelector('[data-preview="token-bg"]');
    if (tokenBackgroundLayer) {
      tokenBackgroundLayer.hidden = background === 'transparent';
      tokenBackgroundLayer.style.backgroundColor = background === 'solid'
        ? tryParseHexColor(state.tokenBackgroundColor) ?? ''
        : '';
    }

    const subject = root.querySelector('img[data-preview="token-subject"]');
    if (subject) {
      subject.style.transform = ring === 'dynamic'
        ? `scale(${clampSubjectScale(state.subjectScale)})`
        : '';
    }

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
      const parts = ['Subject background removed on Apply'];
      if (ring === 'dynamic') parts.push('ring drawn by Foundry');
      if (ring === 'custom') parts.push('ring baked into the image');
      if (background === 'generate') {
        parts.push(this._isSameBackgroundOffered(state) && state.sameBackgroundAsPortrait
          ? "portrait's background reused"
          : 'new background generated on Apply');
      }
      tokenCaption.textContent = parts.join('; ');
    }
  }

  _updateApplyLabel() {
    const label = this.element.querySelector('[data-apply-label]');
    if (!label) return;

    let text = '';
    try {
      text = summarizePaidCalls(this._readPlan().plan, this.assetCache)?.text ?? '';
    } catch (error) {
      console.debug(`${MODULE_NAME} | Could not summarise paid calls:`, error);
    }
    const full = text ? `Apply (${text})` : 'Apply';
    label.textContent = full;
    label.closest('button')?.setAttribute('title', full);
  }

  /**
   * Build the OutputPlan (see module.js executeOutputPlan) from the form.
   * Never throws: problems are collected in `errors`, and `plan` is filled in
   * as far as possible so the paid-call summary still works.
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

      token = {
        ring,
        dynamic,
        custom,
        background,
        backgroundPrompt,
        backgroundNegativePrompt: ownBackground ? state.tokenBackgroundNegativePrompt.trim() : '',
        backgroundSize: tokenBackgroundSize(portraitSize),
        sameBackgroundAsPortrait
      };
    }

    if (!portrait && !token) errors.unshift('Choose at least one output.');

    return { plan: { portrait, token }, errors };
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
