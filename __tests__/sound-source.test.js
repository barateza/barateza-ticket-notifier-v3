/**
 * sound-source.test.js
 * Unit tests for utils/sound-source.js — resolving a myinstants page to an MP3.
 *
 * The parser is a pure function of the page HTML, so the markup-scraping logic
 * that used to be trapped inside a service-worker message handler is now tested
 * against fixtures, and the resolver against a stub fetch.
 */

import { findMp3Path, soundNameFrom, resolveSoundSource, SOUND_PAGE_PREFIX } from '../utils/sound-source.js';

const PAGE_URL = 'https://www.myinstants.com/en/instant/my-sound/';

// Shaped like a real myinstants instant page (the Download MP3 link).
const PAGE_HTML = `
<!DOCTYPE html>
<html><body>
  <h1>My Sound</h1>
  <div class="instant">
    <a id="instant-page-button" href="/media/sounds/my-sound_abc123.mp3">Download MP3</a>
  </div>
</body></html>`;

function stubFetch({ ok = true, status = 200, html = PAGE_HTML } = {}) {
    return jest.fn().mockResolvedValue({
        ok,
        status,
        text: async () => html
    });
}

describe('sound-source', () => {
    describe('findMp3Path()', () => {
        test('finds the Download MP3 path in a page', () => {
            expect(findMp3Path(PAGE_HTML)).toBe('/media/sounds/my-sound_abc123.mp3');
        });

        test('returns null when the page has no MP3 link', () => {
            expect(findMp3Path('<html>No sound here</html>')).toBeNull();
        });

        test('returns null for non-string input', () => {
            expect(findMp3Path(undefined)).toBeNull();
            expect(findMp3Path(null)).toBeNull();
            expect(findMp3Path(42)).toBeNull();
        });

        test('ignores absolute MP3 links that are not myinstants media paths', () => {
            expect(findMp3Path('<a href="https://elsewhere.com/song.mp3">x</a>')).toBeNull();
        });
    });

    describe('soundNameFrom()', () => {
        test('strips the directory and extension', () => {
            expect(soundNameFrom('/media/sounds/my-sound_abc123.mp3')).toBe('my-sound_abc123');
        });
    });

    describe('resolveSoundSource()', () => {
        test('resolves the page to an absolute MP3 URL and a display name', async () => {
            const fetchImpl = stubFetch();

            await expect(resolveSoundSource(PAGE_URL, { fetchImpl })).resolves.toEqual({
                mp3Url: 'https://www.myinstants.com/media/sounds/my-sound_abc123.mp3',
                soundName: 'my-sound_abc123'
            });
            expect(fetchImpl).toHaveBeenCalledWith(PAGE_URL, expect.objectContaining({ signal: expect.anything() }));
        });

        test('throws an HTTP message when the page cannot be fetched', async () => {
            await expect(resolveSoundSource(PAGE_URL, { fetchImpl: stubFetch({ ok: false, status: 404 }) }))
                .rejects.toThrow('Failed to fetch sound page (HTTP 404)');
        });

        test('throws when the page has no downloadable MP3', async () => {
            await expect(resolveSoundSource(PAGE_URL, { fetchImpl: stubFetch({ html: '<html>nope</html>' }) }))
                .rejects.toThrow('Could not find a downloadable MP3 on that page');
        });

        test('propagates fetch failures', async () => {
            const fetchImpl = jest.fn().mockRejectedValue(new Error('Network error'));

            await expect(resolveSoundSource(PAGE_URL, { fetchImpl })).rejects.toThrow('Network error');
        });

        test('uses the real fetch by default (so the service worker path stays wired)', async () => {
            const originalFetch = global.fetch;
            global.fetch = stubFetch();

            try {
                await expect(resolveSoundSource(PAGE_URL)).resolves.toMatchObject({
                    soundName: 'my-sound_abc123'
                });
                expect(global.fetch).toHaveBeenCalled();
            } finally {
                global.fetch = originalFetch;
            }
        });
    });

    describe('SOUND_PAGE_PREFIX', () => {
        test('is the only page prefix the handlers accept', () => {
            expect(SOUND_PAGE_PREFIX).toBe('https://www.myinstants.com/');
            expect(PAGE_URL.startsWith(SOUND_PAGE_PREFIX)).toBe(true);
        });
    });
});
