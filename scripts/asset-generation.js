/**
 * Paid Runware calls for the "Use this image" step: background removal, ring
 * generation, and background generation, plus the pure helpers the output
 * dialog uses to build prompts and price an Apply.
 *
 * Nothing here calls ui.notifications. Every export either returns a result or
 * throws a readable Error; the caller (the output dialog, or module.js's plan
 * executor) decides how to report it. That keeps one failure from producing
 * two toasts when a caller also reports it.
 */

import {
  MODULE_ID,
  LIMITS,
  TOKEN_SIZE,
  RING_INNER_RADIUS,
  RING_GENERATION_SIZE,
  DEFAULT_BACKGROUND_REMOVAL_MODEL,
  DEFAULT_RING_MATERIAL,
  DEFAULT_BACKGROUND_SCENE,
  DEFAULT_RING_PROMPT_TEMPLATE,
  DEFAULT_RING_NEGATIVE_PROMPT_TEMPLATE,
  DEFAULT_BACKGROUND_PROMPT_TEMPLATE,
  DEFAULT_BACKGROUND_NEGATIVE_PROMPT_TEMPLATE
} from './constants.js';
import { getRunwareClient, downloadRunwareImage, RUNWARE_OUTPUT_PARAMS } from './runware-client.js';
import { getRunwareErrorMessage } from './runware-errors.js';
import { punchCircle, toDataURI } from './image-compositor.js';
import { applyModelRestrictions, comparePresets, withBuiltinPresets } from './model-catalog.js';

/**
 * @typedef {Object} ModelParams
 * The generation settings a ring/background request inherits from the
 * portrait request, so they come out in the same style. Deliberately excludes
 * width/height/numberResults/seed/prompts/outputType: each asset sets its own
 * size and prompts, always wants exactly one image, and reusing the portrait's
 * seed would just reproduce its composition.
 * @property {string} model
 * @property {Array<{model: string, weight: number}>} [lora]
 * @property {string} [vae]
 * @property {Array<{model: string, weight: number}>} [embeddings]
 * @property {number} [steps]
 * @property {number} [CFGScale]
 */

/** Cache key of the background-removed subject in the output dialog's assetCache. */
export const SUBJECT_CACHE_KEY = 'subject';

/**
 * Parse a value as a finite number, or return null for blank/invalid input.
 * Same semantics as dialog.js: a legitimate 0 is kept.
 */
