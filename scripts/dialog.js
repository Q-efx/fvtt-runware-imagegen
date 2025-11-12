/**
 * Runware Image Generation Dialog
 *
 * A FormApplication for configuring and generating AI images using Runware SDK
 */

import { MODULE_ID, MODULE_NAME } from './constants.js';
import { RunwarePresetConfig } from './preset-config.js';

export class RunwareImageDialog extends FormApplication {
  constructor(options = {}) {
    super({}, options);

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

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'runware-image-dialog',
      title: 'Generate AI Image',
      template: `modules/${MODULE_ID}/templates/image-dialog.hbs`,
      width: 600,
      height: 'auto',
      closeOnSubmit: false,
      submitOnChange: false,
      classes: ['runware-image-dialog']
    });
  }

  getData(options = {}) {
    const data = super.getData(options);

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

    return foundry.utils.mergeObject(data, {
      actor: this.actor,
      actorName: this.actor.name,
      defaultModel: defaultModel,
      imageWidth: imageWidth,
      imageHeight: imageHeight,
      numberResults: numberResults,
      isGenerating: this.isGenerating,
      presets: presets,
      canManagePresets: game.user.isGM,
      appliedPresetId: this.appliedPresetId,
      // Common model suggestions
      modelSuggestions: [
        { value: 'runware:100@1', label: 'Stable Diffusion 1.5' },
        { value: 'runware:101@1', label: 'Stable Diffusion XL' },
        { value: 'civitai:130869@143722', label: 'Fantastic Characters SDXL' },
        { value: 'civitai:4384@128713', label: 'DreamShaper' },
      ]
    });
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Model suggestion buttons
    html.find('.model-suggestion').on('click', this._onModelSuggestion.bind(this));

    // Generate button
    html.find('.generate-button').on('click', this._onGenerate.bind(this));

    // Cancel button
    html.find('.cancel-button').on('click', () => this.close());

    // Preset selection
    html.find('select[name="presetSelection"]').on('change', (event) => {
      const presetId = event.currentTarget.value;
      const preset = this._findPresetById(presetId);
      if (!preset) {
        this.appliedPresetId = null;
        return;
      }
      this._applyPresetToForm(html, preset);
    });

    if (game.user.isGM) {
      html.find('.manage-presets').on('click', (event) => {
        event.preventDefault();
        new RunwarePresetConfig().render(true);
      });
    }
  }

  /**
   * Find a preset by its id
   */
  _findPresetById(presetId) {
    if (!presetId) return null;
    return this.availablePresets.find((preset) => preset.id === presetId) ?? null;
  }

  _applyPresetToForm(html, preset) {
    if (!preset) return;

    this.appliedPresetId = preset.id;

    html.find('select[name="presetSelection"]').val(preset.id);

    html.find('input[name="model"]').val(preset.model ?? '');

    const loraModelField = html.find('input[name="loraModel"]');
    const loraWeightField = html.find('input[name="loraWeight"]');
    const loraTriggerField = html.find('input[name="loraTrigger"]');
    const loraModel = preset.lora?.model ?? '';
    const loraWeight = preset.lora?.weight ?? 1;
    const loraTrigger = preset.lora?.trigger ?? '';
    loraModelField.val(loraModel);
    loraWeightField.val(loraWeight);
    loraTriggerField.val(loraTrigger);

    html.find('input[name="vaeModel"]').val(preset.vae ?? '');

    const embeddingsField = html.find('textarea[name="embeddings"]');
    embeddingsField.val(this._formatEmbeddingsForInput(preset.embeddings));

    ui.notifications.info(`${MODULE_NAME}: Applied preset "${preset.name}".`);
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

  /**
   * Handle clicking a model suggestion
   */
  _onModelSuggestion(event) {
    event.preventDefault();
    const modelValue = $(event.currentTarget).data('model');
    this.element.find('input[name="model"]').val(modelValue);
  }

  /**
   * Handle the generate button click
   */
  async _onGenerate(event) {
    event.preventDefault();

    if (this.isGenerating) {
      ui.notifications.warn(`${MODULE_NAME}: Generation already in progress`);
      return;
    }

    // Get form data
    const form = this.element.find('form')[0];
    const formData = new FormDataExtended(form).object;

    // Validate inputs
    if (!formData.prompt || formData.prompt.trim() === '') {
      ui.notifications.error(`${MODULE_NAME}: Please enter a prompt`);
      return;
    }

    if (!formData.model || formData.model.trim() === '') {
      ui.notifications.error(`${MODULE_NAME}: Please enter a model`);
      return;
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
      this.close();

    } catch (error) {
      console.error(`${MODULE_NAME} | Image generation error:`, error);
      ui.notifications.error(`${MODULE_NAME}: Image generation failed - ${error.message}`);
    } finally {
      this.isGenerating = false;
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

  /**
   * Override to prevent default form submission
   */
  async _updateObject(event, formData) {
    // This is handled by our custom _onGenerate method
    return;
  }
}
