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
import { getRunwareErrorMessage } from './runware-errors.js';
import { checkRunwareApiKey } from './runware-connection.js';

/**
 * Initialize the module
 */
Hooks.once('init', async function() {
  console.log(`${MODULE_NAME} | Initializing module`);

  // Register module settings
  game.settings.register(MODULE_ID, 'apiKey', {
    name: 'Runware API Key',
    hint: 'Your Runware API key for image generation. Verified automatically whenever it is changed.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    // Fires on every connected client whenever this world setting actually
    // changes value (not on every settings-form save) - it's a world setting,
    // so the change is broadcast to everyone. Guard on isGM so a key edit
    // doesn't also make every player's browser open a websocket to Runware
    // just to validate it.
    onChange: (value) => {
      if (!game.user?.isGM) return;
      validateApiKey(value);
    }
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
 * Check whether the current user is allowed to upload files, which is required
 * by ImageFileHandler.saveImage(). The button itself stays visible to anyone who
 * owns the actor (mirroring the existing apiKey check, which also isn't gated on
 * button visibility) - this is enforced when the dialog is opened instead, see
 * openImageGenerationDialog().
 * @returns {boolean}
 */
function hasFileUploadPermission() {
  if (!game?.user) return false;
  try {
    if (typeof game.user.hasPermission === 'function') {
      return game.user.hasPermission('FILES_UPLOAD');
    }
  } catch (err) {
    console.warn(`${MODULE_NAME} | Failed to evaluate upload permission:`, err);
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

  // Generation costs money and saving the result requires Foundry's FILES_UPLOAD
  // permission. Check up front so a player who owns the actor but lacks upload
  // rights doesn't pay for a Runware request that can never be saved.
  if (!hasFileUploadPermission()) {
    ui.notifications.error(`${MODULE_NAME}: You do not have permission to upload files. Ask your GM to grant the "Upload New Files" permission.`);
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

      // Fixed preview width: the Runware SDK response never includes a `width`
      // field (its shape is imageUUID/imageURL/imageBase64Data/NSFWContent/cost/seed),
      // so the previous size calculation always fell back to this value anyway.
      const previewWidth = 640;

      // Build the preview via DOM APIs (property assignment) instead of an HTML
      // string, so `savedPath` is never interpolated into markup.
      const consentContent = document.createElement('div');
      const consentText = document.createElement('p');
      consentText.textContent = "Would you like to use this image for the actor's portrait and/or token?";
      consentContent.appendChild(consentText);
      const consentImage = document.createElement('img');
      consentImage.src = savedPath;
      consentImage.style.maxWidth = '100%';
      consentImage.style.border = '1px solid #000';
      consentContent.appendChild(consentImage);

      // Ask the user what to do with the generated image. Portrait and token are
      // asked about together (in one dialog) because setting the prototype token
      // may trigger a paid background-removal API call - it must not happen
      // without consent, same as the portrait must not be overwritten without it.
      // rejectClose: false + normalizing a null result below keeps dismissal
      // (X / Escape) equivalent to declining both, exactly like the old `close:`
      // handler on the legacy Dialog - without it DialogV2 would instead reject
      // the promise and this would surface as "Failed to save image - undefined".
      const consentResult = await getDialogV2().wait({
        window: { title: 'Set as Actor Image?' },
        position: { width: previewWidth, height: 'auto' },
        content: consentContent,
        rejectClose: false,
        buttons: [
          {
            action: 'both',
            icon: 'fas fa-check',
            label: 'Portrait + Token',
            // Keep the previous default-to-yes convenience: pressing Enter or
            // simply not customizing anything still applies to both, in one click.
            default: true,
            callback: () => ({ portrait: true, token: true }),
          },
          {
            action: 'portraitOnly',
            label: 'Portrait Only',
            callback: () => ({ portrait: true, token: false }),
          },
          {
            action: 'tokenOnly',
            label: 'Token Only',
            callback: () => ({ portrait: false, token: true }),
          },
          {
            action: 'no',
            icon: 'fas fa-times',
            label: 'No',
            callback: () => ({ portrait: false, token: false }),
          },
        ],
      });
      const choice = consentResult ?? { portrait: false, token: false };

      const actorUpdates = {};
      if (choice.portrait) {
        actorUpdates.img = savedPath;
      }

      let tokenImagePath = null;

      if (choice.token) {
        if (options.removeBackground) {
          // Background was already removed for the portrait; reuse the same
          // image data for the token instead of paying for removal again.
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

/**
 * Verify a Runware API key and notify the caller's client of the result.
 * Called from the `apiKey` setting's `onChange`, which guards on
 * `game.user.isGM` before calling this.
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

let backgroundRemovalClient = null;
let backgroundRemovalClientApiKey = null;

async function getBackgroundRemovalClient() {
  const apiKey = game.settings.get(MODULE_ID, 'apiKey');

  if (!apiKey) {
    throw new Error('Runware API key is not configured.');
  }

  if (!backgroundRemovalClient || backgroundRemovalClientApiKey !== apiKey) {
    // Major-locked instead of @latest: @latest currently resolves to 1.3.2, so
    // @1 is behaviourally identical today while preventing a future 2.x release
    // from being pulled in silently.
    const { Runware } = await import('https://cdn.jsdelivr.net/npm/@runware/sdk-js@1/+esm');
    // Check the key ourselves first: Runware.initialize()'s own failure
    // detection can take up to a minute to report an invalid key instead of
    // failing fast - see runware-connection.js for why.
    await checkRunwareApiKey(apiKey);
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
        : imageData?.imageURL);

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
    ui.notifications.error(`${MODULE_NAME}: Background removal failed - ${getRunwareErrorMessage(error)}`);
    return null;
  }
}

/**
 * Shows a dialog to select one from multiple generated images.
 * @param {Array<Object>} imagesData - Array of generated image data.
 * @returns {Promise<Object|null>} The selected image data, or null if none selected.
 */
async function showImageSelectionDialog(imagesData) {
  const getPreviewSrc = (image) => {
    if (image?.imageBase64Data) {
      return image.imageBase64Data.startsWith('data:')
        ? image.imageBase64Data
        : `data:image/png;base64,${image.imageBase64Data}`;
    }
    if (image?.imageURL) return image.imageURL;
    return '';
  };

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
    const previewSrc = getPreviewSrc(img);
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

// Export module constants for use in other module files
export { MODULE_ID, MODULE_NAME };