function toFiniteNumber(value) {
  if (value === undefined || value === null || `${value}`.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, { min, max }) {
  return Math.min(max, Math.max(min, value));
}

function isNonBlankString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** Strip a `data:...;base64,` prefix, if any, leaving raw base64. */
function stripDataPrefix(base64) {
  return typeof base64 === 'string' ? base64.replace(/^data:[^,]*,/, '') : base64;
}

/**
 * Clamp a width/height to Runware's accepted range and snap it to a multiple
 * of 64. Identical to dialog.js's normalizeDimension(): blank/invalid input
 * falls back to LIMITS.dimension.fallback.
 * @param {*} value
 * @returns {number}
 */
export function clampDimension(value) {
  const { step, fallback } = LIMITS.dimension;
  const number = toFiniteNumber(value);
  if (number === null) return fallback;
  return clamp(Math.round(number / step) * step, LIMITS.dimension);
}

/**
 * Size of a generated token background: square, at least TOKEN_SIZE, and no
 * larger than the portrait's shorter edge otherwise.
 * @param {{width: number, height: number}} portraitSize
 * @returns {{width: number, height: number}}
 */
export function tokenBackgroundSize(portraitSize) {
  const width = toFiniteNumber(portraitSize?.width) ?? TOKEN_SIZE;
  const height = toFiniteNumber(portraitSize?.height) ?? TOKEN_SIZE;
  const size = clampDimension(Math.max(TOKEN_SIZE, Math.min(width, height)));
  return { width: size, height: size };
}

function copyWeightedModels(list) {
  if (!Array.isArray(list)) return undefined;
  return list.map((entry) => ({ model: entry?.model, weight: entry?.weight }));
}

/**
 * Copy the style-defining parameters out of a portrait request (see
 * ModelParams for what is left out and why). Returns a deep copy, so later
 * edits to either object don't leak into the other.
 * @param {Object} requestParams - the params passed to runware.requestImages()
 * @returns {ModelParams}
 */
export function extractModelParams(requestParams) {
  const source = requestParams ?? {};
  const params = {};
  if (source.model !== undefined && source.model !== null) params.model = source.model;
  if (source.lora != null) params.lora = copyWeightedModels(source.lora);
  if (source.vae !== undefined && source.vae !== null) params.vae = source.vae;
  if (source.embeddings != null) params.embeddings = copyWeightedModels(source.embeddings);
  if (source.steps !== undefined && source.steps !== null) params.steps = source.steps;
  if (source.CFGScale !== undefined && source.CFGScale !== null) params.CFGScale = source.CFGScale;
  return params;
}

function sanitizeWeightedModels(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((entry) => isNonBlankString(entry?.model))
    .map((entry) => ({
      model: entry.model.trim(),
      weight: clamp(toFiniteNumber(entry.weight) ?? 1, LIMITS.weight)
    }));
}

/**
 * The request fields of ModelParams, clamped to LIMITS, with a fixed key
 * order. Shared by sanitizeModelParams() and the cache keys, so two
 * ModelParams share a key exactly when they would send the same request.
 * `model` is '' when none is set.
 * @param {ModelParams} modelParams
 * @returns {Object} request fields
 */
function normalizeModelParams(modelParams) {
  const source = modelParams ?? {};
  const params = { model: isNonBlankString(source.model) ? source.model.trim() : '' };

  const lora = sanitizeWeightedModels(source.lora);
  if (lora.length > 0) params.lora = lora;

  if (isNonBlankString(source.vae)) params.vae = source.vae.trim();

  const embeddings = sanitizeWeightedModels(source.embeddings);
  if (embeddings.length > 0) params.embeddings = embeddings;

  const steps = toFiniteNumber(source.steps);
  if (steps !== null) params.steps = Math.round(clamp(steps, LIMITS.steps));

  const cfgScale = toFiniteNumber(source.CFGScale);
  if (cfgScale !== null) params.CFGScale = clamp(cfgScale, LIMITS.cfgScale);

  return params;
}

/**
 * Re-clamp ModelParams before a paid request. They were clamped once when the
 * portrait was generated (or come from a GM's preset), but they pass through
 * the output dialog, so don't trust them blindly - every request costs money.
 * @param {ModelParams} modelParams
 * @returns {Object} request fields
 */
function sanitizeModelParams(modelParams) {
  const params = normalizeModelParams(modelParams);
  if (!params.model) {
    throw new Error('No image model is set for this request.');
  }
  return params;
}

/**
 * Whether ModelParams name a model at all. A free check for callers that want
 * to refuse before paying for anything else (a background removal before the
 * background, say); sanitizeModelParams() throws on the same condition.
 * @param {ModelParams} modelParams
 * @returns {boolean}
 */
export function hasImageModel(modelParams) {
  return normalizeModelParams(modelParams).model !== '';
}

/**
 * Stable text form of ModelParams for cache keys: the clamped request fields,
 * so a background made with one model or preset is never reused for another.
 * @param {ModelParams} modelParams
 * @returns {string}
 */
function modelParamsKey(modelParams) {
  return JSON.stringify(normalizeModelParams(modelParams));
}

/**
 * ModelParams for a generation preset (world setting `generationPresets`, see
 * preset-config.js), matching what the generation form sends after applying
 * that preset. The LoRA trigger is not part of it: the form prepends it to the
 * prompt, and ring/background prompts are the user's own.
 * @param {Object} rawPreset - a stored preset
 * @returns {ModelParams|null} null for an invalid preset (no name or no
 *   model, the same rule as dialog.js's _mapPreset())
 */
export function presetToModelParams(rawPreset) {
  if (!isNonBlankString(rawPreset?.name) || !isNonBlankString(rawPreset?.model)) return null;

  // The form sends one LoRA and the embeddings with a blank weight as 1, both
  // clamped - exactly what normalizeModelParams() does to the stored values.
  return normalizeModelParams({
    model: rawPreset.model,
    lora: rawPreset.lora ? [rawPreset.lora] : undefined,
    vae: rawPreset.vae,
    embeddings: rawPreset.embeddings,
    steps: rawPreset.steps,
    CFGScale: rawPreset.cfgScale
  });
}

/**
 * Valid generation presets as ModelParams, in comparePresets() order (the
 * GM's own by name, then the built-ins).
 * @param {Array<Object>} rawPresets - the stored and enabled built-in presets,
 *   see loadPresets()
 * @returns {Array<{id: string, name: string, modelParams: ModelParams, loraTrigger: string}>}
 *   loraTrigger is '' unless the preset has a LoRA with a trigger word
 */
export function listPresets(rawPresets) {
  if (!Array.isArray(rawPresets)) return [];

  const seen = new Set();
  const presets = [];
  for (const rawPreset of rawPresets) {
    const modelParams = presetToModelParams(rawPreset);
    if (!modelParams) continue;
    // preset-config.js always stores an id; the name is only a fallback.
    const id = isNonBlankString(rawPreset.id) ? rawPreset.id : `name:${rawPreset.name.trim()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    presets.push({
      id,
      name: rawPreset.name.trim(),
      modelParams,
      loraTrigger: modelParams.lora && isNonBlankString(rawPreset.lora?.trigger)
        ? rawPreset.lora.trigger.trim()
        : ''
    });
  }
  return presets.sort(comparePresets);
}

/**
 * The world's generation presets (listPresets()): the GM's own plus the
 * built-in presets the GM enabled, telling a failed read of the
 * `generationPresets` setting apart from "no presets".
 * @param {*} [rawPresets] - the stored presets, as the `presetsUpdated` hook
 *   passes them; the setting is read when this is not an array
 * @returns {{presets: Array<Object>, loaded: boolean}} loaded is false (and
 *   a warning logged) when the setting could not be read or holds no list
 */
export function loadPresets(rawPresets) {
  let value = rawPresets;
  if (!Array.isArray(value)) {
    try {
      value = game.settings.get(MODULE_ID, 'generationPresets');
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not read the generation presets:`, error);
      return { presets: [], loaded: false };
    }
  }
  if (!Array.isArray(value)) {
    console.warn(`${MODULE_ID} | The generation presets setting is not a list:`, value);
    return { presets: [], loaded: false };
  }
  return { presets: listPresets(withBuiltinPresets(value)), loaded: true };
}

