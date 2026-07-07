// ─── Popup Settings ────────────────────────────────────────────────────────────
//
// Handles loading and saving extension settings in the popup.
// Uses sendToSW to update the alarm interval (eliminating the layering
// violation where popup.js previously called chrome.alarms directly).
// ───────────────────────────────────────────────────────────────────────────────

import Logger from './utils/logger.js';
import { sendToSW, showError } from './popup-utils.js';
import { setLocal } from './utils/storage-service.js';

function applyDarkMode(enabled) {
    if (enabled) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
}

// Load settings from storage and populate UI
export async function loadSettings() {
    try {
        const { settings } = await chrome.storage.local.get(['settings']);

        if (settings) {
            Logger.setDebugMode(settings.debugMode);

            document.getElementById('soundEnabled').checked = settings.soundEnabled !== false;
            document.getElementById('notificationEnabled').checked = settings.notificationEnabled !== false;
            document.getElementById('checkInterval').value = settings.checkInterval || 1;
            document.getElementById('darkMode').checked = settings.darkMode === true;
            document.getElementById('debugMode').checked = settings.debugMode === true;

            // Custom sound settings
            const customEnabled = settings.customSoundEnabled === true;
            document.getElementById('customSoundEnabled').checked = customEnabled;
            document.getElementById('customSoundUrl').value = settings.customSoundUrl || '';
            document.getElementById('customSoundUrl').disabled = !customEnabled;
            document.getElementById('fetchSoundBtn').disabled = !customEnabled;

            // Show resolved sound name if MP3 is configured
            updateCustomSoundStatus(settings);

            // Apply dark mode
            applyDarkMode(settings.darkMode);
        }
    } catch (error) {
        Logger.error('Error loading settings:', error);
        showError('Failed to load settings');
    }
}

// Save settings to storage and update background
export async function saveSettings() {
    try {
        const settings = {
            soundEnabled: document.getElementById('soundEnabled').checked,
            notificationEnabled: document.getElementById('notificationEnabled').checked,
            checkInterval: parseInt(document.getElementById('checkInterval').value),
            darkMode: document.getElementById('darkMode').checked,
            debugMode: document.getElementById('debugMode').checked,
            customSoundEnabled: document.getElementById('customSoundEnabled').checked,
            customSoundUrl: document.getElementById('customSoundUrl').value
        };

        // Preserve existing customSoundMp3 if URL hasn't changed, otherwise clear it
        const { settings: existingSettings } = await chrome.storage.local.get(['settings']);
        if (existingSettings) {
            if (settings.customSoundUrl === existingSettings.customSoundUrl) {
                settings.customSoundMp3 = existingSettings.customSoundMp3 || '';
            } else {
                settings.customSoundMp3 = '';
            }
        }

        await setLocal({ settings });
        Logger.info('Settings saved:', settings);

        // Apply dark mode
        applyDarkMode(settings.darkMode);

        // Update alarm interval via background
        await sendToSW({
            action: 'updateInterval',
            interval: settings.checkInterval
        });

    } catch (error) {
        Logger.error('Error saving settings:', error);
        showError('Failed to save settings');
    }
}

/** Update the custom sound status area (sound name + test button visibility). */
export function updateCustomSoundStatus(settings) {
    const statusEl = document.getElementById('soundName');
    const testBtn = document.getElementById('testSoundBtn');

    if (settings.customSoundMp3) {
        const name = settings.customSoundUrl
            ? settings.customSoundUrl.split('/').pop().replace(/-/g, ' ')
            : 'Custom sound';
        statusEl.textContent = `🎵 ${name}`;
        testBtn.classList.remove('hidden');
    } else {
        statusEl.textContent = settings.customSoundEnabled
            ? 'No sound fetched yet — enter a URL and click Fetch'
            : '';
        testBtn.classList.add('hidden');
    }
}
