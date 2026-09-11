/**
 * offscreen-document.test.js
 * Unit tests for utils/offscreen-document.js — the single owner of the MV3
 * offscreen-document singleton.
 *
 * The concurrent-call case is the reason this module exists: two overlapping
 * createDocument calls throw, and that trap used to be guarded in two files.
 */

import { ensureOffscreen, playAudio } from '../utils/offscreen-document.js';

describe('offscreen-document', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        chrome.offscreen.hasDocument.mockResolvedValue(false);
        chrome.offscreen.createDocument.mockResolvedValue(undefined);
        chrome.runtime.sendMessage.mockResolvedValue({ success: true });
    });

    describe('ensureOffscreen()', () => {
        test('creates the offscreen document when none exists', async () => {
            await ensureOffscreen();

            expect(chrome.offscreen.hasDocument).toHaveBeenCalled();
            expect(chrome.offscreen.createDocument).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'offscreen.html',
                    reasons: ['AUDIO_PLAYBACK']
                })
            );
        });

        test('does not create a second document when one already exists', async () => {
            chrome.offscreen.hasDocument.mockResolvedValue(true);

            await ensureOffscreen();

            expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
        });

        test('collapses concurrent calls into a single createDocument', async () => {
            let resolveCreate;
            chrome.offscreen.createDocument.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));

            const first = ensureOffscreen();
            const second = ensureOffscreen();
            resolveCreate();
            await Promise.all([first, second]);

            expect(chrome.offscreen.createDocument).toHaveBeenCalledTimes(1);
        });

        test('allows a later call to create the document after the first attempt settles', async () => {
            await ensureOffscreen();
            await ensureOffscreen();

            expect(chrome.offscreen.createDocument).toHaveBeenCalledTimes(2);
        });

        test('rejects when document creation fails', async () => {
            chrome.offscreen.createDocument.mockRejectedValue(new Error('createDocument failed'));

            await expect(ensureOffscreen()).rejects.toThrow('createDocument failed');
        });
    });

    describe('playAudio()', () => {
        test('ensures the document exists before sending the play message', async () => {
            await playAudio({ type: 'beep', volume: 0.3 });

            expect(chrome.offscreen.hasDocument).toHaveBeenCalled();
            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ play: { type: 'beep', volume: 0.3 } });
        });

        test('passes an mp3 request straight through', async () => {
            await playAudio({ type: 'mp3', url: 'https://example.com/a.mp3', volume: 0.3 });

            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
                play: { type: 'mp3', url: 'https://example.com/a.mp3', volume: 0.3 }
            });
        });
    });
});
