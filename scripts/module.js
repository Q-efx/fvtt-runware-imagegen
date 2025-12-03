/**
 * Runware AI Image Generator Module for FoundryVTT
 *
 * This module integrates Runware AI image generation into actor sheets,
 * allowing users to generate character and NPC portraits using AI.
 */

import { RunwareImageDialog } from './dialog.js';
import { ImageFileHandler } from './file-handler.js';
import { RunwarePresetConfig } from './preset-config.js';
import { MODULE_ID, MODULE_NAME } from './constants.js';

/**
 * Initialize the module
 */
Hooks.once('init', async function() {
  console.log(`${MODULE_NAME} | Initializing module`);

  // Register module settings
  game.settings.register(MODULE_ID, 'apiKey', {
    name: 'Runware API Key',
    hint: 'Your Runware API key for image generation',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });

  game.settings.register(MODULE_ID, 'defaultModel', {
    name: 'Default Model',
    hint: 'The default AI model to use for image generation',
    scope: 'world',
    config: true,
    type: String,
    default: 'runware:100@1',
  });

  game.settings.register(MODULE_ID, 'imageWidth', {
    name: 'Image Width',
    hint: 'Default width for generated images',
    scope: 'world',
    config: true,
    type: Number,
    default: 512,
  });

  game.settings.register(MODULE_ID, 'imageHeight', {
    name: 'Image Height',
    hint: 'Default height for generated images',
    scope: 'world',
    config: true,
    type: Number,
    default: 512,
  });

  game.settings.register(MODULE_ID, 'numberResults', {
    name: 'Number of Results',
    hint: 'How many images to generate per request (1-4)',
    scope: 'world',
    config: true,
    type: Number,
    default: 1,
    range: {
      min: 1,
      max: 4,
      step: 1
    }
  });

  game.settings.register(MODULE_ID, 'generationPresets', {
    name: 'Runware Generation Presets',
    hint: 'Collection of reusable model presets shared with all users.',
    scope: 'world',
    config: false,
    type: Array,
    default: [],
    onChange: (value) => Hooks.callAll('runware-imagegen.presetsUpdated', value)
  });

  game.settings.registerMenu(MODULE_ID, 'presetManager', {
    name: 'Manage Generation Presets',
    label: 'Manage Presets',
    hint: 'Define model presets that are available to all players.',
    icon: 'fas fa-sliders-h',
    type: RunwarePresetConfig,
    restricted: true
  });

  console.log(`${MODULE_NAME} | Module initialized`);
});

/**
 * Ready hook - module is ready to use
 */
Hooks.once('ready', async function() {
  console.log(`${MODULE_NAME} | Module ready`);

  // Verify API key is set
  const apiKey = game.settings.get(MODULE_ID, 'apiKey');
  if (!apiKey) {
    ui.notifications.warn(`${MODULE_NAME}: Please configure your Runware API key in module settings.`);
  }
});

/**
 * Add image generation button to ActorSheet header
 */
Hooks.on('getActorSheetHeaderButtons', (app, buttons) => {
  // Only add button if user has permission to update the actor
  if (!app.document.testUserPermission(game.user, 'OWNER')) return;

  buttons.unshift({
    label: 'Generate Image',
    class: 'runware-imagegen-header-button',
    icon: 'fas fa-palette',
    onclick: () => openImageGenerationDialog(app)
  });
});

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

  const actor = actorSheet.document;

  // Create and render the dialog
  const dialog = new RunwareImageDialog({
    actor: actor,
    apiKey: apiKey,
    onImageGenerated: async (imageData, options) => {
      await handleGeneratedImage(actor, imageData, options);
    }
  });

  dialog.render(true);
}

/**
 * Handle the generated image(s) - save it and optionally update actor
 * @param {Actor} actor - The actor document
 * @param {Array<Object>} imagesData - The generated image data from Runware
 * @param {Object} options - Additional options
 */
