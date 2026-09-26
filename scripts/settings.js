/**
 * Module settings
 *
 * Every world setting and the preset menu, registered from the init hook.
 */

import { RunwarePresetConfig } from './preset-config.js';
import {
  MODULE_ID,
  LIMITS,
  DEFAULT_BACKGROUND_REMOVAL_MODEL,
  DEFAULT_RING_MATERIAL,
  DEFAULT_BACKGROUND_SCENE,
  DEFAULT_RING_PROMPT_TEMPLATE,
  DEFAULT_RING_NEGATIVE_PROMPT_TEMPLATE,
  DEFAULT_BACKGROUND_PROMPT_TEMPLATE,
  DEFAULT_BACKGROUND_NEGATIVE_PROMPT_TEMPLATE
} from './constants.js';

/**
 * Register the module settings and the preset manager menu. Call once, from
 * the `init` hook.
 * @param {Object} [options]
 * @param {(value: string) => void} [options.onApiKeyChange] - Called on the GM's
 *   client when the API key changes (e.g. to verify it)
 */
export function registerSettings({ onApiKeyChange } = {}) {
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
      onApiKeyChange?.(value);
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
    hint: 'Default width for generated images (multiple of 64)',
    scope: 'world',
    config: true,
    type: Number,
    default: LIMITS.dimension.fallback,
    range: {
      min: LIMITS.dimension.min,
      max: LIMITS.dimension.max,
      step: LIMITS.dimension.step
    }
  });

  game.settings.register(MODULE_ID, 'imageHeight', {
    name: 'Image Height',
    hint: 'Default height for generated images (multiple of 64)',
    scope: 'world',
    config: true,
    type: Number,
    default: LIMITS.dimension.fallback,
    range: {
      min: LIMITS.dimension.min,
      max: LIMITS.dimension.max,
      step: LIMITS.dimension.step
    }
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

  // Background removal and generated token assets. A blank model or template
  // falls back to its DEFAULT_* constant (see asset-generation.js), so
  // clearing a field is how a GM restores the default.
  game.settings.register(MODULE_ID, 'backgroundRemovalModel', {
    name: 'Background Removal Model',
    hint: 'Runware model used for every background removal. bria:2@1 (Bria RMBG 2.0) is the default; '
      + 'runware:109@1 (RemBG 1.4) is far cheaper but rougher. Leave empty to restore the default.',
    scope: 'world',
    config: true,
    type: String,
    default: DEFAULT_BACKGROUND_REMOVAL_MODEL
  });

  game.settings.register(MODULE_ID, 'ringPromptTemplate', {
    name: 'Ring Prompt Template',
    hint: 'Prompt used to generate a custom token ring. Placeholders: {material} (the ring material, '
      + `"${DEFAULT_RING_MATERIAL}") and {prompt} (the character's generation prompt). `
      + 'Leave empty to restore the default.',
    scope: 'world',
    config: true,
    type: String,
    default: DEFAULT_RING_PROMPT_TEMPLATE
  });

  game.settings.register(MODULE_ID, 'ringNegativePromptTemplate', {
    name: 'Ring Negative Prompt Template',
    hint: 'Negative prompt used to generate a custom token ring. Same placeholders as the ring prompt: '
      + '{material} and {prompt}. Leave empty to restore the default.',
    scope: 'world',
    config: true,
    type: String,
    default: DEFAULT_RING_NEGATIVE_PROMPT_TEMPLATE
  });

  game.settings.register(MODULE_ID, 'backgroundPromptTemplate', {
    name: 'Background Prompt Template',
    hint: 'Prompt used to generate a new portrait or token background. Placeholders: {scene} (the default '
      + `scene, "${DEFAULT_BACKGROUND_SCENE}") and {prompt} (the character's generation prompt - using it `
      + 'can paint the character into the background). Leave empty to restore the default.',
    scope: 'world',
    config: true,
    type: String,
    default: DEFAULT_BACKGROUND_PROMPT_TEMPLATE
  });

  game.settings.register(MODULE_ID, 'backgroundNegativePromptTemplate', {
    name: 'Background Negative Prompt Template',
    hint: 'Negative prompt used to generate a new background. Same placeholders as the background prompt: '
      + '{scene} and {prompt}. Leave empty to restore the default.',
    scope: 'world',
    config: true,
    type: String,
    default: DEFAULT_BACKGROUND_NEGATIVE_PROMPT_TEMPLATE
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
}
