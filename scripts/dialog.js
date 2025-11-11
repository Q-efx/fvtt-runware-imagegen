/**
 * Runware Image Generation Dialog
 *
 * A FormApplication for configuring and generating AI images using Runware SDK
 */

import { MODULE_ID, MODULE_NAME } from './module.js';

export class RunwareImageDialog extends FormApplication {
  constructor(options = {}) {
    super({}, options);

    this.actor = options.actor;
    this.apiKey = options.apiKey;
    this.onImageGenerated = options.onImageGenerated;
    this.runware = null;
    this.isGenerating = false;
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

    return foundry.utils.mergeObject(data, {
      actor: this.actor,
      actorName: this.actor.name,
      defaultModel: defaultModel,
      imageWidth: imageWidth,
      imageHeight: imageHeight,
      numberResults: numberResults,
      isGenerating: this.isGenerating,
      // Common model suggestions
      modelSuggestions: [
        { value: 'runware:100@1', label: 'Stable Diffusion 1.5' },
        { value: 'runware:101@1', label: 'Stable Diffusion XL' },
        { value: 'civitai:4201@130072', label: 'Realistic Vision' },
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

    // Prepare the request parameters
    const requestParams = {
      positivePrompt: formData.prompt,
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
    if (formData.loraModel && formData.loraModel.trim() !== '') {
      requestParams.lora = [{
        model: formData.loraModel,
        weight: parseFloat(formData.loraWeight) || 1.0
      }];
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
