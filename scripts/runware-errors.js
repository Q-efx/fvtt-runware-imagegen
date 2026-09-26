/**
 * Helpers for interpreting errors thrown by the Runware SDK.
 *
 * The SDK does not always reject with a proper `Error`. Depending on where a
 * failure occurs it can reject with:
 *   - a real `Error` (errors this module constructs itself, e.g. "No images
 *     were generated")
 *   - the raw server message the SDK receives during websocket
 *     authentication / task listening, shaped `{ error: { code, message, ... } }`
 *   - the raw server payload shape documented by the Runware API,
 *     `{ errors: [{ code, message, ... }] }` (the shape pasted in the
 *     "Invalid API key" report this module was built to handle)
 *   - a bare string
 *
 * `getRunwareErrorMessage()` normalises all of these into one readable
 * string. `isInvalidApiKeyError()` flags the one case (`code: 'invalidApiKey'`)
 * callers want to react to with a more actionable message.
 */

import { RUNWARE_RESULT_TIMEOUT_MS } from './constants.js';

function extractErrorDetail(error) {
  if (!error || typeof error !== 'object') return null;
  if (error.error && typeof error.error === 'object') return error.error;
  if (Array.isArray(error.errors) && error.errors.length > 0) return error.errors[0];
  return null;
}

// The SDK rejects with this bare string when a task's result doesn't arrive
// within its timeoutDuration (see runware-client.js).
const SDK_TIMEOUT_PREFIX = 'Response could not be received from server';

export function getRunwareErrorMessage(error) {
  const detail = extractErrorDetail(error);
  if (detail?.message) return detail.message;

  if (typeof error === 'string' && error.startsWith(SDK_TIMEOUT_PREFIX)) {
    const minutes = Math.round(RUNWARE_RESULT_TIMEOUT_MS / 60000);
    return `Runware did not return the result within ${minutes} minutes. It may still show up in `
      + 'your Runware dashboard, but it was not received here. Try fewer steps, a smaller size or '
      + 'fewer images.';
  }

  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (typeof error?.message === 'string' && error.message) return error.message;

  return 'Unknown error';
}

export function isInvalidApiKeyError(error) {
  const detail = extractErrorDetail(error);
  return detail?.code === 'invalidApiKey';
}
