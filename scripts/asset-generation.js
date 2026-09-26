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
import { getRunwareClient } from './runware-client.js';
import { getRunwareErrorMessage } from './runware-errors.js';
import { punchCircle, toDataURI } from './image-compositor.js';

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
 * Re-clamp ModelParams before a paid request. They were clamped once when the
 * portrait was generated, but they pass through the output dialog's options,
 * so don't trust them blindly - every request costs money.
 * @param {ModelParams} modelParams
 * @returns {Object} request fields
 */
function sanitizeModelParams(modelParams) {
  const source = modelParams ?? {};
  if (!isNonBlankString(source.model)) {
    throw new Error('No image model is set for this request.');
  }

  const params = { model: source.model.trim() };

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
    outputType: 'base64Data',
    outputFormat: 'PNG'
  };
  if (isNonBlankString(negativePrompt)) {
    requestParams.negativePrompt = negativePrompt.trim();
  }

  console.debug(`${MODULE_ID} | Requesting asset image:`, requestParams);

  const runware = await getClient();
  const images = await runware.requestImages(requestParams);
  const image = Array.isArray(images) ? images[0] : images;
  if (!image?.imageBase64Data) {
    throw new Error('No image was generated.');
  }
  return image;
}

/**
 * Remove the background from an image.
 * @param {{imageBase64Data?: string, imageUUID?: string}} imageData
 *   A Runware image (its UUID is sent when present, saving the upload) or a
 *   local `{ imageBase64Data }`.
 * @returns {Promise<{imageBase64Data: string, imageUUID?: string}>} raw base64 PNG
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
      outputType: 'base64Data',
      outputFormat: 'PNG'
    });

    const result = Array.isArray(response) ? response[0] : response;
    // Without new base64 data a caller could fall back to the original and
    // silently save the un-removed image as if removal had worked.
    if (!result?.imageBase64Data) {
      throw new Error('Background removal did not return an image.');
    }

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
 * @returns {Promise<{imageBase64Data: string}>} square transparent PNG
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
 * requests share a key only if they would produce an equivalent image.
 * @param {{prompt: string, negativePrompt: string, width: number, height: number}} options
 * @returns {string}
 */
export function backgroundCacheKey({ prompt, negativePrompt, width, height }) {
  return `background:${width}x${height}:${prompt}\u0000${negativePrompt}`;
}

function portraitBackgroundKey(portrait) {
  return backgroundCacheKey({
    prompt: portrait.backgroundPrompt,
    negativePrompt: portrait.backgroundNegativePrompt,
    width: portrait.backgroundSize?.width,
    height: portrait.backgroundSize?.height
  });
}

function tokenBackgroundKey(token) {
  return backgroundCacheKey({
    prompt: token.backgroundPrompt,
    negativePrompt: token.backgroundNegativePrompt,
    width: token.backgroundSize?.width,
    height: token.backgroundSize?.height
  });
}

function pluralize(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
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
  const portrait = plan?.portrait ?? null;
  const token = plan?.token ?? null;

  // At most one subject removal per Apply, shared by portrait and token.
  const needsSubject = (portrait && portrait.background !== 'keep') || Boolean(token);
  const removals = needsSubject && !isCached(SUBJECT_CACHE_KEY) ? 1 : 0;

  let backgroundGenerations = 0;
  const portraitKey = portrait?.background === 'generate' ? portraitBackgroundKey(portrait) : null;
  if (portraitKey && !isCached(portraitKey)) backgroundGenerations += 1;

  if (token?.background === 'generate' && !token.sameBackgroundAsPortrait) {
    const tokenKey = tokenBackgroundKey(token);
    // An identical request to the portrait's is served from the cache once
    // the portrait background exists, so it isn't paid twice.
    if (tokenKey !== portraitKey && !isCached(tokenKey)) backgroundGenerations += 1;
  }

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