/**
 * Read a world setting of this module, or undefined if it can't be read
 * (not registered yet, or a system that broke settings access).
 */
function readSetting(key) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch (error) {
    console.debug(`${MODULE_ID} | Could not read setting "${key}", using the default.`, error);
    return undefined;
  }
}

/**
 * Runware model used for every background removal.
 * @returns {string} the `backgroundRemovalModel` setting, or
 *   DEFAULT_BACKGROUND_REMOVAL_MODEL when it is blank or unreadable
 */
export function getBackgroundRemovalModel() {
  const value = readSetting('backgroundRemovalModel');
  return isNonBlankString(value) ? value.trim() : DEFAULT_BACKGROUND_REMOVAL_MODEL;
}

/**
 * The GM's prompt templates. A blank setting means "use the default", so a GM
 * can restore a default by clearing the field.
 * @returns {{ringPositive: string, ringNegative: string,
 *   backgroundPositive: string, backgroundNegative: string}}
 */
export function getPromptTemplates() {
  const read = (key, fallback) => {
    const value = readSetting(key);
    return isNonBlankString(value) ? value : fallback;
  };
  return {
    ringPositive: read('ringPromptTemplate', DEFAULT_RING_PROMPT_TEMPLATE),
    ringNegative: read('ringNegativePromptTemplate', DEFAULT_RING_NEGATIVE_PROMPT_TEMPLATE),
    backgroundPositive: read('backgroundPromptTemplate', DEFAULT_BACKGROUND_PROMPT_TEMPLATE),
    backgroundNegative: read('backgroundNegativePromptTemplate', DEFAULT_BACKGROUND_NEGATIVE_PROMPT_TEMPLATE)
  };
}

