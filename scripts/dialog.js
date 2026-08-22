/**
 * Runware Image Generation Dialog
 *
 * An ApplicationV2 for configuring and generating AI images using Runware SDK
 */

import { MODULE_ID, MODULE_NAME } from './constants.js';
import { RunwarePresetConfig } from './preset-config.js';
import { getRunwareErrorMessage, isInvalidApiKeyError } from './runware-errors.js';
import { checkRunwareApiKey } from './runware-connection.js';

export class RunwareImageDialog extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  constructor(options = {}) {
    super(options);

    this.actor = options.actor;
    this.apiKey = options.apiKey;
    this.onImageGenerated = options.onImageGenerated;
    this.runware = null;
    this.isGenerating = false;
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
    Hooks.on('runware-imagegen.presetsUpdated', this._handlePresetsUpdated);
  }

  static DEFAULT_OPTIONS = {
    id: 'runware-image-dialog',
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
    this.render(false); // Re-render to show loading state

    try {
      ui.notifications.info(`${MODULE_NAME}: Generating image...`);

      // Generate the image using Runware SDK
      const imageData = await this._generateImage(formData);

      // Call the callback with the generated image
      if (this.onImageGenerated && imageData) {
        await this.onImageGenerated(imageData, {
          removeBackground: !!formData.removeBackground
        });
      }

      // Close the dialog on success
      await this.close();

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
        this.render(false);
      }
    }
  }

  /**
   * Snapshot the current values of the user-editable form fields into
   * `this.formState` so they can be restored across a re-render (e.g. a
   * failed generation, or a preset update pushed by the GM while this dialog
   * is open). Must be called before `this.render(false)` at every site that
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
    new RunwarePresetConfig().render(true);
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
    toggle.classList.toggle('collapsed');
    content?.classList.toggle('expanded');
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
        const [model, weightRaw] = segment.split(':').map((part) => part.trim());
        // A blank weight (e.g. "model:" with nothing after the colon) must fall
        // back to 1, not coerce to Number('') === 0 - same pitfall as
        // RunwarePresetConfig#_coerceNumber, fixed the same way here.
        const weight = weightRaw !== undefined && weightRaw !== '' ? Number(weightRaw) : 1;
        return {
          model,
          weight: Number.isFinite(weight) ? weight : 1
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
      this.render(false);
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

  async close(options) {
    Hooks.off('runware-imagegen.presetsUpdated', this._handlePresetsUpdated);
    if (this._boundPresetSelect) {
      this._boundPresetSelect.removeEventListener('change', this._handlePresetSelectChange);
      this._boundPresetSelect = null;
    }
    return super.close(options);
  }

  /**
   * Generate an image using the Runware SDK
   * @param {Object} formData - The form data
   * @returns {Promise<Object>} The generated image data
   */
  async _generateImage(formData) {
    // Dynamically import Runware SDK
    // In production, this should be bundled or loaded via CDN
    // Pinned to the major version (@1) rather than @latest: @latest currently
    // resolves to 1.3.2, so this is behaviourally identical today, but it
    // stops a future 2.x release from being pulled in silently and breaking
    // every user at once. Keep in sync with the matching import in module.js
    // (getBackgroundRemovalClient()).
    const { Runware } = await import('https://cdn.jsdelivr.net/npm/@runware/sdk-js@1/+esm');

    // Initialize Runware SDK
    if (!this.runware) {
      // Check the key ourselves first: Runware.initialize()'s own failure
      // detection can take up to a minute to report an invalid key instead
      // of failing fast - see runware-connection.js for why.
      await checkRunwareApiKey(this.apiKey);
      this.runware = await Runware.initialize({ apiKey: this.apiKey });
    }

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
      width: parseInt(formData.width) || 512,
      height: parseInt(formData.height) || 512,
      numberResults: parseInt(formData.numberResults) || 1,
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
        weight: parseFloat(formData.loraWeight) || 1.0
      }];
    }

    if (formData.vaeModel && formData.vaeModel.trim() !== '') {
      requestParams.vae = formData.vaeModel.trim();
    }

  const parsedEmbeddings = this._parseEmbeddings(formData.embeddings);
    if (parsedEmbeddings.length > 0) {
      requestParams.embeddings = parsedEmbeddings;
    }

    // Add steps if provided
    if (formData.steps) {
      requestParams.steps = parseInt(formData.steps);
    }

    // Add CFG scale if provided
    if (formData.cfgScale) {
      requestParams.CFGScale = parseFloat(formData.cfgScale);
    }

    // Add seed if provided (for reproducibility)
    if (formData.seed) {
      requestParams.seed = parseInt(formData.seed);
    }

    console.log(`${MODULE_NAME} | Generating image with parameters:`, requestParams);

    // Generate the image
    const images = await this.runware.requestImages(requestParams);

    if (!images || images.length === 0) {
      throw new Error('No images were generated');
    }

    // Return all generated images
    return images;
  }

  async _onSubmit(event, form, formData) {
    event?.preventDefault();
    event?.stopPropagation();

    // Form submission is handled by the generate button action
    // This prevents default form submit behavior
    return;
  }
}
