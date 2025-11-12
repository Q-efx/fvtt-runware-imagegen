/**
 * Runware Image Generation Dialog
 *
 * An ApplicationV2 for configuring and generating AI images using Runware SDK
 */

import { MODULE_ID, MODULE_NAME } from './constants.js';
import { RunwarePresetConfig } from './preset-config.js';

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
      presetChange: RunwareImageDialog.prototype._onPresetChange,
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
          .filter((preset) => preset && preset.name && preset.model)
          .map((preset) => ({
            id: preset.id ?? foundry.utils.randomID(),
            name: preset.name,
            model: preset.model,
            lora: preset.lora
              ? {
                  model: preset.lora.model ?? '',
                  weight: preset.lora.weight ?? 1,
                  trigger: preset.lora.trigger ?? ''
                }
              : null,
            vae: preset.vae ?? '',
            embeddings: Array.isArray(preset.embeddings) ? preset.embeddings : []
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    this.availablePresets = presets;
    const presetOptions = presets.reduce((acc, preset) => {
      acc[preset.id] = preset.name;
      return acc;
    }, {});

    return {
      actor: this.actor,
      actorName: this.actor.name,
      defaultModel: defaultModel,
      imageWidth: imageWidth,
      imageHeight: imageHeight,
      numberResults: numberResults,
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
    this.isGenerating = true;
    this.render(false); // Re-render to show loading state

    try {
      ui.notifications.info(`${MODULE_NAME}: Generating image...`);

      // Generate the image using Runware SDK
      const imageData = await this._generateImage(formData);

      // Call the callback with the generated image
      if (this.onImageGenerated && imageData) {
        await this.onImageGenerated(imageData);
      }

      // Close the dialog on success
      await this.close();

    } catch (error) {
      console.error(`${MODULE_NAME} | Image generation error:`, error);
      ui.notifications.error(`${MODULE_NAME}: Image generation failed - ${error.message}`);
    } finally {
      this.isGenerating = false;
      if (this.rendered) {
        this.render(false);
      }
    }
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

  async _onPresetChange(event, target) {
    const select = target?.closest('select');
    const presetId = select?.value ?? '';
    const preset = this._findPresetById(presetId);
    if (!preset) {
      this.appliedPresetId = null;
      return;
    }
    this._applyPresetToForm(preset);
  }

  /**
   * Find a preset by its id
   */
  _findPresetById(presetId) {
    if (!presetId) return null;
    return this.availablePresets.find((preset) => preset.id === presetId) ?? null;
  }

  _applyPresetToForm(preset) {
    if (!preset) return;

    const form = this.element;
    if (!(form instanceof HTMLElement)) return;

    this.appliedPresetId = preset.id;

    const presetSelect = form.querySelector('select[name="presetSelection"]');
    if (presetSelect) {
      presetSelect.value = preset.id;
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
    if (loraWeightInput) loraWeightInput.value = loraWeight;
    if (loraTriggerInput) loraTriggerInput.value = loraTrigger;

    const vaeInput = form.querySelector('input[name="vaeModel"]');
    if (vaeInput) {
      vaeInput.value = preset.vae ?? '';
    }

    const embeddingsField = form.querySelector('textarea[name="embeddings"]');
    if (embeddingsField) {
      embeddingsField.value = this._formatEmbeddingsForInput(preset.embeddings);
    }

    ui.notifications.info(`${MODULE_NAME}: Applied preset "${preset.name}".`);
  }

  async _onToggleAdvanced(event, target) {
    if (event.type === 'keydown') {
      const key = event.key;
      if (key !== 'Enter' && key !== ' ') return;
      event.preventDefault();
    } else {
      event.preventDefault();
    }

    const toggle = target?.closest('.advanced-toggle');
    if (!toggle) return;
    const content = toggle.nextElementSibling;
    toggle.classList.toggle('collapsed');
    content?.classList.toggle('expanded');
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
        const weight = weightRaw !== undefined ? Number(weightRaw) : 1;
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
        .filter((preset) => preset && preset.name && preset.model)
        .map((preset) => ({
          id: preset.id ?? foundry.utils.randomID(),
          name: preset.name,
          model: preset.model,
          lora: preset.lora
            ? {
                model: preset.lora.model ?? '',
                weight: preset.lora.weight ?? 1,
                trigger: preset.lora.trigger ?? ''
              }
            : null,
          vae: preset.vae ?? '',
          embeddings: Array.isArray(preset.embeddings) ? preset.embeddings : []
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (this.appliedPresetId && !this.availablePresets.some((preset) => preset.id === this.appliedPresetId)) {
        this.appliedPresetId = null;
      }
    }

    if (this.rendered) {
      this.render(false);
    }
  }

  async close(options) {
    Hooks.off('runware-imagegen.presetsUpdated', this._handlePresetsUpdated);
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
    const { Runware } = await import('https://cdn.jsdelivr.net/npm/@runware/sdk-js@latest/+esm');

    // Initialize Runware SDK
    if (!this.runware) {
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
