export const MODULE_ID = 'runware-imagegen';
export const MODULE_NAME = 'Runware AI Image Generator';

// Request limits, enforced in code before every paid Runware call. The HTML
// min/max attributes are hints only: Generate is a plain button, so the browser
// never validates the form.
export const LIMITS = Object.freeze({
  dimension: { min: 256, max: 2048, step: 64, fallback: 512 },
  numberResults: { min: 1, max: 4, fallback: 1 },
  steps: { min: 1, max: 150 },
  cfgScale: { min: 1, max: 30 },
  weight: { min: -4, max: 4 }
});
