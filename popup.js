// Zendesk Ticket Monitor - Popup Script
// Handles user interface interactions and settings management

import { validateEndpointUrl, validateEndpoint } from './utils/validators.js';
import Logger from './utils/logger.js';
import {
    exportEndpoints,
    parseImportFile,
    validateImportedEndpoints,
    prepareEndpointsForImport,
    MAX_IMPORT_SIZE_BYTES
} from './utils/endpoint-io.js';

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
function showSnoozeModal() {
    document.getElementById('snoozeModal').classList.remove('hidden');
    document.getElementById('snoozeDuration').focus();
}

// Hide snooze modal
function hideSnoozeModal() {
    document.getElementById('snoozeModal').classList.add('hidden');
}

// Handle confirm snooze
export async function handleConfirmSnooze() {
    const duration = parseInt(document.getElementById('snoozeDuration').value);
    try {
        showLoading('Snoozing notifications...');
        const response = await chrome.runtime.sendMessage({
            action: 'setSnooze',
            duration: duration
        });

        if (response.success) {
            hideSnoozeModal();
            showSuccess(duration === 0 ? 'Notifications snoozed indefinitely' : `Notifications snoozed for ${duration} minutes`);
            await updateSnoozeStatus();
        } else {
            showError('Failed to snooze notifications');
        }
    } catch (error) {
        Logger.error('Error snoozing notifications:', error);
        showError('Failed to snooze notifications');
    } finally {
        hideLoading();
    }
}

// Handle cancel snooze
export async function handleCancelSnooze() {
    try {
        showLoading('Canceling snooze...');
        const response = await chrome.runtime.sendMessage({
            action: 'clearSnooze'
        });

        if (response.success) {
            await updateSnoozeStatus();
            showSuccess('Notifications no longer snoozed');
        } else {
            showError('Failed to cancel snooze');
        }
    } catch (error) {
        Logger.error('Error canceling snooze:', error);
        showError('Failed to cancel snooze');
    } finally {
        hideLoading();
    }
}

// Update snooze status display
export async function updateSnoozeStatus() {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'getSnoozeStatus'
        });

        Logger.info('updateSnoozeStatus received:', response);

        const snoozeStatus = document.getElementById('snoozeStatus');
        const snoozeRemaining = document.getElementById('snoozeRemaining');

        if (response.isSnoozed) {
            Logger.info('Snooze is active, showing banner');
            snoozeStatus.classList.remove('hidden');
            if (response.remainingTime === 0) {
                snoozeRemaining.textContent = 'Until I turn back on';
            } else if (response.remainingTime === 1) {
                snoozeRemaining.textContent = '1 minute remaining';
            } else if (response.remainingTime < 60) {
                snoozeRemaining.textContent = `${response.remainingTime} minutes remaining`;
            } else {
                const hours = Math.floor(response.remainingTime / 60);
                const minutes = response.remainingTime % 60;
                snoozeRemaining.textContent = `${hours}h ${minutes}m remaining`;
            }
        } else {
            Logger.info('Snooze is not active, hiding banner');
            snoozeStatus.classList.add('hidden');
        }
    } catch (error) {
        Logger.error('Error getting snooze status:', error);
    }
}

// Start snooze timer to update remaining time
function startSnoozeTimer() {
    const timer = setInterval(async () => {
        await updateSnoozeStatus();

        // Check if snooze is still active
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'getSnoozeStatus'
            });

            if (!response.isSnoozed) {
                clearInterval(timer);
            }
        } catch (_error) {
            clearInterval(timer);
        }
    }, 60000); // Update every minute
}

// Show loading overlay
function showLoading(message = 'Loading...') {
    const overlay = document.getElementById('loadingOverlay');
    const loadingContent = overlay.querySelector('.loading-content');
    loadingContent.querySelector('p').textContent = message;
    overlay.classList.remove('hidden');
}

// Hide loading overlay
function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}

// Handle endpoint test
async function handleTestEndpoint() {
    const url = document.getElementById('endpointUrl').value.trim();

    const validation = validateEndpointUrl(url);
    if (!validation.valid) {
        showError(validation.error);
        return;
    }

    showLoading('Testing endpoint connection...');
    const testResult = await testEndpoint(url);
    hideLoading();

    if (testResult.success) {
        showSuccess(testResult.message);
    } else {
        showError(testResult.message);
    }
}

