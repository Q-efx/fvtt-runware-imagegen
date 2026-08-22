/**
 * A fast, standalone check of whether a Runware API key authenticates,
 * bypassing the `@runware/sdk-js` client entirely.
 *
 * Why not just use `Runware.initialize({ apiKey })`? Its connection-failure
 * detection (`ensureConnection()`) polls a flag that's only set once an
 * "invalid API key" message has been matched to the pending "authentication"
 * listener. That match is done by comparing `taskUUID` (falling back to
 * `taskType`), but the server's auth-error payload sets `taskUUID: "N/A"`
 * (see the `invalidApiKey` error shape this module normalises in
 * runware-errors.js) - a string, so it's truthy and short-circuits the
 * fallback to `taskType: "authentication"`, and the comparison never matches.
 * The flag never flips, so `ensureConnection()` falls through to its
 * hardcoded ~60s connection timeout (2000ms * 30 retries) instead of failing
 * fast. That's an SDK bug in v1.3.2 we can't patch from here, and both
 * `getBackgroundRemovalClient()` and `RunwareImageDialog._generateImage()`
 * go through `Runware.initialize()`, so it affects every SDK entry point,
 * not just key validation.
 *
 * This sends the same one-shot `{ apiKey, taskType: 'authentication' }`
 * message over a plain `WebSocket` and inspects the raw response directly,
 * with its own short timeout, instead of routing through that broken
 * matching logic.
 */

const RUNWARE_WS_URL = 'wss://ws-api.runware.ai/v1';

/**
 * @param {string} apiKey
 * @param {Object} [options]
 * @param {number} [options.timeoutMs] - How long to wait for a response before giving up.
 * @param {string} [options.url] - Override the websocket endpoint (used by tests/dry runs).
 * @returns {Promise<true>} Resolves `true` once the server acknowledges authentication.
 * @throws Rejects with `{ errors: [...] }` (the server's error payload, compatible with
 *   getRunwareErrorMessage()/isInvalidApiKeyError()) or a plain `Error` for network/timeout
 *   failures.
 */
export function checkRunwareApiKey(apiKey, { timeoutMs = 10000, url = RUNWARE_WS_URL } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // Nothing to do - we're discarding this socket either way.
      }
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error('Timed out waiting for a response from Runware.'));
    }, timeoutMs);

    try {
      ws = new WebSocket(url);
    } catch (err) {
      finish(reject, err);
      return;
    }

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify([{ apiKey, taskType: 'authentication' }]));
      } catch (err) {
        finish(reject, err);
      }
    };

    ws.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return; // Not JSON (e.g. a ping frame) - keep waiting for the real response.
      }

      if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
        finish(reject, { errors: payload.errors });
        return;
      }

      const authenticated = Array.isArray(payload?.data)
        && payload.data.some((item) => item?.taskType === 'authentication');
      if (authenticated) {
        finish(resolve, true);
      }
    };

    ws.onerror = () => {
      finish(reject, new Error('Could not connect to Runware.'));
    };

    ws.onclose = () => {
      finish(reject, new Error('Connection to Runware closed before authentication completed.'));
    };
  });
}
