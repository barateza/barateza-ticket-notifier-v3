// ─── Popup Settings ────────────────────────────────────────────────────────────
//
// Handles loading and saving extension settings in the popup.
// Uses sendToSW to update the alarm interval (eliminating the layering
// violation where popup.js previously called chrome.alarms directly).
// ───────────────────────────────────────────────────────────────────────────────

import Logger from './utils/logger.js';
import { sendToSW, showError, showSuccess } from './popup-utils.js';
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

// ─── Jira Credentials ─────────────────────────────────────────────────────────

/**
 * Load Jira credentials into the settings section. Sites are auto-listed
 * from jira monitor hostnames (plus any manually entered sites).
 */
export async function loadJiraCredentials() {
    const listEl = document.getElementById('jiraCredentialsList');
    if (!listEl) return;

    const { jiraCredentials = {} } = await chrome.storage.local.get(['jiraCredentials']);
    const { monitors } = await chrome.storage.local.get(['monitors']);

    const sites = new Set(Object.keys(jiraCredentials));
    (Array.isArray(monitors) ? monitors : []).forEach((monitor) => {
        if (monitor.provider === 'jira') {
            try {
                sites.add(new URL(monitor.url).hostname);
            } catch {
                // unparseable URL — ignore
            }
        }
    });

    if (sites.size === 0) {
        listEl.innerHTML = '<div class="jira-credentials-empty">No Jira sites yet — add a Jira monitor first.</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    [...sites].sort().forEach((site) => {
        const entry = jiraCredentials[site] || {};
        const hasCredentials = Boolean(entry.email && entry.token);
        const row = document.createElement('div');
        row.className = 'jira-cred-row';
        row.dataset.site = site;
        row.innerHTML = `
            <div class="jira-cred-site">${escapeHtml(site)}</div>
            <div class="jira-cred-fields">
                <input type="text" class="jira-cred-email" placeholder="Atlassian email" value="${escapeHtml(entry.email || '')}">
                <input type="password" class="jira-cred-token" placeholder="API token" value="${escapeHtml(entry.token || '')}">
            </div>
            <span class="jira-cred-status ${hasCredentials ? 'configured' : 'missing'}">
                ${hasCredentials ? '✓ configured' : '○ missing'}
            </span>
        `;
        fragment.appendChild(row);
    });
    listEl.replaceChildren(fragment);
}

/** Persist the Jira credentials rows to chrome.storage.local. */
export async function saveJiraCredentials() {
    const listEl = document.getElementById('jiraCredentialsList');
    if (!listEl) return;

    const jiraCredentials = {};
    listEl.querySelectorAll('.jira-cred-row').forEach((row) => {
        const site = row.dataset.site;
        const email = row.querySelector('.jira-cred-email').value.trim();
        const token = row.querySelector('.jira-cred-token').value.trim();
        if (email || token) {
            jiraCredentials[site] = { email, token };
        }
    });

    try {
        await setLocal({ jiraCredentials });
        Logger.info('Jira credentials saved');
        showSuccess('Jira credentials saved');
        await loadJiraCredentials();
    } catch (error) {
        Logger.error('Failed to save Jira credentials:', error);
        showError('Failed to save Jira credentials');
    }
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
}