async function handleGeneratedImage(actor, imagesData, options = {}) {
  try {
    if (!imagesData || imagesData.length === 0) {
      ui.notifications.warn(`${MODULE_NAME}: No images were generated.`);
      return;
    }

    let selectedImageData;

    if (imagesData.length === 1) {
      selectedImageData = imagesData[0];
    } else {
      // Show a dialog for the user to pick an image
      selectedImageData = await showImageSelectionDialog(imagesData);
    }

    if (!selectedImageData) {
      ui.notifications.info(`${MODULE_NAME}: No image selected.`);
      return;
    }

    // Handle background removal if requested
    if (options.removeBackground) {
      ui.notifications.info(`${MODULE_NAME}: Removing background from selected image...`);
      const bgRemovedData = await removeBackgroundFromImage(selectedImageData);
      if (bgRemovedData) {
        // Merge the new image data into the original image object to preserve other properties if needed
        selectedImageData = {
          ...selectedImageData,
          ...bgRemovedData
        };
      } else {
        ui.notifications.warn(`${MODULE_NAME}: Failed to remove background, using original image.`);
      }
    }

    ui.notifications.info(`${MODULE_NAME}: Saving selected image...`);

    // Save the image using the file handler
    const savedPath = await ImageFileHandler.saveImage(actor, selectedImageData);

    if (savedPath) {
      ui.notifications.info(`${MODULE_NAME}: Image saved successfully at ${savedPath}`);

      // Ask user if they want to set this as the actor's image
      const previewWidth = selectedImageData?.width
        ? Math.min(Math.max(Math.round(selectedImageData.width * 0.66), 320), 900)
        : 640;

      const update = await new Promise((resolve) => {
        new Dialog(
          {
            title: 'Set as Actor Image?',
            content: `<p>Would you like to set this as the actor's portrait image?</p>
                      <img src="${savedPath}" style="max-width: 100%; border: 1px solid #000;"/>`,
            buttons: {
              yes: {
                icon: '<i class="fas fa-check"></i>',
                label: 'Yes',
                callback: () => resolve(true),
              },
              no: {
                icon: '<i class="fas fa-times"></i>',
                label: 'No',
                callback: () => resolve(false),
              },
            },
            default: 'yes',
            close: () => resolve(false),
          },
          {
            width: previewWidth,
            height: 'auto',
          },
        ).render(true);
      });

      const actorUpdates = {};
      if (update) {
        actorUpdates.img = savedPath;
      }

      // If background was already removed, we can use the same image for token
      // Or we can try to remove it again if it wasn't removed (e.g. option not checked)
      // But the original logic always removed background for token.
      // Let's keep the original logic for token if background wasn't removed for avatar.

      let tokenImagePath = null;

      if (options.removeBackground) {
        // Background already removed, use the same image for token
        // But we might want to save it in the tokens directory
        try {
          tokenImagePath = await ImageFileHandler.saveImage(actor, selectedImageData, { type: 'token' });
          if (tokenImagePath) {
            actorUpdates['prototypeToken.texture.src'] = tokenImagePath;
          }
        } catch (tokenError) {
           console.error(`${MODULE_NAME} | Failed to save token image:`, tokenError);
        }
      } else {
        // Remove background and save as token image (original behavior)
        let tokenImageData = await removeBackgroundFromImage(selectedImageData);
        if (!tokenImageData) {
          console.warn(`${MODULE_NAME} | Falling back to original image for token.`);
          tokenImageData = selectedImageData;
        }

        try {
          tokenImagePath = await ImageFileHandler.saveImage(actor, tokenImageData, { type: 'token' });
          if (tokenImagePath) {
            actorUpdates['prototypeToken.texture.src'] = tokenImagePath;
          }
        } catch (tokenError) {
          console.error(`${MODULE_NAME} | Failed to save token image:`, tokenError);
          ui.notifications.error(`${MODULE_NAME}: Failed to save token image - ${tokenError.message}`);
        }
      }

      if (Object.keys(actorUpdates).length > 0) {
        await actor.update(actorUpdates);
        if (actorUpdates.img) {
          ui.notifications.info(`${MODULE_NAME}: Actor image updated`);
        }
        if (actorUpdates['prototypeToken.texture.src']) {
          ui.notifications.info(`${MODULE_NAME}: Token image updated`);
        }
      }
    }
  } catch (error) {
    console.error(`${MODULE_NAME} | Error handling generated image:`, error);
    ui.notifications.error(`${MODULE_NAME}: Failed to save image - ${error.message}`);
  }
}

let backgroundRemovalClient = null;
let backgroundRemovalClientApiKey = null;

