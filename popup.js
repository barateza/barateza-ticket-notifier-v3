// Zendesk Ticket Monitor - Popup Script
// Handles user interface interactions and settings management

import Logger from './utils/logger.js';
import {
    showSnoozeModal,
    hideSnoozeModal,
    handleConfirmSnooze,
    handleCancelSnooze,
    updateSnoozeStatus,
    startSnoozeTimer,
    stopSnoozeTimer
} from './popup-snooze.js';
import { loadSettings, saveSettings } from './popup-settings.js';
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
    reindexEndpointElements
};

/**
 * Safe wrapper for chrome.runtime.sendMessage.
 * Checks chrome.runtime.lastError to avoid "Unchecked runtime.lastError: No SW"
 * warnings when the service worker is terminated (normal in Manifest V3).
 * @param {object} message
 * @returns {Promise<object|null>} response or null if the SW isn't available
 */
export async function sendToSW(message) {
    try {
        const response = await chrome.runtime.sendMessage(message);
        // Check lastError even when the promise resolved — MV3 can set both
        if (chrome.runtime.lastError) {
            Logger.warn('Background message error:', chrome.runtime.lastError.message);
            return null;
        }
        return response;
    } catch (error) {
        // SW not running — normal in MV3 when popup opens before SW wakes
        Logger.warn('Failed to reach background:', error.message);
        if (chrome.runtime.lastError) {
            // Reading it clears the "Unchecked" warning
            Logger.warn('lastError:', chrome.runtime.lastError.message);
        }
        return null;
    }
}

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

// Show snooze modal
// Show loading overlay
export function showLoading(message = 'Loading...') {
    const overlay = document.getElementById('loadingOverlay');
    const loadingContent = overlay.querySelector('.loading-content');
    loadingContent.querySelector('p').textContent = message;
    overlay.classList.remove('hidden');
}

// Hide loading overlay
export function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}

// Handle endpoint test
// Handle refresh now button with debounce
async function handleRefreshNow() {
    const btn = document.getElementById('refreshBtn');
    const originalText = btn.innerHTML;

    try {
        btn.innerHTML = '<span class="btn-icon">⏳</span> Checking...';
        btn.disabled = true;

        const response = await sendToSW({ action: 'refreshNow' });

        if (response && response.success) {
            showSuccess('Manual refresh completed');
            await updateStatus();
        } else {
            showError(response.error || 'Refresh failed');
        }
    } catch (error) {
        Logger.error('Error during refresh:', error);
        showError('Refresh failed');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
        updateLastCheckTime();
    }
}

// Load and display current settings
// Load and display endpoints
// Handle toggle monitoring button
async function handleToggleMonitoring() {
    const btn = document.getElementById('toggleBtn');
    const isEnabled = btn.dataset.enabled === 'true';
    const newState = !isEnabled;

    try {
        const response = await sendToSW({
            action: 'toggleEnabled',
            enabled: newState
        });

        if (response && response.success) {
            btn.dataset.enabled = newState.toString();
            btn.innerHTML = newState ?
                '<span class="btn-icon">⏸️</span> Pause' :
                '<span class="btn-icon">▶️</span> Resume';

            await updateStatus();
            showSuccess(`Monitoring ${newState ? 'resumed' : 'paused'}`);
        }
    } catch (error) {
        Logger.error('Error toggling monitoring:', error);
        showError('Failed to toggle monitoring');
    }
}

// Update status indicator
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

// Show add endpoint modal
// Update last check time display
function updateLastCheckTime() {
    const lastCheckElement = document.getElementById('lastCheck');
    const now = new Date();
    lastCheckElement.textContent = `Last check: ${now.toLocaleTimeString()}`;
}

/**
 * Check for updates on GitHub
 */
async function checkForUpdates() {
    try {
        const manifest = chrome.runtime.getManifest();
        const currentVersion = manifest.version;

        const response = await fetch('https://api.github.com/repos/barateza/barateza-ticket-notifier-v3/releases/latest');
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }

        const data = await response.json();
        const latestVersion = data.tag_name.replace(/^v/, '');

        if (isNewerVersion(currentVersion, latestVersion)) {
            const updateStatus = document.getElementById('updateStatus');
            updateStatus.textContent = `Update available: v${latestVersion}`;
            updateStatus.href = 'https://github.com/barateza/barateza-ticket-notifier-v3/releases/latest';
            updateStatus.classList.remove('hidden');
            updateStatus.title = `Update available: v${latestVersion}. Click to open releases page.`;

            // Add click listener to use chrome.tabs API for reliable new tab opening
            updateStatus.addEventListener('click', (e) => {
                e.preventDefault();
                chrome.tabs.create({ url: updateStatus.href });
            });
        }
    } catch (error) {
        Logger.error('Failed to check for updates:', error);
    }
}

/**
 * Compare two semver strings
 * @returns {boolean} True if latest is newer than current
 */
function isNewerVersion(current, latest) {
    const v1 = current.split('.').map(Number);
    const v2 = latest.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
        const n1 = v1[i] || 0;
        const n2 = v2[i] || 0;
        if (n2 > n1) return true;
        if (n1 > n2) return false;
    }
    return false;
}

// Utility functions

export function showError(message) {
    showMessage(message, 'error');
}

export function showSuccess(message) {
    showMessage(message, 'success');
}

function showMessage(message, type) {
    // Remove existing messages
    const existing = document.querySelector('.error, .success');
    if (existing) {
        existing.remove();
    }

    // Create new message
    const div = document.createElement('div');
    div.className = type;
    div.textContent = message;

    // Insert at top of first section
    const firstSection = document.querySelector('.section');
    firstSection.insertBefore(div, firstSection.firstChild);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (div.parentNode) {
            div.remove();
        }
    }, 3000);
}

Logger.info('Popup script loaded');