/**
 * Replace `{name}` placeholders with `vars[name]`. A placeholder whose
 * variable is unknown or empty is left verbatim, so a typo in a GM's template
 * stays visible in the prefilled prompt instead of silently vanishing.
 * @param {string} template
 * @param {Object<string, *>} vars
 * @returns {string} trimmed result
 */
export function fillTemplate(template, vars = {}) {
  const values = vars ?? {};
  return String(template ?? '')
    .replace(/\{(\w+)\}/g, (placeholder, name) => {
      if (!Object.hasOwn(values, name)) return placeholder;
      const value = values[name];
      if (value === undefined || value === null) return placeholder;
      const text = String(value);
      return text.trim() === '' ? placeholder : text;
    })
    .trim();
}

/**
 * Prompts the output dialog prefills. `{scene}` is a neutral default scene,
 * not the character prompt, which would paint the character into its own
 * background; a GM can opt into `{prompt}` by editing the template.
 * @param {{generationPrompt?: string}} [options]
 * @returns {{ringPrompt: string, ringNegativePrompt: string,
 *   backgroundPrompt: string, backgroundNegativePrompt: string}}
 */
export function getDefaultPrompts({ generationPrompt = '' } = {}) {
  const templates = getPromptTemplates();
  const vars = {
    material: DEFAULT_RING_MATERIAL,
    scene: DEFAULT_BACKGROUND_SCENE,
    prompt: String(generationPrompt ?? '').trim()
  };
  return {
    ringPrompt: fillTemplate(templates.ringPositive, vars),
    ringNegativePrompt: fillTemplate(templates.ringNegative, vars),
    backgroundPrompt: fillTemplate(templates.backgroundPositive, vars),
    backgroundNegativePrompt: fillTemplate(templates.backgroundNegative, vars)
  };
}

async function getClient() {
  // Read the key per call, like dialog.js, so a key the GM fixes while the
  // output dialog is open takes effect on the next attempt.
  return getRunwareClient(game.settings.get(MODULE_ID, 'apiKey'));
}

/**
 * Request exactly one image with the inherited model settings.
 * @returns {Promise<Object>} the first result, guaranteed to carry imageBase64Data
 */
async function requestSingleImage({ prompt, negativePrompt, modelParams, width, height }) {
  const requestParams = {
    ...sanitizeModelParams(modelParams),
    positivePrompt: prompt.trim(),
    width: clampDimension(width),
    height: clampDimension(height),
    numberResults: 1,
    ...RUNWARE_OUTPUT_PARAMS
  };
  if (isNonBlankString(negativePrompt)) {
    requestParams.negativePrompt = negativePrompt.trim();
  }
  // Prompt-only partner models reject the negative prompt the ring and
  // background templates always fill in, and steps/CFG/LoRA from the preset.
  applyModelRestrictions(requestParams);

  console.debug(`${MODULE_ID} | Requesting asset image:`, requestParams);

  const runware = await getClient();
  const images = await runware.requestImages(requestParams);
  const image = Array.isArray(images) ? images[0] : images;
  if (!image?.imageURL && !image?.imageBase64Data) {
    throw new Error('No image was generated.');
  }
  return downloadRunwareImage(image);
}

/**
 * Remove the background from an image.
 * @param {{imageBase64Data?: string, imageUUID?: string}} imageData
 *   A Runware image (its UUID is sent when present, saving the upload) or a
 *   local `{ imageBase64Data }`.
 * @returns {Promise<{imageBase64Data: string, imageUUID?: string}>} raw base64 WebP
 * @throws {Error} "Background removal failed: ..."
 */
