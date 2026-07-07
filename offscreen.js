// Listen for messages from the service worker
chrome.runtime.onMessage.addListener(msg => {
    if ('play' in msg) {
        playAudio(msg.play).catch(error => console.error('Audio playback error:', error));
    }
});

// Play audio with access to DOM APIs
export async function playAudio({ type, volume = 0.3, url }) {
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
    } else if (type === 'mp3' && url) {
        try {
            const audioContext = new AudioContext();

            // Autoplay policy: AudioContext created outside a user gesture starts
            // suspended. Resume before attempting playback.
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!response.ok) {
                console.error(`Failed to fetch MP3: HTTP ${response.status}`);
                audioContext.close();
                return;
            }

            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            const source = audioContext.createBufferSource();
            const gainNode = audioContext.createGain();

            source.buffer = audioBuffer;
            source.connect(gainNode);
            gainNode.connect(audioContext.destination);

            gainNode.gain.setValueAtTime(volume, audioContext.currentTime);

            source.start();

            // Close the AudioContext after playback finishes
            source.onended = () => {
                audioContext.close().catch(err => console.error('Error closing AudioContext:', err));
            };
        } catch (error) {
            console.error('Error playing MP3:', error);
        }
    } else {
        console.warn('Unknown sound type:', type);
    }
}
