/**
 * Shared Runware SDK client.
 *
 * Both image generation (dialog.js) and background removal (module.js) go
 * through here, so there is exactly one SDK import and at most one open
 * websocket per client instead of one per dialog that was never closed.
 */

import { checkRunwareApiKey } from './runware-connection.js';

// Pinned to an exact version: a runtime `import()` can't carry an SRI hash, so
// a floating range (`@1`, `@latest`) would let any future upstream release -
// or a hijacked one - run in every user's browser with no commit here. Bump
// deliberately after testing.
export const RUNWARE_SDK_URL = 'https://cdn.jsdelivr.net/npm/@runware/sdk-js@1.3.2/+esm';

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
    return Runware.initialize({ apiKey });
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
