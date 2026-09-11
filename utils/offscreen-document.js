// ─── Offscreen Document ───────────────────────────────────────────────────────
//
// Manifest V3 has no DOM in the service worker, so audio playback needs an
// offscreen document. Creating it is race-prone — two concurrent
// chrome.offscreen.createDocument calls throw — so the singleton dance lives here
// once, instead of in every caller that wants to make a sound.
//
// Interface (2 exports):
//   ensureOffscreen()      — create the document if absent; safe to call concurrently
//   playAudio(playOptions)  — ensureOffscreen() + send the play message
//
// playOptions: { type: 'beep' } | { type: 'mp3', url } plus optional volume.
// The offscreen document (offscreen.js) owns the actual Web Audio work.

const OFFSCREEN_URL = 'offscreen.html';
const OFFSCREEN_JUSTIFICATION = 'Play notification sounds for new Zendesk tickets';

let creatingPromise = null;

/**
 * Ensure the offscreen audio document exists.
 * Concurrent calls share a single createDocument call.
 * @returns {Promise<void>}
 */
export async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;

  if (creatingPromise) {
    await creatingPromise;
    return;
  }

  creatingPromise = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['AUDIO_PLAYBACK'],
    justification: OFFSCREEN_JUSTIFICATION
  });

  try {
    await creatingPromise;
  } finally {
    creatingPromise = null;
  }
}

/**
 * Play a sound through the offscreen document.
 * @param {object} playOptions — { type, url?, volume? }
 * @returns {Promise<void>}
 */
export async function playAudio(playOptions) {
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ play: playOptions });
}
