// ─── Settings ─────────────────────────────────────────────────────────────────
//
// The one module that owns the settings object: its defaults, its migration, and
// every read/write of chrome.storage.local.settings.
//
// Both execution contexts import it — the service worker (install migration,
// debug-mode wiring) and the popup (settings UI) — so "what is the default for
// X?" has exactly one answer instead of one per file.
//
// Interface (5 exports):
//   DEFAULTS                 — frozen baseline settings object
//   migrate(stored)          — pure: stored value (or null) → complete settings
//   needsMigration(stored)   — pure: true when stored is absent or missing keys
//   load()                   — complete settings, read from storage
//   patch(partial)           — merge a partial update into storage, return result
//
// The custom-sound rule also lives here: replacing customSoundUrl invalidates the
// resolved customSoundMp3, because that MP3 was resolved from the old page. The
// rule is skipped when the caller supplies a new customSoundMp3 in the same patch
// (that is the "Fetch" flow, which resolves url → mp3 in one step).
//
// Unknown keys already in storage are carried through rather than dropped, so a
// settings object written by a different extension version survives a round trip.

import { getLocal, setLocal } from './storage-service.js';

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULTS = Object.freeze({
  checkInterval: 1,           // 1-15 minutes
  soundEnabled: true,
  notificationEnabled: true,
  darkMode: false,
  debugMode: false,
  customSoundEnabled: false,  // use myinstants MP3 instead of beep
  customSoundUrl: '',         // myinstants.com page URL
  customSoundMp3: ''          // resolved MP3 URL
});

const KEYS = Object.keys(DEFAULTS);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// ─── Migration ────────────────────────────────────────────────────────────────

/**
 * Complete a stored settings object against DEFAULTS.
 * Pure — no storage access.
 *
 * @param {object|null|undefined} stored
 * @returns {object} settings with every DEFAULTS key present
 */
export function migrate(stored) {
  if (!isPlainObject(stored)) return { ...DEFAULTS };
  return { ...DEFAULTS, ...stored };
}

/**
 * Whether a stored settings object is absent or missing any DEFAULTS key.
 * Callers use this to avoid writing on every extension update.
 *
 * @param {object|null|undefined} stored
 * @returns {boolean}
 */
export function needsMigration(stored) {
  if (!isPlainObject(stored)) return true;
  return KEYS.some((key) => !(key in stored));
}

// ─── Read / Write ─────────────────────────────────────────────────────────────

/**
 * Read settings from storage, completed against DEFAULTS.
 * Never rejects — getLocal resolves to {} on a read error.
 *
 * @returns {Promise<object>}
 */
export async function load() {
  const { settings } = await getLocal(['settings']);
  return migrate(settings);
}

/**
 * Merge a partial settings update into storage.
 * Rejects if the write fails (caller decides how to surface it).
 *
 * @param {object} partial — fields to change
 * @returns {Promise<object>} the complete settings object after the merge
 */
export async function patch(partial) {
  const stored = await load();
  const next = { ...stored, ...partial };

  const urlChanged =
    'customSoundUrl' in partial &&
    partial.customSoundUrl !== stored.customSoundUrl;
  if (urlChanged && !('customSoundMp3' in partial)) {
    next.customSoundMp3 = '';
  }

  await setLocal({ settings: next });
  return next;
}
