import { playAudio } from '../offscreen.js';

describe('offscreen.js', () => {
  let oscillator;
  let gainNode;
  let onendedCallback;

  beforeEach(() => {
    onendedCallback = null;
    oscillator = {
      connect: jest.fn(),
      frequency: { setValueAtTime: jest.fn() },
      start: jest.fn(),
      stop: jest.fn(),
      set onended(fn) { onendedCallback = fn; },
      get onended() { return onendedCallback; }
    };
    gainNode = {
      connect: jest.fn(),
      gain: {
        setValueAtTime: jest.fn(),
        exponentialRampToValueAtTime: jest.fn()
      }
    };
  });

  afterEach(() => {
    delete global.fetch;
  });

  describe('playAudio()', () => {
    test('plays beep tone via AudioContext', () => {
      const mockClose = jest.fn().mockResolvedValue(undefined);
      global.AudioContext = jest.fn().mockImplementation(() => ({
        currentTime: 0,
        destination: {},
        createOscillator: () => oscillator,
        createGain: () => gainNode,
        close: mockClose
      }));

      playAudio({ type: 'beep', volume: 0.5 });
      expect(global.AudioContext).toHaveBeenCalledTimes(1);
    });

    test('triggers onended callback to close AudioContext after beep', () => {
      const mockClose = jest.fn().mockResolvedValue(undefined);
      global.AudioContext = jest.fn().mockImplementation(() => ({
        currentTime: 0,
        destination: {},
        createOscillator: () => oscillator,
        createGain: () => gainNode,
        close: mockClose
      }));

      playAudio({ type: 'beep', volume: 0.5 });

      // Trigger the onended callback that was assigned to the oscillator
      expect(onendedCallback).toBeDefined();
      onendedCallback();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    test('plays mp3 via fetch and decodeAudioData', async () => {
      const mockClose = jest.fn().mockResolvedValue(undefined);
      const mockGainNode = {
        connect: jest.fn(),
        gain: { setValueAtTime: jest.fn() }
      };
      const mockSource = {
        connect: jest.fn(),
        buffer: null,
        start: jest.fn(),
        set onended(fn) { onendedCallback = fn; },
        get onended() { return onendedCallback; }
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8)
      });

      global.AudioContext = jest.fn().mockImplementation(() => ({
        currentTime: 0,
        destination: {},
        state: 'running',
        resume: jest.fn(),
        decodeAudioData: jest.fn().mockResolvedValue({ length: 100, duration: 1 }),
        createBufferSource: () => mockSource,
        createGain: () => mockGainNode,
        close: mockClose
      }));

      await playAudio({ type: 'mp3', url: 'https://example.com/sound.mp3', volume: 0.5 });

      expect(global.fetch).toHaveBeenCalledWith('https://example.com/sound.mp3', expect.any(Object));
      expect(global.AudioContext).toHaveBeenCalledTimes(1);

      // Trigger the source.onended callback to cover the close handler
      expect(onendedCallback).toBeDefined();
      onendedCallback();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    test('handles mp3 fetch HTTP error gracefully', async () => {
      const mockClose = jest.fn().mockResolvedValue(undefined);
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404
      });
      global.AudioContext = jest.fn().mockImplementation(() => ({
        currentTime: 0,
        destination: {},
        state: 'running',
        resume: jest.fn(),
        close: mockClose
      }));

      await playAudio({ type: 'mp3', url: 'https://example.com/bad.mp3', volume: 0.5 });

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    test('handles mp3 decode error gracefully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8)
      });
      global.AudioContext = jest.fn().mockImplementation(() => ({
        currentTime: 0,
        destination: {},
        state: 'running',
        resume: jest.fn(),
        decodeAudioData: jest.fn().mockRejectedValue(new Error('decode failed'))
      }));

      // Should not throw — error is caught internally
      await expect(playAudio({ type: 'mp3', url: 'https://example.com/sound.mp3', volume: 0.5 }))
        .resolves.toBeUndefined();
    });

    test('resumes suspended AudioContext for mp3 playback', async () => {
      const mockResume = jest.fn().mockResolvedValue(undefined);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8)
      });
      global.AudioContext = jest.fn().mockImplementation(() => ({
        currentTime: 0,
        destination: {},
        state: 'suspended',
        resume: mockResume,
        decodeAudioData: jest.fn().mockResolvedValue({ length: 100, duration: 1 }),
        createBufferSource: () => ({
          connect: jest.fn(), buffer: null, start: jest.fn(),
          set onended(fn) {},
          get onended() { return null; }
        }),
        createGain: () => ({ connect: jest.fn(), gain: { setValueAtTime: jest.fn() } }),
        close: jest.fn()
      }));

      await playAudio({ type: 'mp3', url: 'https://example.com/sound.mp3', volume: 0.3 });

      expect(mockResume).toHaveBeenCalled();
    });

    test('does nothing for unsupported tone type', () => {
      global.AudioContext = jest.fn().mockImplementation(() => ({
        currentTime: 0,
        destination: {},
        close: jest.fn()
      }));

      playAudio({ type: 'unknown' });
      expect(global.AudioContext).not.toHaveBeenCalled();
    });
  });

  describe('onMessage listener', () => {
    test('triggers playAudio when message has play property', () => {
      const mockClose = jest.fn().mockResolvedValue(undefined);
      global.AudioContext = jest.fn().mockImplementation(() => ({
        currentTime: 0,
        destination: {},
        createOscillator: () => oscillator,
        createGain: () => gainNode,
        close: mockClose
      }));

      // The onMessage listener was registered when the module was imported.
      // Capture and invoke it.
      const msgListeners = chrome.runtime.onMessage.addListener.mock.calls
        .map(([listener]) => listener);
      expect(msgListeners.length).toBeGreaterThan(0);

      const lastListener = msgListeners[msgListeners.length - 1];
      lastListener({ play: { type: 'beep', volume: 0.3 } });

      expect(global.AudioContext).toHaveBeenCalledTimes(1);
    });
  });
});
