// ─── Sound Source ─────────────────────────────────────────────────────────────
//
// Resolving a myinstants.com page URL to a downloadable MP3 URL, for the custom
// notification sound.
//
// The parser is a pure function of the page HTML, so the part most likely to
// break when myinstants changes its markup is testable against a saved fixture.
// The fetch is injectable for the same reason: the resolver can be driven with a
// stub, and the service worker keeps calling it with the real one.
//
// Interface (4 exports):
//   SOUND_PAGE_PREFIX        — the only page prefix we resolve
//   findMp3Path(html)        — pure: "/media/sounds/ding.mp3" or null
//   soundNameFrom(mp3Path)   — pure: "ding"
//   resolveSoundSource(pageUrl, { fetchImpl }) → { mp3Url, soundName } | throws

export const SOUND_PAGE_PREFIX = 'https://www.myinstants.com/';

/** The "Download MP3" link myinstants renders: href="/media/sounds/…mp3" */
const MP3_PATH_PATTERN = /\/media\/sounds\/[^"']+\.mp3/;

const FETCH_TIMEOUT_MS = 10000;

/**
 * Find the MP3 path inside a myinstants page.
 * @param {string} html
 * @returns {string|null} e.g. "/media/sounds/ding_abc.mp3"
 */
export function findMp3Path(html) {
  if (typeof html !== 'string') return null;
  const match = html.match(MP3_PATH_PATTERN);
  return match ? match[0] : null;
}

/**
 * Derive the display name from an MP3 path.
 * @param {string} mp3Path
 * @returns {string} e.g. "ding_abc"
 */
export function soundNameFrom(mp3Path) {
  return mp3Path.split('/').pop().replace('.mp3', '');
}

/**
 * Fetch a myinstants page and resolve its MP3.
 * Throws with a user-presentable message when the page cannot be fetched or does
 * not contain a downloadable MP3.
 *
 * @param {string} pageUrl — a https://www.myinstants.com/… page
 * @param {object} [deps]
 * @param {function} [deps.fetchImpl]
 * @returns {Promise<{ mp3Url: string, soundName: string }>}
 */
export async function resolveSoundSource(pageUrl, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(pageUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

  if (!response.ok) {
    throw new Error(`Failed to fetch sound page (HTTP ${response.status})`);
  }

  const mp3Path = findMp3Path(await response.text());
  if (!mp3Path) {
    throw new Error('Could not find a downloadable MP3 on that page');
  }

  return {
    mp3Url: `${new URL(pageUrl).origin}${mp3Path}`,
    soundName: soundNameFrom(mp3Path)
  };
}
