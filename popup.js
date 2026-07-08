// Zendesk Ticket Monitor - Popup Script
// Handles user interface interactions and settings management

import Logger from './utils/logger.js';
import {
    sendToSW,
    callSW,
    hideLoading,
    showError,
    showSuccess
} from './popup-utils.js';
import {
    showSnoozeModal,
    hideSnoozeModal,
    handleConfirmSnooze,
    handleCancelSnooze,
    updateSnoozeStatus,
    startSnoozeTimer,
    stopSnoozeTimer
} from './popup-snooze.js';
import { loadSettings, saveSettings, updateCustomSoundStatus } from './popup-settings.js';
import {
    checkForUpdates,
    isNewerVersion
} from './popup-updates.js';
import {
    loadEndpoints,
    handleTestEndpoint,
    testEndpoint,
    handleExportEndpoints,
    handleImportEndpoints,
    handleImportFileSelected,
    showAddEndpointModal,
    hideAddEndpointModal,
    handleSaveEndpoint,
    toggleEndpoint,
    deleteEndpoint,
    reindexEndpointElements
} from './popup-endpoints.js';

// Re-export sub-module functions for backward compatibility with tests
export {
    showSnoozeModal,
    hideSnoozeModal,
    handleConfirmSnooze,
    handleCancelSnooze,
    updateSnoozeStatus,
    startSnoozeTimer,
    stopSnoozeTimer,
    loadSettings,
    saveSettings,
    loadEndpoints,
    handleTestEndpoint,
    testEndpoint,
    handleExportEndpoints,
    handleImportEndpoints,
    handleImportFileSelected,
    showAddEndpointModal,
    hideAddEndpointModal,
    handleSaveEndpoint,
    toggleEndpoint,
    deleteEndpoint,
    reindexEndpointElements,
    checkForUpdates,
    isNewerVersion,
    handleFetchSound,
    handleTestSound,
    handleCustomSoundEnabledChange
};

// ─── Custom Sound ────────────────────────────────────────────────────────────

async function handleCustomSoundEnabledChange() {
    const enabled = document.getElementById('customSoundEnabled').checked;
    document.getElementById('customSoundUrl').disabled = !enabled;
    document.getElementById('fetchSoundBtn').disabled = !enabled;
    if (!enabled) {
        document.getElementById('soundName').textContent = '';
        document.getElementById('testSoundBtn').classList.add('hidden');
    }
    await saveSettings();
}

