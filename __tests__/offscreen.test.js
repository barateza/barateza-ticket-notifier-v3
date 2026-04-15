import { playAudio } from '../offscreen.js';

describe('offscreen.js', () => {
  beforeEach(() => {
    const oscillator = {
      connect: jest.fn(),
      frequency: { setValueAtTime: jest.fn() },
      start: jest.fn(),
      stop: jest.fn()
    };
    const gainNode = {
      connect: jest.fn(),
      gain: {
        setValueAtTime: jest.fn(),
        exponentialRampToValueAtTime: jest.fn()
      }
    };

    global.AudioContext = jest.fn().mockImplementation(() => ({
      currentTime: 0,
      destination: {},
      createOscillator: () => oscillator,
      createGain: () => gainNode
    }));
  });

  test('plays beep tone via AudioContext', () => {
    playAudio({ type: 'beep', volume: 0.5 });
    expect(global.AudioContext).toHaveBeenCalledTimes(1);
  });

  test('does nothing for unsupported tone type', () => {
    playAudio({ type: 'unknown' });
    expect(global.AudioContext).not.toHaveBeenCalled();
  });
});
