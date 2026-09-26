/**
 * Helpers for Foundry's dynamic token ring and the token options that feed
 * it (ring/background colours, subject scale).
 *
 * The dynamic ring is a core feature, but systems and modules can replace or
 * strip CONFIG.Token, so every read here is defensive: a missing piece means
 * "no dynamic ring", never an exception that breaks the output dialog.
 */

import { LIMITS } from './constants.js';

/**
 * Describe the world's active dynamic token ring.
 * `available` is false when no ring spritesheet is configured, in which case
 * the output dialog hides the "Dynamic ring" option. The ring style itself is
 * the GM's world-wide `core.dynamicTokenRing` setting; this module never
 * changes it.
 * @returns {{available: boolean, id: string|null, label: string}}
 */
export function getDynamicRingInfo() {
  let ring = null;
  try {
    ring = CONFIG?.Token?.ring ?? null;
  } catch {
    ring = null;
  }

  let available = false;
  try {
    available = Boolean(ring?.spritesheet);
  } catch {
    available = false;
  }

  let id = null;
  try {
    id = game.settings.get('core', 'dynamicTokenRing') || null;
  } catch {
    id = null;
  }
  if (!id) {
    try {
      id = ring?.id || null;
    } catch {
      id = null;
    }
  }

  let label = '';
  try {
    const raw = ring?.label;
    if (typeof raw === 'string' && raw) {
      // Core ring labels are i18n keys (e.g. "TOKEN.RING.SETTINGS.coreSteel").
      label = game.i18n?.has?.(raw) ? game.i18n.localize(raw) : raw;
    }
  } catch {
    label = '';
  }

  return { available, id, label: label || id || 'Default ring' };
}

/**
 * Normalise a colour typed by the user.
 * @param {string|null|undefined} value - '#rgb' or '#rrggbb', '#' optional,
 *   any case; blank means "use the default"
 * @returns {string|null} '#rrggbb' in lowercase, or null for blank input
 * @throws {Error} for anything else
 */
export function parseHexColor(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text === '') return null;

  const match = text.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) {
    throw new Error(`Invalid colour "${value}" - use #rrggbb.`);
  }

  let hex = match[1].toLowerCase();
  if (hex.length === 3) {
    hex = hex.split('').map((digit) => digit + digit).join('');
  }
  return `#${hex}`;
}

/**
 * Clamp a dynamic ring subject scale to LIMITS.subjectScale. Blank or invalid
 * input falls back to 1 (Foundry's default) rather than to the minimum.
 * @param {*} value
 * @returns {number} rounded to 2 decimals
 */
export function clampSubjectScale(value) {
  const { min, max, fallback } = LIMITS.subjectScale;
  const number = value === undefined || value === null || `${value}`.trim() === ''
    ? NaN
    : Number(value);
  if (!Number.isFinite(number)) return fallback;
  const clamped = Math.min(max, Math.max(min, number));
  return Math.round(clamped * 100) / 100;
}
