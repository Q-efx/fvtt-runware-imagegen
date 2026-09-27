/**
 * Built-in generation presets and the request rules of the models they use.
 *
 * The built-in presets ship with the module (they are not stored in the
 * `generationPresets` setting) and are off until the GM enables them in the
 * preset manager; the world setting `builtinPresets` holds that choice.
 */

import { MODULE_ID } from './constants.js';

// Partner models that take a prompt, a size and a seed, but no steps, CFG
// scale, LoRA, VAE or embeddings - and most of them no negative prompt either.
// Keyed by AIR id, so the rules apply however the model was picked (a
// built-in preset, a GM preset, or typed into the form). `minPixels` is the
// smallest width x height the model accepts. `moderation` names the
// PERMISSIVE_MODERATION entry the model gets.
const RESTRICTED_MODELS = Object.freeze({
  'alibaba:qwen-image@3.0': { negativePrompt: true },
  'alibaba:qwen-image@3.0-pro': { negativePrompt: true },
  'bfl:5@1': { negativePrompt: false, moderation: 'bfl' },
  'bfl:7@1': { negativePrompt: false, moderation: 'bfl' },
  'openai:gpt-image@2': { negativePrompt: false, minPixels: 655360, moderation: 'openai' },
  'openai:gpt-image@2.5-flare': { negativePrompt: false, minPixels: 655360, moderation: 'openai' },
  'openai:gpt-image@2.5-sunburst': { negativePrompt: false, minPixels: 655360, moderation: 'openai' },
  'bytedance:seedream@5.0-pro': { negativePrompt: false, minPixels: 921600 }
});

// The most permissive content moderation each provider allows, so dark,
// bloody or horror characters aren't refused. FLUX.2's safetyTolerance goes
// 0-5 (default 2); GPT Image takes 'auto' (default) or 'low'. Seedream and
// Qwen have no such setting. Runware's own NSFW check (`safety.checkContent`)
// is off unless requested, so it is never sent.
const PERMISSIVE_MODERATION = Object.freeze({
  bfl: () => ({ providerSettings: { bfl: { safetyTolerance: 5 } } }),
  openai: () => ({ settings: { moderation: 'low' } })
});

// Request fields the restricted models reject. negativePrompt is decided per
// model, see RESTRICTED_MODELS.
const UNSUPPORTED_FIELDS = Object.freeze(['steps', 'CFGScale', 'lora', 'vae', 'embeddings']);

// 2:3 at 1024x1536: the smallest 2:3 size (in multiples of 64) that every model
// below accepts, and its 1024x1024 token background still meets their minimums.
const PORTRAIT_2_3 = Object.freeze({ width: 1024, height: 1536 });

/**
 * The presets that ship with the module, in the order they are listed.
 * Same shape as a stored preset (see preset-config.js), plus `cost` and `note`
 * for the preset manager. Ids start with `builtin:`, which a stored preset's
 * random id never does.
 */
export const BUILTIN_PRESETS = Object.freeze([
  {
    id: 'builtin:qwen-image-3',
    name: 'Premium Illustration (Qwen-Image 3.0)',
    model: 'alibaba:qwen-image@3.0',
    cost: '~$0.03',
    note: 'Accepts negative prompts.'
  },
  {
    id: 'builtin:qwen-image-3-pro',
    name: 'Premium Illustration+ (Qwen-Image 3.0 Pro)',
    model: 'alibaba:qwen-image@3.0-pro',
    cost: '~$0.04-0.075',
    note: 'Accepts negative prompts.'
  },
  {
    id: 'builtin:flux-2-pro',
    name: 'Premium Painterly (FLUX.2 pro)',
    model: 'bfl:5@1',
    cost: '~$0.04',
    note: 'Best value of the FLUX.2 line.'
  },
  {
    id: 'builtin:gpt-image-2-5-flare',
    name: 'Premium Prompt-Following (GPT-Image-2.5 Flare)',
    model: 'openai:gpt-image@2.5-flare',
    cost: '~$0.03-0.05',
    note: ''
  },
  {
    id: 'builtin:gpt-image-2',
    name: 'Premium (GPT Image 2)',
    model: 'openai:gpt-image@2',
    cost: '~$0.03-0.05',
    note: 'The previous version of GPT-Image-2.5 Flare.'
  },
  {
    id: 'builtin:seedream-5-pro',
    name: 'Premium Detail (Seedream 5.0 Pro)',
    model: 'bytedance:seedream@5.0-pro',
    cost: '~$0.05-0.10',
    note: 'Needs at least 1024x1536 for a 2:3 portrait.'
  },
  {
    id: 'builtin:flux-2-max',
    name: 'Showcase (FLUX.2 max)',
    model: 'bfl:7@1',
    cost: '~$0.09',
    note: ''
  },
  {
    id: 'builtin:gpt-image-2-5-sunburst',
    name: 'Showcase (GPT-Image-2.5 Sunburst)',
    model: 'openai:gpt-image@2.5-sunburst',
    cost: '~$0.06+',
    note: ''
  }
].map((preset) => Object.freeze({ ...preset, ...PORTRAIT_2_3 })));

