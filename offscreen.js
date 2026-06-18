// Listen for messages from the service worker
chrome.runtime.onMessage.addListener(msg => {
    if ('play' in msg) {
        try {
            playAudio(msg.play);
        } catch (error) {
            console.error('Audio playback error:', error);
        }
    }
});

// Play audio with access to DOM APIs
export function playAudio({ type, volume = 0.3 }) {
    if (type === 'beep') {
        const audioContext = new AudioContext();

        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);

        gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);

        // Close the AudioContext after playback to release resources
        oscillator.onended = () => {
            audioContext.close().catch(err => console.error('Error closing AudioContext:', err));
        };
    } else {
        console.warn('Unknown sound type:', type);
    }
}