async function getBackgroundRemovalClient() {
  const apiKey = game.settings.get(MODULE_ID, 'apiKey');

  if (!apiKey) {
    throw new Error('Runware API key is not configured.');
  }

  if (!backgroundRemovalClient || backgroundRemovalClientApiKey !== apiKey) {
    const { Runware } = await import('https://cdn.jsdelivr.net/npm/@runware/sdk-js@latest/+esm');
    backgroundRemovalClient = await Runware.initialize({ apiKey });
    backgroundRemovalClientApiKey = apiKey;
  }

  return backgroundRemovalClient;
}

async function removeBackgroundFromImage(imageData) {
  try {
    const runware = await getBackgroundRemovalClient();

    const inputImage = imageData?.imageUUID
      ?? imageData?.imageDataURI
      ?? (imageData?.imageBase64Data
        ? (imageData.imageBase64Data.startsWith('data:')
          ? imageData.imageBase64Data
          : `data:image/png;base64,${imageData.imageBase64Data}`)
        : imageData?.img);

    if (!inputImage) {
      throw new Error('No image data available for background removal.');
    }

    const response = await runware.removeImageBackground({
      inputImage,
      model: 'runware:110@1',
      outputType: 'base64Data',
      outputFormat: 'PNG',
    });

    if (!response) {
      throw new Error('Background removal did not return a result.');
    }

    return Array.isArray(response) ? response[0] : response;
  } catch (error) {
    console.error(`${MODULE_NAME} | Background removal failed:`, error);
    ui.notifications.error(`${MODULE_NAME}: Background removal failed - ${error.message}`);
    return null;
  }
}

/**
 * Shows a dialog to select one from multiple generated images.
 * @param {Array<Object>} imagesData - Array of generated image data.
 * @returns {Promise<Object|null>} The selected image data, or null if none selected.
 */
function showImageSelectionDialog(imagesData) {
  return new Promise((resolve) => {
    let selectedImageData = null;

    const getPreviewSrc = (image) => {
      if (image?.imageBase64Data) {
        return image.imageBase64Data.startsWith('data:')
          ? image.imageBase64Data
          : `data:image/png;base64,${image.imageBase64Data}`;
      }
      if (image?.img) return image.img;
      if (image?.url) return image.url;
      return '';
    };

    let content = `
      <p>Please select an image to keep:</p>
      <div class="runware-image-selection" style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;">
    `;

    imagesData.forEach((img, index) => {
      const previewSrc = getPreviewSrc(img);
      const isDisabled = !previewSrc;
      const choiceClasses = `image-choice${isDisabled ? ' disabled' : ''}`;
      const cardStyles = isDisabled
        ? 'text-align: center; opacity: 0.6; cursor: not-allowed;'
        : 'text-align: center; cursor: pointer;';

      content += `
        <div style="${cardStyles}" class="${choiceClasses}" data-index="${index}">
          ${previewSrc
            ? `<img src="${previewSrc}" style="max-width: 200px; max-height: 200px; border: 2px solid transparent;" id="image-preview-${index}" />`
            : `<div style="width: 200px; height: 200px; display: flex; align-items: center; justify-content: center; border: 2px dashed #999;">No preview</div>`}
          <br/>
          <span>Image ${index + 1}</span>
        </div>
      `;
    });

    content += '</div>';

    const dialog = new Dialog({
      title: 'Select an Image',
      content: content,
      buttons: {
        ok: {
          label: 'Confirm Selection',
          icon: '<i class="fas fa-check"></i>',
          callback: () => {
            if (!selectedImageData) {
              ui.notifications.warn(`${MODULE_NAME}: Please select an image first.`);
              return false;
            }
            resolve(selectedImageData);
          }
        },
        cancel: {
          label: 'Cancel',
          icon: '<i class="fas fa-times"></i>',
          callback: () => resolve(null)
        }
      },
      default: 'cancel',
      render: (html) => {
        const confirmButton = html.closest('.app').find('.dialog-button.ok');
        confirmButton.prop('disabled', true);

        html.find('.image-choice').not('.disabled').on('click', function() {
          const index = $(this).data('index');
          selectedImageData = imagesData[index];

          // Visual indicator for selection
          html.find('.image-choice img').css('border-color', 'transparent');
          $(this).find('img').css('border-color', '#ff6400');

          confirmButton.prop('disabled', false);
        });
      },
      close: () => resolve(null)
    }, {
      width: 'auto',
      height: 'auto',
      classes: ['runware-image-selection-dialog']
    });

    dialog.render(true);
  });
}

// Export module constants for use in other module files
export { MODULE_ID, MODULE_NAME };
