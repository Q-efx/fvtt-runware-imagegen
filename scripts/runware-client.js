/**
 * Shared Runware SDK client.
 *
 * Both image generation (dialog.js) and background removal (module.js) go
 * through here, so there is exactly one SDK import and at most one open
 * websocket per client instead of one per dialog that was never closed.
 */

import { checkRunwareApiKey } from './runware-connection.js';
import { RUNWARE_RESULT_TIMEOUT_MS, RUNWARE_DOWNLOAD_TIMEOUT_MS } from './constants.js';

// Pinned to an exact version: a runtime `import()` can't carry an SRI hash, so
// a floating range (`@1`, `@latest`) would let any future upstream release -
// or a hijacked one - run in every user's browser with no commit here. Bump
// deliberately after testing.
export const RUNWARE_SDK_URL = 'https://cdn.jsdelivr.net/npm/@runware/sdk-js@1.3.2/+esm';

// Output settings for every Runware task that returns an image. Runware never
// delivers a websocket result whose base64 payload is large: a 1344x2048 PNG
// (8 MB, 11 MB as base64) was generated and billed, but no result or error
// frame ever arrived, while the same request with outputType 'URL' answered
// in seconds. So results come back as a URL and downloadRunwareImage() fetches
// them. The CDN answers with `Access-Control-Allow-Origin: *`.
// WEBP keeps transparency (background removal) and is what the module saves.
export const RUNWARE_OUTPUT_PARAMS = Object.freeze({ outputType: 'URL', outputFormat: 'WEBP' });

let clientPromise = null;
let clientApiKey = null;

async function closeQuietly(pending) {
  try {
    const client = await pending;
    await client?.disconnect?.();
  } catch {
    // The old client either never connected or is already gone.
  }
}

/**
 * Get a connected Runware client for `apiKey`, reusing the cached one when the
 * key hasn't changed. A key change disconnects the previous client.
 * @param {string} apiKey
 * @returns {Promise<object>}
 */
export function getRunwareClient(apiKey) {
  if (!apiKey) {
    return Promise.reject(new Error('Runware API key is not configured.'));
  }

  if (clientPromise && clientApiKey === apiKey) {
    return clientPromise;
  }

  // The cache is updated synchronously, before anything is awaited, so
  // concurrent callers share one connection attempt instead of racing to
  // open (and leak) several.
  const previous = clientPromise;
  const pending = (async () => {
    if (previous) await closeQuietly(previous);
    const { Runware } = await import(RUNWARE_SDK_URL);
    // Check the key ourselves first: Runware.initialize()'s own failure
    // detection can take up to a minute to report an invalid key instead of
    // failing fast - see runware-connection.js for why.
    await checkRunwareApiKey(apiKey);
    return Runware.initialize({
      apiKey,
      timeoutDuration: RUNWARE_RESULT_TIMEOUT_MS,
      // One attempt only. The SDK's default (2) re-sends a task whose result
      // timed out under a new task id, so Runware generates and bills it
      // again while the first result is dropped. A failure is reported
      // instead, and the user decides whether to try again.
      globalMaxRetries: 1
    });
  })();

  clientPromise = pending;
  clientApiKey = apiKey;

  // Don't cache a failed attempt - the next call should retry. Only clear the
  // cache if it still holds this attempt, not a newer one.
  pending.catch(() => {
    if (clientPromise === pending) {
      clientPromise = null;
      clientApiKey = null;
    }
  });

  return pending;
}

/**
 * Only Runware's own hosts are fetched: the URL comes off the network and the
 * download is handed straight to the file upload.
 * @param {unknown} value
 * @returns {URL}
 */
function parseRunwareImageUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Runware did not return an image.');
  }
  const host = url.hostname;
  if (url.protocol !== 'https:' || !(host === 'runware.ai' || host.endsWith('.runware.ai'))) {
    throw new Error(`Runware returned an unexpected image address (${host}).`);
  }
  return url;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : '');
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the downloaded image.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Download a Runware result requested with RUNWARE_OUTPUT_PARAMS and add its
 * raw base64 as `imageBase64Data`, the shape the rest of the module works on.
 * A result that already carries base64 is returned unchanged.
 * @param {{imageURL?: string, imageBase64Data?: string}} result
 * @returns {Promise<Object>} a copy of `result` with `imageBase64Data`
 * @throws {Error} readable, for a missing or foreign URL, an HTTP error, a
 *   non-image response or a timeout
 */
export async function downloadRunwareImage(result) {
  if (result?.imageBase64Data) return result;
  const url = parseRunwareImageUrl(result?.imageURL);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNWARE_DOWNLOAD_TIMEOUT_MS);
  let blob;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    });
    if (!response.ok) {
      throw new Error(`Downloading the image from Runware failed (HTTP ${response.status}).`);
    }
    blob = await response.blob();
  } catch (error) {
    if (error?.name === 'AbortError') {
      const seconds = Math.round(RUNWARE_DOWNLOAD_TIMEOUT_MS / 1000);
      throw new Error(`Downloading the image from Runware took longer than ${seconds} seconds.`);
    }
    if (error instanceof TypeError) {
      throw new Error(`Could not download the image from Runware: ${error.message}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!blob.type.startsWith('image/')) {
    throw new Error(`Runware returned ${blob.type || 'an unknown file type'} instead of an image.`);
  }
  const imageBase64Data = await blobToBase64(blob);
  if (!imageBase64Data) throw new Error('Runware returned an empty image.');
  return { ...result, imageBase64Data };
}