export async function removeBackground(imageData) {
  try {
    const inputImage = imageData?.imageUUID ?? toDataURI(imageData);
    if (!inputImage) {
      throw new Error('No image data available for background removal.');
    }

    const runware = await getClient();
    const response = await runware.removeImageBackground({
      inputImage,
      model: getBackgroundRemovalModel(),
      ...RUNWARE_OUTPUT_PARAMS
    });

    const returned = Array.isArray(response) ? response[0] : response;
    // Without a new image a caller could fall back to the original and
    // silently save the un-removed image as if removal had worked.
    if (!returned?.imageURL && !returned?.imageBase64Data) {
      throw new Error('Background removal did not return an image.');
    }
    const result = await downloadRunwareImage(returned);

    const removed = { imageBase64Data: stripDataPrefix(result.imageBase64Data) };
    if (result.imageUUID) removed.imageUUID = result.imageUUID;
    return removed;
  } catch (error) {
    throw new Error(`Background removal failed: ${getRunwareErrorMessage(error)}`);
  }
}

/**
 * Generate a custom token ring: one image, one background removal, then a
 * local cut that empties the centre and everything outside the ring.
 * @param {Object} options
 * @param {string} options.prompt
 * @param {string} [options.negativePrompt]
 * @param {ModelParams} options.modelParams
 * @param {(text: string) => void} [options.onStatus] progress text callback
 * @returns {Promise<{imageBase64Data: string}>} square transparent WebP
 * @throws {Error} on a blank prompt, or "Ring generation failed: ..." /
 *   "Background removal failed: ..."
 */
export async function generateRing({ prompt, negativePrompt, modelParams, onStatus } = {}) {
  if (!isNonBlankString(prompt)) throw new Error('Enter a ring prompt.');

  let ring;
  try {
    onStatus?.('Generating ring…');
    ring = await requestSingleImage({
      prompt,
      negativePrompt,
      modelParams,
      width: RING_GENERATION_SIZE,
      height: RING_GENERATION_SIZE
    });
  } catch (error) {
    throw new Error(`Ring generation failed: ${getRunwareErrorMessage(error)}`);
  }

  onStatus?.('Removing ring background…');
  // Already prefixed "Background removal failed: ..." - don't wrap it twice.
  const removed = await removeBackground(ring);

  try {
    // The model rarely keeps the centre perfectly empty, and the removal can
    // leave specks around the band: cut both away so only the ring remains.
    return await punchCircle(removed, RING_INNER_RADIUS, { outerRadius: 1 });
  } catch (error) {
    throw new Error(`Ring generation failed: ${getRunwareErrorMessage(error)}`);
  }
}

/**
 * Generate a background image for a portrait or token.
 * @param {Object} options
 * @param {string} options.prompt
 * @param {string} [options.negativePrompt]
 * @param {ModelParams} options.modelParams
 * @param {number} options.width - clamped with clampDimension()
 * @param {number} options.height - clamped with clampDimension()
 * @returns {Promise<{imageBase64Data: string, imageUUID?: string}>}
 * @throws {Error} on a blank prompt, or "Background generation failed: ..."
 */
export async function generateBackground({ prompt, negativePrompt, modelParams, width, height } = {}) {
  if (!isNonBlankString(prompt)) throw new Error('Enter a background prompt.');

  try {
    const image = await requestSingleImage({ prompt, negativePrompt, modelParams, width, height });
    const background = { imageBase64Data: stripDataPrefix(image.imageBase64Data) };
    if (image.imageUUID) background.imageUUID = image.imageUUID;
    return background;
  } catch (error) {
    throw new Error(`Background generation failed: ${getRunwareErrorMessage(error)}`);
  }
}