/**
 * The GM's on/off choice per built-in preset (world setting `builtinPresets`).
 * @returns {Object<string, boolean>} {} (everything off) when unreadable
 */
function readBuiltinPresetStates() {
  try {
    const value = game.settings.get(MODULE_ID, 'builtinPresets');
    return value && typeof value === 'object' ? value : {};
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not read the built-in preset settings:`, error);
    return {};
  }
}

/**
 * Every built-in preset with whether the GM enabled it. Off unless enabled:
 * they are premium models, and every image is paid by the GM's key.
 * @returns {Array<Object>} BUILTIN_PRESETS entries plus `enabled`
 */
export function getBuiltinPresetStates() {
  const states = readBuiltinPresetStates();
  return BUILTIN_PRESETS.map((preset) => ({ ...preset, enabled: states[preset.id] === true }));
}

/**
 * The presets offered to users: the enabled built-in presets, then the GM's
 * own. The built-ins are the stored-preset shape, so every consumer maps and
 * validates them the same way.
 * @param {Array<Object>} customPresets - the `generationPresets` setting
 * @returns {Array<Object>}
 */
export function withBuiltinPresets(customPresets) {
  const custom = Array.isArray(customPresets) ? customPresets : [];
  const builtin = getBuiltinPresetStates()
    .filter((preset) => preset.enabled)
    .map(({ id, name, model, width, height }) => ({ id, name, model, width, height }));
  return [...custom, ...builtin];
}

/**
 * Sort order for presets: the GM's own by name, then the built-ins in
 * BUILTIN_PRESETS order (cheapest first).
 * @param {{id: string, name: string}} a
 * @param {{id: string, name: string}} b
 * @returns {number}
 */
export function comparePresets(a, b) {
  const rank = (preset) => BUILTIN_PRESETS.findIndex((builtin) => builtin.id === preset.id);
  const rankA = rank(a);
  const rankB = rank(b);
  if (rankA === -1 && rankB === -1) return a.name.localeCompare(b.name);
  if (rankA === -1) return -1;
  if (rankB === -1) return 1;
  return rankA - rankB;
}

/**
 * Drop the request fields a restricted model would reject, and set its most
 * permissive content moderation, in place, right before a paid request. Other
 * models are left untouched.
 * @param {Object} requestParams - the params for runware.requestImages()
 * @returns {string[]} the fields that were dropped (for a warning)
 * @throws {Error} when the image is smaller than the model accepts, before
 *   anything is paid
 */
export function applyModelRestrictions(requestParams) {
  const rules = RESTRICTED_MODELS[requestParams?.model];
  if (!rules) return [];

  const dropped = [];
  const fields = rules.negativePrompt ? UNSUPPORTED_FIELDS : [...UNSUPPORTED_FIELDS, 'negativePrompt'];
  for (const field of fields) {
    if (requestParams[field] === undefined) continue;
    delete requestParams[field];
    dropped.push(field);
  }
  if (rules.moderation) Object.assign(requestParams, PERMISSIVE_MODERATION[rules.moderation]());

  const pixels = (Number(requestParams.width) || 0) * (Number(requestParams.height) || 0);
  if (rules.minPixels && pixels < rules.minPixels) {
    throw new Error(
      `${requestParams.model} needs images of at least ${rules.minPixels.toLocaleString()} pixels `
      + `(e.g. 1024x1536); this request is ${requestParams.width}x${requestParams.height}.`
    );
  }
  return dropped;
}
