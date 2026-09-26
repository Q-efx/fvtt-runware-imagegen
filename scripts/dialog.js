/**
 * Runware Image Generation Dialog
 *
 * An ApplicationV2 for configuring and generating AI images using Runware SDK
 */

import { MODULE_ID, MODULE_NAME, LIMITS } from './constants.js';
import { RunwarePresetConfig } from './preset-config.js';
import { getRunwareErrorMessage, isInvalidApiKeyError } from './runware-errors.js';
import { getRunwareClient } from './runware-client.js';
import { extractModelParams } from './asset-generation.js';

/**
 * Parse a form value as a finite number, or return null for blank/invalid input.
 * Unlike `parseFloat(x) || fallback`, this keeps a legitimate 0.
 */
function toFiniteNumber(value) {
  if (value === undefined || value === null || `${value}`.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, { min, max }) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Clamp a width/height to Runware's accepted range and snap it to a multiple of 64.
 */
function normalizeDimension(value) {
  const { step, fallback } = LIMITS.dimension;
  const number = toFiniteNumber(value);
  if (number === null) return fallback;
  return clamp(Math.round(number / step) * step, LIMITS.dimension);
}

/**
 * Application id for an actor's dialog. One dialog per actor: a fixed id made
 * a second actor's dialog replace the first one's DOM while its generation was
 * still running.
 * @param {Actor} actor
 * @returns {string}
 */
export function getImageDialogId(actor) {
  const key = String(actor?.uuid ?? actor?.id ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');
  return `runware-image-dialog-${key}`;
}

export class RunwareImageDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  constructor(options = {}) {
    super({ id: getImageDialogId(options.actor), ...options });

    this.actor = options.actor;
    this.onImageGenerated = options.onImageGenerated;
    this.isGenerating = false;
    this.advancedExpanded = false;
    this.availablePresets = [];
    this.appliedPresetId = null;
    // Snapshot of the user's live form values, captured just before any
    // re-render that would otherwise wipe them (see _captureFormState).
    // Empty until the first capture, at which point _prepareContext prefers
    // it over the world-setting defaults.
    this.formState = {};
    this._boundPresetSelect = null;
    this._handlePresetSelectChange = this._handlePresetSelectChange.bind(this);
    this._handlePresetsUpdated = this._handlePresetsUpdated.bind(this);
    this._presetsHookId = null;
  }

  static DEFAULT_OPTIONS = {
    classes: ['runware-image-dialog'],
    tag: 'form',
    window: {
      title: 'Generate AI Image',
      frame: true,
      positioned: true,
      minimizable: true
    },
    actions: {
      modelSuggestion: RunwareImageDialog.prototype._onModelSuggestion,
      generate: RunwareImageDialog.prototype._onGenerate,
      cancel: RunwareImageDialog.prototype._onCancel,
      managePresets: RunwareImageDialog.prototype._onManagePresets,
      toggleAdvanced: RunwareImageDialog.prototype._onToggleAdvanced
    },
    form: {
      handler: RunwareImageDialog.prototype._onSubmit,
      closeOnSubmit: false,
      submitOnChange: false
    },
    position: {
      width: 600,
      height: 'auto'
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/image-dialog.hbs`
    }
  };

  async _prepareContext(options) {
    // Get settings
    const defaultModel = game.settings.get(MODULE_ID, 'defaultModel');
    const imageWidth = game.settings.get(MODULE_ID, 'imageWidth');
    const imageHeight = game.settings.get(MODULE_ID, 'imageHeight');
    const numberResults = game.settings.get(MODULE_ID, 'numberResults');
    const presetsSetting = game.settings.get(MODULE_ID, 'generationPresets') ?? [];
    const presets = Array.isArray(presetsSetting)
      ? presetsSetting
          .map((preset) => this._mapPreset(preset))
          .filter((preset) => preset !== null)
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    this.availablePresets = presets;
    const presetOptions = presets.reduce((acc, preset) => {
      acc[preset.id] = preset.name;
      return acc;
    }, {});

    // Prefer whatever the user last had in the form (captured just before
    // this render) over the world-setting defaults, so a re-render triggered
    // by a failed generation, a spinner, or a live preset update doesn't wipe
    // out what they typed. `state` is `{}` on first open, so every field
    // below falls back to its setting/blank default via `??`.
    const state = this.formState ?? {};

    return {
      actor: this.actor,
      actorName: this.actor.name,
      prompt: state.prompt ?? '',
      negativePrompt: state.negativePrompt ?? '',
      defaultModel: state.model ?? defaultModel,
      imageWidth: state.width ?? imageWidth,
      imageHeight: state.height ?? imageHeight,
      numberResults: state.numberResults ?? numberResults,
      removeBackground: !!state.removeBackground,
      loraModel: state.loraModel ?? '',
      loraWeight: state.loraWeight ?? '1.0',
      loraTrigger: state.loraTrigger ?? '',
      vaeModel: state.vaeModel ?? '',
      embeddings: state.embeddings ?? '',
      steps: state.steps ?? '',
      cfgScale: state.cfgScale ?? '',
      seed: state.seed ?? '',
      isGenerating: this.isGenerating,
      advancedExpanded: this.advancedExpanded,
      presets: presets,
      presetOptions,
      canManagePresets: game.user.isGM,
      appliedPresetId: this.appliedPresetId,
      // Common model suggestions
      modelSuggestions: [
        { value: 'runware:100@1', label: 'Stable Diffusion 1.5' },
        { value: 'runware:101@1', label: 'Stable Diffusion XL' },
        { value: 'civitai:130869@143722', label: 'Fantastic Characters SDXL' },
        { value: 'civitai:4384@128713', label: 'DreamShaper' },
      ]
    };
  }

  async _onModelSuggestion(event, target) {
    event.preventDefault();
    const button = target?.closest('[data-action="modelSuggestion"]');
    const modelValue = button?.dataset.model;
    if (!modelValue) return;

    const form = this.element;
    if (!(form instanceof HTMLElement)) return;
    const modelInput = form.querySelector('input[name="model"]');
    if (modelInput) {
      modelInput.value = modelValue;
    }
  }

  async _onGenerate(event, target) {
    event.preventDefault();

    if (this.isGenerating) {
      ui.notifications.warn(`${MODULE_NAME}: Generation already in progress`);
      return;
    }

    // Get form data
    const form = target?.closest?.('form') ?? this.form ?? this.element;
    if (!(form instanceof HTMLFormElement)) return;

    const rawFormData = new FormData(form);
    const formData = Object.fromEntries(rawFormData.entries());

    // Validate inputs
    const promptField = form.elements.namedItem?.('prompt');
    const promptInput = promptField instanceof HTMLTextAreaElement ? promptField : form.querySelector('textarea[name="prompt"]');
    const promptTextRaw = typeof promptInput?.value === 'string' ? promptInput.value : formData.prompt;
    const promptText = typeof promptTextRaw === 'string' ? promptTextRaw.trim() : '';
    if (!promptText) {
      ui.notifications.error(`${MODULE_NAME}: Please enter a prompt`);
      return;
    }

    const modelField = form.elements.namedItem?.('model');
    const modelInput = modelField instanceof HTMLInputElement ? modelField : form.querySelector('input[name="model"]');
    const modelValueRaw = typeof modelInput?.value === 'string' ? modelInput.value : formData.model;
    const modelValue = typeof modelValueRaw === 'string' ? modelValueRaw.trim() : '';
    if (!modelValue) {
      ui.notifications.error(`${MODULE_NAME}: Please enter a model`);
      return;
    }

    formData.prompt = promptText;
    formData.model = modelValue;

    const negativeField = form.elements.namedItem?.('negativePrompt');
    const negativePromptInput = negativeField instanceof HTMLTextAreaElement ? negativeField : form.querySelector('textarea[name="negativePrompt"]');
    if (negativePromptInput) {
      formData.negativePrompt = negativePromptInput.value.trim();
    }
    // Start generation
    this._captureFormState(); // Preserve what the user typed before the spinner re-render
    this.isGenerating = true;
    this.render(); // Re-render to show loading state

    try {
      ui.notifications.info(`${MODULE_NAME}: Generating image...`);

      // Generate the image using Runware SDK
      const { images, requestParams } = await this._generateImage(formData);

      // Call the callback with the generated image. It resolves `false` when
      // the flow didn't finish (picker cancelled, save failed, ...); keep the
      // dialog and the user's prompt in that case instead of closing on them.
      // The already-clamped request is handed on so rings and backgrounds are
      // generated with the same model settings without re-reading the form.
      let completed = true;
      if (this.onImageGenerated && images) {
        completed = (await this.onImageGenerated(images, {
          removeBackground: !!formData.removeBackground,
          prompt: formData.prompt,
          modelParams: extractModelParams(requestParams),
          portraitSize: { width: requestParams.width, height: requestParams.height }
        })) !== false;
      }

      if (completed) {
        await this.close();
      }

    } catch (error) {
      console.error(`${MODULE_NAME} | Image generation error:`, error);
      // The Runware SDK doesn't always reject with a proper Error (see
      // runware-errors.js) - normalise it so the notification always shows a
      // real message instead of "undefined", and call out an invalid API key
      // specifically since that's the failure the GM can actually fix.
      const notification = isInvalidApiKeyError(error)
        ? `${MODULE_NAME}: Image generation failed - invalid Runware API key. Ask your GM to update it in Settings.`
        : `${MODULE_NAME}: Image generation failed - ${getRunwareErrorMessage(error)}`;
      ui.notifications.error(notification);
    } finally {
      this.isGenerating = false;
      if (this.rendered) {
        this._captureFormState(); // Fields are disabled during generation so this is a no-op today, but keeps this re-render self-protecting if that ever changes
        this.render();
      }
    }
  }

  /**
   * Snapshot the current values of the user-editable form fields into
   * `this.formState` so they can be restored across a re-render (e.g. a
   * failed generation, or a preset update pushed by the GM while this dialog
   * is open). Must be called before `this.render()` at every site that
   * could otherwise wipe the live form.
   *
   * The dialog root has `tag: 'form'`, so it IS the form (`this.form`
   * resolves to `this.element`); the template no longer opens a nested
   * `<form>` of its own, so every control is genuinely owned by this form.
   */
  _captureFormState() {
    const form = this.form ?? this.element;
    if (!(form instanceof HTMLFormElement)) return;

    const getValue = (name) => {
      const field = form.elements.namedItem?.(name);
      return typeof field?.value === 'string' ? field.value : '';
    };

    const removeBackgroundField = form.elements.namedItem?.('removeBackground');

    this.formState = {
      prompt: getValue('prompt'),
      negativePrompt: getValue('negativePrompt'),
      model: getValue('model'),
      width: getValue('width'),
      height: getValue('height'),
      numberResults: getValue('numberResults'),
      removeBackground: !!(removeBackgroundField && removeBackgroundField.checked),
      loraModel: getValue('loraModel'),
      loraWeight: getValue('loraWeight'),
      loraTrigger: getValue('loraTrigger'),
      vaeModel: getValue('vaeModel'),
      embeddings: getValue('embeddings'),
      steps: getValue('steps'),
      cfgScale: getValue('cfgScale'),
      seed: getValue('seed')
    };
  }

  async _onCancel(event, target) {
    event.preventDefault();
    this.close();
  }

  async _onManagePresets(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return;
    // Reuse an open preset manager instead of stacking a second copy (which
    // would also discard the first one's unsaved edits).
    const existing = foundry.applications.instances?.get(RunwarePresetConfig.DEFAULT_OPTIONS.id);
    if (existing) {
      existing.bringToFront?.();
      return;
    }
    new RunwarePresetConfig().render({ force: true });
  }

  _handlePresetSelectChange(event) {
    const select = event.currentTarget;
    if (!(select instanceof HTMLSelectElement)) return;
    this._applyPresetSelection(select.value ?? '');
  }

  _applyPresetSelection(presetId, { silent = false } = {}) {
    const preset = this._findPresetById(presetId);
    if (!preset) {
      this.appliedPresetId = null;
      const select = this._boundPresetSelect ?? this.element?.querySelector?.('select[name="presetSelection"]');
      if (select instanceof HTMLSelectElement) {
        select.value = '';
      }
      return;
    }
    this._applyPresetToForm(preset, { silent });
  }

  /**
   * Find a preset by its id
   */
  _findPresetById(presetId) {
    if (!presetId) return null;
    return this.availablePresets.find((preset) => preset.id === presetId) ?? null;
  }

  _applyPresetToForm(preset, { silent = false } = {}) {
    if (!preset) return;

    const form = this.form ?? this.element;
    if (!(form instanceof HTMLElement)) return;

    this.appliedPresetId = preset.id;

    const presetSelect = form.querySelector('select[name="presetSelection"]');
    if (presetSelect) {
      presetSelect.value = preset.id;
    }

    // _onRender re-applies the currently-applied preset "silently" after
    // every render (including the spinner re-render on generation
    // start/failure). By that point the freshly-rendered form already shows
    // the user's last known values via formState - which may include edits
    // made on top of this preset (e.g. a manually tweaked LoRA weight).
    // Precedence: an explicit, user-initiated preset pick (silent: false,
    // from the dropdown) still overwrites every field below, same as
    // always. A silent re-application only keeps the preset dropdown in
    // sync and stops here, so it never clobbers the user's own edits.
    if (silent) {
      return;
    }

    const modelInput = form.querySelector('input[name="model"]');
    if (modelInput) {
      modelInput.value = preset.model ?? '';
    }

    const loraModelInput = form.querySelector('input[name="loraModel"]');
    const loraWeightInput = form.querySelector('input[name="loraWeight"]');
    const loraTriggerInput = form.querySelector('input[name="loraTrigger"]');
    const loraModel = preset.lora?.model ?? '';
    const loraWeight = preset.lora?.weight ?? 1;
    const loraTrigger = preset.lora?.trigger ?? '';
    if (loraModelInput) loraModelInput.value = loraModel;
    if (loraWeightInput) loraWeightInput.value = `${loraWeight}`;
    if (loraTriggerInput) loraTriggerInput.value = loraTrigger;

    const vaeInput = form.querySelector('input[name="vaeModel"]');
    if (vaeInput) {
      vaeInput.value = preset.vae ?? '';
    }

    const widthInput = form.querySelector('input[name="width"]');
    if (widthInput && Number.isFinite(preset.width) && preset.width > 0) {
      widthInput.value = `${preset.width}`;
    }

    const heightInput = form.querySelector('input[name="height"]');
    if (heightInput && Number.isFinite(preset.height) && preset.height > 0) {
      heightInput.value = `${preset.height}`;
    }

    const embeddingsField = form.querySelector('textarea[name="embeddings"]');
    if (embeddingsField) {
      embeddingsField.value = this._formatEmbeddingsForInput(preset.embeddings);
    }

    if (!silent) {
      ui.notifications.info(`${MODULE_NAME}: Applied preset "${preset.name}".`);
    }
  }

  async _onToggleAdvanced(event, target) {
    event.preventDefault();

    const toggle = target?.closest('.advanced-toggle');
    if (!toggle) return;
    const content = toggle.nextElementSibling;
    // Remember the state so the spinner/failure re-renders don't collapse it.
    this.advancedExpanded = !this.advancedExpanded;
    toggle.classList.toggle('collapsed', !this.advancedExpanded);
    content?.classList.toggle('expanded', this.advancedExpanded);
  }

  _mapPreset(rawPreset) {
    if (!rawPreset || !rawPreset.name || !rawPreset.model) {
      return null;
    }

    const width = Number(rawPreset.width);
    const height = Number(rawPreset.height);

    return {
      id: rawPreset.id ?? foundry.utils.randomID(),
      name: rawPreset.name,
      model: rawPreset.model,
      width: Number.isFinite(width) && width > 0 ? Math.round(width) : null,
      height: Number.isFinite(height) && height > 0 ? Math.round(height) : null,
      lora: rawPreset.lora
        ? {
            model: rawPreset.lora.model ?? '',
            weight: rawPreset.lora.weight ?? 1,
            trigger: rawPreset.lora.trigger ?? ''
          }
        : null,
      vae: rawPreset.vae ?? '',
      embeddings: Array.isArray(rawPreset.embeddings) ? rawPreset.embeddings : []
    };
  }

  _formatEmbeddingsForInput(embeddings) {
    if (!Array.isArray(embeddings) || embeddings.length === 0) {
      return '';
    }

    return embeddings
      .map((embedding) => {
        const model = embedding.model ?? '';
        if (!model) return '';
        const weight = Number(embedding.weight);
        return Number.isFinite(weight) && weight !== 1 ? `${model}:${weight}` : model;
      })
      .filter(Boolean)
      .join('\n');
  }

  _parseEmbeddings(raw) {
    if (!raw || typeof raw !== 'string') {
      return [];
    }

    return raw
      .split(/\n|,/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .map((segment) => {
        // Model ids are AIR ids that contain a colon themselves
        // (`civitai:12345@67890`), so only a `:<number>` *after* the `@version`
        // is a weight. A blank weight ("model:") falls back to 1, not
        // Number('') === 0.
        const match = segment.match(/^(.+@[^:]*):\s*(-?\d*\.?\d+)?$/);
        const model = (match?.[1] ?? segment).trim();
        const weight = toFiniteNumber(match?.[2]);
        return {
          model,
          weight: weight === null ? 1 : clamp(weight, LIMITS.weight)
        };
      })
      .filter((embedding) => embedding.model);
  }

  _handlePresetsUpdated(value) {
    if (Array.isArray(value)) {
      this.availablePresets = value
        .map((preset) => this._mapPreset(preset))
        .filter((preset) => preset !== null)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (this.appliedPresetId && !this.availablePresets.some((preset) => preset.id === this.appliedPresetId)) {
        this.appliedPresetId = null;
      }
    }

    if (this.rendered) {
      this._captureFormState(); // Don't let the GM's preset edit wipe the user's in-progress prompt
      this.render();
    }
  }

  async _onRender(context, options) {
    if (super._onRender) await super._onRender(context, options);
    // The template used to open its own `<form autocomplete="off">`; now
    // that the AppV2 root element IS the form (`tag: 'form'`), that
    // attribute can only be set here, directly on `this.element`.
    if (this.element instanceof HTMLFormElement) {
      this.element.setAttribute('autocomplete', 'off');
    }
    this._bindPresetSelect();
    if (this.appliedPresetId) {
      this._applyPresetSelection(this.appliedPresetId, { silent: true });
    }
  }

  _bindPresetSelect() {
    if (this._boundPresetSelect) {
      this._boundPresetSelect.removeEventListener('change', this._handlePresetSelectChange);
      this._boundPresetSelect = null;
    }

    const form = this.form ?? this.element;
    const presetField = form instanceof HTMLFormElement
      ? form.elements.namedItem?.('presetSelection')
      : null;
    const select = presetField instanceof HTMLSelectElement
      ? presetField
      : form instanceof HTMLElement
        ? form.querySelector('select[name="presetSelection"]')
        : null;

    if (select instanceof HTMLSelectElement) {
      select.addEventListener('change', this._handlePresetSelectChange);
      this._boundPresetSelect = select;
    }
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this._presetsHookId = Hooks.on('runware-imagegen.presetsUpdated', this._handlePresetsUpdated);
  }

  /**
   * Ignore Escape while a generation (and the "Use this image" step that
   * follows it) is in progress. Escape dismisses every open window, so it
   * would otherwise throw away the prompt the output step promises to keep
   * when the user cancels there. The X button still closes the dialog.
   */
  async close(options = {}) {
    if (this.isGenerating && options?.closeKey) return this;
    return super.close(options);
  }

  _onClose(options) {
    super._onClose(options);
    if (this._presetsHookId !== null) {
      Hooks.off('runware-imagegen.presetsUpdated', this._presetsHookId);
      this._presetsHookId = null;
    }
    if (this._boundPresetSelect) {
      this._boundPresetSelect.removeEventListener('change', this._handlePresetSelectChange);
      this._boundPresetSelect = null;
    }
  }

  /**
   * Generate an image using the Runware SDK
   * @param {Object} formData - The form data
   * @returns {Promise<{ images: Object[], requestParams: Object }>} The generated
   *   images and the clamped request that produced them
   */
  async _generateImage(formData) {
    // Read the key now rather than when the dialog opened, so a key the GM
    // fixes while this dialog is open takes effect on the next attempt.
    const runware = await getRunwareClient(game.settings.get(MODULE_ID, 'apiKey'));

    const basePrompt = (formData.prompt ?? '').trim();
    const loraModel = formData.loraModel?.trim() ?? '';
    const loraTrigger = formData.loraTrigger?.trim() ?? '';
    let positivePrompt = basePrompt;

    if (loraModel && loraTrigger) {
      // Ensure the LoRA trigger is included so the model activates as expected.
      const normalizedPrompt = positivePrompt.toLowerCase();
      const normalizedTrigger = loraTrigger.toLowerCase();
      if (!normalizedPrompt.includes(normalizedTrigger)) {
        positivePrompt = `${loraTrigger}, ${positivePrompt}`;
      }
    }

    // Prepare the request parameters
    const requestParams = {
      positivePrompt: positivePrompt,
      model: formData.model,
      width: normalizeDimension(formData.width),
      height: normalizeDimension(formData.height),
      numberResults: Math.round(clamp(
        toFiniteNumber(formData.numberResults) ?? LIMITS.numberResults.fallback,
        LIMITS.numberResults
      )),
      outputType: 'base64Data', // We'll get base64 data to save locally
      outputFormat: 'PNG'
    };

    // Add negative prompt if provided
    if (formData.negativePrompt && formData.negativePrompt.trim() !== '') {
      requestParams.negativePrompt = formData.negativePrompt;
    }

    // Add LoRA if provided
    if (loraModel) {
      requestParams.lora = [{
        model: loraModel,
        weight: clamp(toFiniteNumber(formData.loraWeight) ?? 1, LIMITS.weight)
      }];
    }

    if (formData.vaeModel && formData.vaeModel.trim() !== '') {
      requestParams.vae = formData.vaeModel.trim();
    }

    const parsedEmbeddings = this._parseEmbeddings(formData.embeddings);
    if (parsedEmbeddings.length > 0) {
      requestParams.embeddings = parsedEmbeddings;
    }

    const steps = toFiniteNumber(formData.steps);
    if (steps !== null) {
      requestParams.steps = Math.round(clamp(steps, LIMITS.steps));
    }

    const cfgScale = toFiniteNumber(formData.cfgScale);
    if (cfgScale !== null) {
      requestParams.CFGScale = clamp(cfgScale, LIMITS.cfgScale);
    }

    // Seed (for reproducibility). Must be a safe positive integer - parseInt
    // silently rounds large values, which would send a different seed.
    const seedRaw = `${formData.seed ?? ''}`.trim();
    if (seedRaw) {
      const seed = Number(seedRaw);
      if (!Number.isSafeInteger(seed) || seed < 1) {
        throw new Error(`Seed must be a whole number between 1 and ${Number.MAX_SAFE_INTEGER}.`);
      }
      requestParams.seed = seed;
    }

    console.debug(`${MODULE_NAME} | Generating image with parameters:`, requestParams);

    const images = await runware.requestImages(requestParams);

    if (!images || images.length === 0) {
      throw new Error('No images were generated');
    }

    // Return all generated images
    return { images, requestParams };
  }

  async _onSubmit(event, form, formData) {
    event?.preventDefault();
    event?.stopPropagation();

    // Form submission is handled by the generate button action
    // This prevents default form submit behavior
    return;
  }
}