/**
 * Cache key of a generated background in the output dialog's assetCache. Two
 * requests share a key only if they would produce an equivalent image, so the
 * model settings are part of it.
 * @param {{prompt: string, negativePrompt: string, width: number, height: number,
 *   modelParams: ModelParams}} options
 * @returns {string}
 */
export function backgroundCacheKey({ prompt, negativePrompt, width, height, modelParams }) {
  return `background:${width}x${height}:${modelParamsKey(modelParams)}\u0000${prompt}\u0000${negativePrompt}`;
}

/**
 * The background request an OutputPlan makes for one output: the one place
 * its cache key is computed, used by the paid-call summary, the dialog, and
 * module.js's executeOutputPlan(), so they always agree on what is cached.
 * The prompt is not validated; generateBackground() rejects a blank one.
 * @param {Object|null} plan - an OutputPlan from the output dialog
 * @param {'portrait'|'token'} target
 * @returns {{key: string, prompt: string, negativePrompt: string, width: number,
 *   height: number, modelParams: ModelParams}|null} null when that output
 *   doesn't generate a background. A token with `sameBackgroundAsPortrait`
 *   resolves to the portrait's request (same key, one generation).
 */
export function getBackgroundRequest(plan, target) {
  const output = target === 'portrait' || target === 'token' ? plan?.[target] : null;
  if (output?.background !== 'generate') return null;

  if (target === 'token' && output.sameBackgroundAsPortrait) {
    const portraitRequest = getBackgroundRequest(plan, 'portrait');
    if (portraitRequest) return portraitRequest;
  }

  const request = {
    prompt: String(output.backgroundPrompt ?? '').trim(),
    negativePrompt: String(output.backgroundNegativePrompt ?? '').trim(),
    width: clampDimension(output.backgroundSize?.width),
    height: clampDimension(output.backgroundSize?.height),
    modelParams: plan.modelParams ?? null
  };
  return { key: backgroundCacheKey(request), ...request };
}

function pluralize(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Whether an OutputPlan needs the subject with its background removed: a
 * portrait that doesn't keep its background, or any token (always transparent).
 * @param {Object|null} plan - an OutputPlan
 * @returns {boolean}
 */
export function planNeedsSubject(plan) {
  const portrait = plan?.portrait ?? null;
  return Boolean((portrait && portrait.background !== 'keep') || plan?.token);
}

/**
 * Count the paid calls an Apply would make, skipping anything already in the
 * cache from an earlier attempt. Ring generation is not counted: it is its
 * own explicit, separately labelled button.
 * @param {Object|null} plan - an OutputPlan from the output dialog
 * @param {Map<string, {imageData: Object}>} [cache] - the dialog's assetCache
 * @returns {{removals: number, backgroundGenerations: number, total: number, text: string}}
 *   text is e.g. "1 background removal, 2 background generations", or '' when nothing is paid
 */
export function summarizePaidCalls(plan, cache) {
  const isCached = (key) => Boolean(cache?.get?.(key)?.imageData);

  // At most one subject removal per Apply, shared by portrait and token.
  const removals = planNeedsSubject(plan) && !isCached(SUBJECT_CACHE_KEY) ? 1 : 0;

  let backgroundGenerations = 0;
  const portraitKey = getBackgroundRequest(plan, 'portrait')?.key ?? null;
  if (portraitKey && !isCached(portraitKey)) backgroundGenerations += 1;

  const tokenKey = getBackgroundRequest(plan, 'token')?.key ?? null;
  // The portrait's own request ("same background"), or an identical one, is
  // served from the cache once the portrait background exists: not paid twice.
  if (tokenKey && tokenKey !== portraitKey && !isCached(tokenKey)) backgroundGenerations += 1;

  const parts = [];
  if (removals > 0) parts.push(pluralize(removals, 'background removal'));
  if (backgroundGenerations > 0) parts.push(pluralize(backgroundGenerations, 'background generation'));

  return {
    removals,
    backgroundGenerations,
    total: removals + backgroundGenerations,
    text: parts.join(', ')
  };
}