async function handleFetchSound() {
    const url = document.getElementById('customSoundUrl').value.trim();
    if (!url) {
        showError('Please enter a myinstants.com URL');
        return;
    }

    const btn = document.getElementById('fetchSoundBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳...';
    btn.disabled = true;

    try {
        const response = await sendToSW({ action: 'resolveSoundUrl', myinstantsUrl: url });
        if (response?.success) {
            // Update settings with the resolved MP3 URL and the myinstants URL
            const { settings } = await chrome.storage.local.get(['settings']);
            settings.customSoundUrl = url;
            settings.customSoundMp3 = response.mp3Url;
            await chrome.storage.local.set({ settings });

            document.getElementById('soundName').textContent = `🎵 ${response.soundName}`;
            document.getElementById('testSoundBtn').classList.remove('hidden');
            showSuccess(`Sound fetched: ${response.soundName}`);
        } else {
            showError(response?.error || 'Failed to fetch sound');
        }
    } catch (error) {
        Logger.error('Error fetching sound:', error);
        showError('Failed to fetch sound');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function handleTestSound() {
    const { settings } = await chrome.storage.local.get(['settings']);
    if (!settings?.customSoundMp3) {
        showError('No custom sound configured — fetch one first');
        return;
    }

    const btn = document.getElementById('testSoundBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '🔊...';
    btn.disabled = true;

    try {
        const response = await sendToSW({ action: 'playTestSound', mp3Url: settings.customSoundMp3 });
        if (!response?.success) {
            showError(response?.error || 'Failed to play test sound');
        }
    } catch (error) {
        Logger.error('Error playing test sound:', error);
        showError('Failed to play test sound');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ─── Manual Refresh ────────────────────────────────────────────────────────────

export async function handleRefreshNow() {
    const btn = document.getElementById('refreshBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="btn-icon">⏳</span> Checking...';
    btn.disabled = true;

    const response = await callSW('refreshNow', {}, {
        successMessage: 'Manual refresh completed',
        errorMessage: 'Refresh failed'
    });
    if (response?.success) {
        await updateStatus();
    }
    btn.innerHTML = originalText;
    btn.disabled = false;
    updateLastCheckTime();
}

// ─── Monitoring Toggle ─────────────────────────────────────────────────────────

export async function handleToggleMonitoring() {
    const btn = document.getElementById('toggleBtn');
    const isEnabled = btn.dataset.enabled === 'true';
    const newState = !isEnabled;

    const response = await callSW('toggleEnabled', { enabled: newState }, {
        successMessage: `Monitoring ${newState ? 'resumed' : 'paused'}`,
        errorMessage: 'Failed to toggle monitoring'
    });
    if (response?.success) {
        btn.dataset.enabled = newState.toString();
        btn.innerHTML = newState ?
            '<span class="btn-icon">⏸️</span> Pause' :
            '<span class="btn-icon">▶️</span> Resume';
        await updateStatus();
    }
}

// ─── Status Display ────────────────────────────────────────────────────────────

async function updateStatus() {
    try {
        const response = await sendToSW({ action: 'getStatus' });

        if (response) {
            const statusDot = document.querySelector('.status-dot');
            const statusText = document.getElementById('statusText');
            const toggleBtn = document.getElementById('toggleBtn');

            if (response.enabled) {
                statusDot.classList.remove('paused');
                statusText.textContent = 'Monitoring';
                toggleBtn.innerHTML = '<span class="btn-icon">⏸️</span> Pause';
                toggleBtn.dataset.enabled = 'true';
            } else {
                statusDot.classList.add('paused');
                statusText.textContent = 'Paused';
                toggleBtn.innerHTML = '<span class="btn-icon">▶️</span> Resume';
                toggleBtn.dataset.enabled = 'false';
            }
        }
    } catch (error) {
        Logger.error('Error updating status:', error);
    }
}

// ─── Last Check Time ───────────────────────────────────────────────────────────

function updateLastCheckTime() {
    const lastCheckElement = document.getElementById('lastCheck');
    const now = new Date();
    lastCheckElement.textContent = `Last check: ${now.toLocaleTimeString()}`;
}

// ─── Initialization ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    Logger.info('Popup loaded');

    try {
        // Initialize UI
        await loadSettings();
        await loadEndpoints();
        await updateStatus();
        await updateSnoozeStatus();
    } catch (error) {
        Logger.error('Error initializing popup:', error);
    } finally {
        // Ensure loading indicator is hidden
        hideLoading();
    }

    // Set up event listeners
    setupEventListeners();

    // Update last check time
    updateLastCheckTime();

    // Start snooze timer to update remaining time display
    startSnoozeTimer();

    // Set app version from manifest
    try {
        const manifest = chrome.runtime.getManifest();
        if (manifest && manifest.version) {
            const appVersionEl = document.getElementById('appVersion');
            appVersionEl.textContent = `v${manifest.version}`;
        }

        // Check for updates
        checkForUpdates();
    } catch (e) {
        Logger.error('Failed to get manifest version', e);
    }
});

// Set up all event listeners
function setupEventListeners() {
    // Control buttons
    document.getElementById('refreshBtn').addEventListener('click', handleRefreshNow);
    document.getElementById('toggleBtn').addEventListener('click', handleToggleMonitoring);
    document.getElementById('snoozeBtn').addEventListener('click', showSnoozeModal);

    // Settings
    document.getElementById('soundEnabled').addEventListener('change', saveSettings);
    document.getElementById('notificationEnabled').addEventListener('change', saveSettings);
    document.getElementById('checkInterval').addEventListener('change', saveSettings);
    document.getElementById('darkMode').addEventListener('change', saveSettings);
    document.getElementById('debugMode').addEventListener('change', saveSettings);

    // Custom sound
    document.getElementById('customSoundEnabled').addEventListener('change', handleCustomSoundEnabledChange);
    document.getElementById('fetchSoundBtn').addEventListener('click', handleFetchSound);
    document.getElementById('testSoundBtn').addEventListener('click', handleTestSound);

    // Endpoint management
    document.getElementById('addEndpointBtn').addEventListener('click', showAddEndpointModal);
    document.getElementById('closeModal').addEventListener('click', hideAddEndpointModal);
    document.getElementById('cancelEndpoint').addEventListener('click', hideAddEndpointModal);
    document.getElementById('saveEndpoint').addEventListener('click', handleSaveEndpoint);
    document.getElementById('testEndpoint').addEventListener('click', handleTestEndpoint);
    document.getElementById('exportEndpointsBtn').addEventListener('click', handleExportEndpoints);
    document.getElementById('importEndpointsBtn').addEventListener('click', handleImportEndpoints);
    document.getElementById('importFileInput').addEventListener('change', handleImportFileSelected);

    // Snooze management
    document.getElementById('closeSnoozeModal').addEventListener('click', hideSnoozeModal);
    document.getElementById('cancelSnooze').addEventListener('click', hideSnoozeModal);
    document.getElementById('confirmSnooze').addEventListener('click', handleConfirmSnooze);
    document.getElementById('cancelSnoozeBtn').addEventListener('click', handleCancelSnooze);

    // Close modal when clicking outside
    document.getElementById('addEndpointModal').addEventListener('click', (e) => {
        if (e.target.id === 'addEndpointModal') {
            hideAddEndpointModal();
        }
    });
    document.getElementById('snoozeModal').addEventListener('click', (e) => {
        if (e.target.id === 'snoozeModal') {
            hideSnoozeModal();
        }
    });

    // Delegated actions for endpoints list
    document.getElementById('endpointsList').addEventListener('click', async (e) => {
        const toggleBtn = e.target.closest('.toggle-endpoint-btn');
        if (toggleBtn) {
            const index = parseInt(toggleBtn.dataset.index, 10);
            await toggleEndpoint(index);
            return;
        }

        const deleteBtn = e.target.closest('.delete-endpoint-btn');
        if (deleteBtn) {
            const index = parseInt(deleteBtn.dataset.index, 10);
            await deleteEndpoint(index);
            return;
        }
    });
}

Logger.info('Popup script loaded');