// Handle refresh now button with debounce
async function handleRefreshNow() {
    const btn = document.getElementById('refreshBtn');
    const originalText = btn.innerHTML;

    try {
        btn.innerHTML = '<span class="btn-icon">⏳</span> Checking...';
        btn.disabled = true;

        const response = await chrome.runtime.sendMessage({ action: 'refreshNow' });

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
export async function loadSettings() {
    try {
        const { settings } = await chrome.storage.local.get(['settings']);

        if (settings) {
            Logger.setDebugMode(settings.debugMode);
        }

        if (settings) {
            document.getElementById('soundEnabled').checked = settings.soundEnabled !== false;
            document.getElementById('notificationEnabled').checked = settings.notificationEnabled !== false;
            document.getElementById('checkInterval').value = settings.checkInterval || 1;
            document.getElementById('darkMode').checked = settings.darkMode === true;
            document.getElementById('debugMode').checked = settings.debugMode === true;

            // Apply dark mode
            if (settings.darkMode) {
                document.body.classList.add('dark-mode');
            } else {
                document.body.classList.remove('dark-mode');
            }
        }
    } catch (error) {
        Logger.error('Error loading settings:', error);
        showError('Failed to load settings');
    }
}

// Save settings to storage
export async function saveSettings() {
    try {
        const settings = {
            soundEnabled: document.getElementById('soundEnabled').checked,
            notificationEnabled: document.getElementById('notificationEnabled').checked,
            checkInterval: parseInt(document.getElementById('checkInterval').value),
            darkMode: document.getElementById('darkMode').checked,
            debugMode: document.getElementById('debugMode').checked
        };

        await chrome.storage.local.set({ settings });
        Logger.info('Settings saved:', settings);

        // Apply dark mode
        if (settings.darkMode) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }

        // Always update alarm interval to match new setting (minimum 1 minute)
        const interval = Math.max(1, settings.checkInterval);
        await chrome.alarms.clear('ticketCheck');
        await chrome.alarms.create('ticketCheck', {
            periodInMinutes: interval
        });
        Logger.info(`Alarm interval updated to ${interval} minutes`);

    } catch (error) {
        Logger.error('Error saving settings:', error);
        showError('Failed to save settings');
    }
}

// Load and display endpoints
export async function loadEndpoints() {
    try {
        const { endpoints } = await chrome.storage.local.get(['endpoints']);
        const endpointsList = document.getElementById('endpointsList');

        if (!endpoints || endpoints.length === 0) {
            endpointsList.innerHTML = '<div class="error">No endpoints configured</div>';
            return;
        }

        endpointsList.innerHTML = '';

        endpoints.forEach((endpoint, index) => {
            const endpointElement = createEndpointElement(endpoint, index);
            endpointsList.appendChild(endpointElement);
        });

    } catch (error) {
        Logger.error('Error loading endpoints:', error);
        showError('Failed to load endpoints');
    }
}

// Create DOM element for an endpoint
function createEndpointElement(endpoint, index) {
    const div = document.createElement('div');
    div.className = 'endpoint-item';

    div.innerHTML = `
        <div class="endpoint-info">
            <div class="endpoint-name">${escapeHtml(endpoint.name)}</div>
            <div class="endpoint-url">${escapeHtml(endpoint.url)}</div>
            <div class="endpoint-status ${endpoint.enabled ? 'active' : 'inactive'}">
                ${endpoint.enabled ? '● Active' : '○ Inactive'}
            </div>
        </div>
        <div class="endpoint-actions">
            <button class="btn btn-secondary toggle-endpoint-btn" data-index="${index}">
                ${endpoint.enabled ? 'Disable' : 'Enable'}
            </button>
            <button class="btn btn-danger delete-endpoint-btn" data-index="${index}">
                Delete
            </button>
        </div>
    `;

    return div;
}

// Toggle endpoint enabled/disabled
async function toggleEndpoint(index) {
    try {
        const { endpoints } = await chrome.storage.local.get(['endpoints']);

        if (endpoints && endpoints[index]) {
            endpoints[index].enabled = !endpoints[index].enabled;
            const saved = await saveEndpoints(endpoints);
            if (saved) {
                await loadEndpoints();
                showSuccess(`Endpoint ${endpoints[index].enabled ? 'enabled' : 'disabled'}`);
            }
        }
    } catch (error) {
        Logger.error('Error toggling endpoint:', error);
        showError('Failed to toggle endpoint');
    }
}

// Delete an endpoint
async function deleteEndpoint(index) {
    if (!confirm('Are you sure you want to delete this endpoint?')) {
        return;
    }

    try {
        const { endpoints } = await chrome.storage.local.get(['endpoints']);

        if (endpoints && endpoints[index]) {
            endpoints.splice(index, 1);
            const saved = await saveEndpoints(endpoints);
            if (saved) {
                await loadEndpoints();
                showSuccess('Endpoint deleted');
            }
        }
    } catch (error) {
        Logger.error('Error deleting endpoint:', error);
        showError('Failed to delete endpoint');
    }
}

// Handle toggle monitoring button
async function handleToggleMonitoring() {
    const btn = document.getElementById('toggleBtn');
    const isEnabled = btn.dataset.enabled === 'true';
    const newState = !isEnabled;

    try {
        const response = await chrome.runtime.sendMessage({
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
        const response = await chrome.runtime.sendMessage({ action: 'getStatus' });

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
function showAddEndpointModal() {
    document.getElementById('addEndpointModal').classList.remove('hidden');
    document.getElementById('endpointName').focus();
}

// Hide add endpoint modal
function hideAddEndpointModal() {
    document.getElementById('addEndpointModal').classList.add('hidden');
    document.getElementById('endpointName').value = '';
    document.getElementById('endpointUrl').value = '';
}

// Handle save endpoint
async function handleSaveEndpoint() {
    const name = document.getElementById('endpointName').value.trim();
    const url = document.getElementById('endpointUrl').value.trim();

    try {
        const { endpoints = [] } = await chrome.storage.local.get(['endpoints']);

        // Validate endpoint
        const validation = validateEndpoint({ name, url }, endpoints);
        if (!validation.valid) {
            // Show first error
            showError(validation.errors[0]);
            return;
        }

        const newEndpoint = {
            id: Date.now(),
            name: name,
            url: url,
            enabled: true,
            createdAt: Date.now()
        };

        endpoints.push(newEndpoint);
        const saved = await saveEndpoints(endpoints);
        if (saved) {
            hideAddEndpointModal();
            await loadEndpoints();
            showSuccess('Endpoint added successfully');
        }

    } catch (error) {
        Logger.error('Error saving endpoint:', error);
        showError('Failed to save endpoint');
    }
}

// Test endpoint connection
export async function testEndpoint(url) {
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;

        // Get authentication cookies
        const cookies = await chrome.cookies.getAll({
            domain: domain
        });

        const cookieString = cookies
            .filter(cookie =>
                cookie.name.includes('session') ||
                cookie.name.includes('auth') ||
                cookie.name.includes('_zendesk') ||
                cookie.name.includes('csrf') ||
                cookie.name === '_help_center_session'
            )
            .map(cookie => `${cookie.name}=${cookie.value}`)
            .join('; ');

        const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Cookie': cookieString
            },
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (typeof data.count === 'undefined') {
            throw new Error('Invalid API response format');
        }

        return {
            success: true,
            count: data.count,
            message: `Success: Found ${data.count} tickets`
        };
    } catch (error) {
        Logger.error('Endpoint test error:', error);
        return {
            success: false,
            message: error.message || 'Failed to connect to endpoint'
        };
    }
}

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
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
}

async function saveEndpoints(endpoints) {
    try {
        await chrome.storage.local.set({ endpoints });
        Logger.info('Endpoints saved successfully:', endpoints.length, 'endpoints');
        return true;
    } catch (error) {
        Logger.error('Failed to save endpoints:', error);
        showError('Failed to save endpoints. Please try again.');
        return false;
    }
}

// ─── Import / Export ──────────────────────────────────────────────────────────

// Export all endpoints to a downloadable JSON file.
export async function handleExportEndpoints() {
    try {
        const { endpoints } = await chrome.storage.local.get(['endpoints']);

        if (!endpoints || endpoints.length === 0) {
            showError('No endpoints to export.');
            return;
        }

        const manifest = chrome.runtime.getManifest();
        const json = exportEndpoints(endpoints, manifest.version);

        // Generate a dated filename
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const filename = `zendesk-endpoints-${today}.json`;

        // Trigger download via Blob + temporary <a>
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);

        Logger.info(`Exported ${endpoints.length} endpoint(s) to ${filename}`);
        showSuccess(`Exported ${endpoints.length} endpoint(s)`);
    } catch (error) {
        Logger.error('Error exporting endpoints:', error);
        showError('Failed to export endpoints.');
    }
}

// Trigger the file picker for import.
export function handleImportEndpoints() {
    document.getElementById('importFileInput').click();
}

// Handle file selected from the file picker.
export async function handleImportFileSelected(event) {
    const file = event.target.files[0];

    // Reset the input so re-selecting the same file fires again
    event.target.value = '';

    if (!file) {
        return; // User cancelled the picker
    }

    // Guard: file size
    if (file.size > MAX_IMPORT_SIZE_BYTES) {
        showError('File is too large. Maximum size is 1 MB.');
        return;
    }

    try {
        showLoading('Importing endpoints...');

        const fileContent = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });

        // Parse and structurally validate
        const parsed = parseImportFile(fileContent);
        if (!parsed.success) {
            showError(parsed.error);
            return;
        }

        // Validate individual endpoints against existing ones
        const { endpoints: existingEndpoints = [] } = await chrome.storage.local.get(['endpoints']);
        const { valid, skipped } = validateImportedEndpoints(
            parsed.data.endpoints,
            existingEndpoints
        );

        if (valid.length === 0) {
            const msg = skipped.length > 0
                ? 'All endpoints already exist. No new endpoints imported.'
                : 'No valid endpoints found in file.';
            showError(msg);
            return;
        }

        // Assign runtime fields and persist
        const prepared = prepareEndpointsForImport(valid);
        const merged = [...existingEndpoints, ...prepared];
        const saved = await saveEndpoints(merged);

        if (saved) {
            await loadEndpoints();
            const skippedNote = skipped.length > 0 ? `, ${skipped.length} skipped as duplicate(s)` : '';
            showSuccess(`Imported ${valid.length} endpoint(s)${skippedNote}`);
            Logger.info(`Import complete: ${valid.length} added, ${skipped.length} skipped`);
        }
    } catch (error) {
        Logger.error('Error importing endpoints:', error);
        showError('Failed to import endpoints.');
    } finally {
        hideLoading();
    }
}

function showError(message) {
    showMessage(message, 'error');
}

function showSuccess(message) {
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
