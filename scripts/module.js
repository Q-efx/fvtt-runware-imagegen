/**
 * Runware AI Image Generator Module for FoundryVTT
 *
 * This module integrates Runware AI image generation into actor sheets,
 * allowing users to generate character and NPC portraits using AI.
 */

import { RunwareImageDialog } from './dialog.js';
import { ImageFileHandler } from './file-handler.js';

// Module constants
const MODULE_ID = 'runware-imagegen';
const MODULE_NAME = 'Runware AI Image Generator';

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
    class: 'header-button',
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
    onImageGenerated: async (imageData) => {
      await handleGeneratedImage(actor, imageData);
    }
  });

  dialog.render(true);
}

/**
 * Handle the generated image - save it and optionally update actor
 * @param {Actor} actor - The actor document
 * @param {Object} imageData - The generated image data from Runware
 */
async function handleGeneratedImage(actor, imageData) {
  try {
    ui.notifications.info(`${MODULE_NAME}: Saving generated image...`);

    // Save the image using the file handler
    const savedPath = await ImageFileHandler.saveImage(actor, imageData);

    if (savedPath) {
      ui.notifications.info(`${MODULE_NAME}: Image saved successfully at ${savedPath}`);

      // Ask user if they want to set this as the actor's image
      const update = await Dialog.confirm({
        title: 'Set as Actor Image?',
        content: `<p>Would you like to set this as the actor's portrait image?</p>
                  <img src="${savedPath}" style="max-width: 100%; border: 1px solid #000;"/>`,
        yes: () => true,
        no: () => false,
        defaultYes: true
      });

      if (update) {
        await actor.update({ 'img': savedPath });
        ui.notifications.info(`${MODULE_NAME}: Actor image updated`);
      }
    }
  } catch (error) {
    console.error(`${MODULE_NAME} | Error handling generated image:`, error);
    ui.notifications.error(`${MODULE_NAME}: Failed to save image - ${error.message}`);
  }
}

// Export module constants for use in other module files
export { MODULE_ID, MODULE_NAME };
