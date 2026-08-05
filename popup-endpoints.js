// ─── Popup Monitors ───────────────────────────────────────────────────────────
//
// Handles monitor CRUD (create, read, update, delete), import/export,
// and connection testing in the popup UI. Provider-aware: the provider is
// detected from the pasted URL (inference-first, Variant C), validated
// against the detected provider's rules, and stored as `provider`.
// ───────────────────────────────────────────────────────────────────────────────

import Logger from './utils/logger.js';
import * as cookieService from './utils/cookie-service.js';
import { getProvider } from './utils/providers/provider-registry.js';
import {
    validateMonitorUrl,
    normaliseMonitorUrl,
    validateEndpointName,
    checkForDuplicates,
    detectProviderFromUrl
} from './utils/validators.js';
import {
    exportEndpoints
} from './utils/endpoint-export.js';
import {
    parseImportFile,
    validateImportedEndpoints,
    prepareEndpointsForImport
} from './utils/endpoint-import.js';
import { MAX_IMPORT_SIZE_BYTES } from './utils/endpoint-schema.js';
import { getMonitors, saveMonitors } from './utils/storage-service.js';
import { showLoading, hideLoading, showSuccess, showError, sendToSW } from './popup-utils.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function saveMonitorsList(monitors) {
    try {
        await saveMonitors(monitors);
        Logger.info('Monitors saved successfully:', monitors.length, 'monitors');
        return true;
    } catch (error) {
        Logger.error('Failed to save monitors:', error);
        showError('Failed to save monitors. Please try again.');
        return false;
    }
}

// ─── Load & Render ───────────────────────────────────────────────────────────

export async function loadEndpoints() {
    try {
        const monitors = await getMonitors();
        const endpointsList = document.getElementById('endpointsList');

        // Guard: DOM elements may not exist in test environments
        if (!endpointsList) return;

        if (monitors.length === 0) {
            endpointsList.innerHTML = '<div class="error">No monitors configured</div>';
            return;
        }

        // Monitor error state (from the background poller) — best effort.
        let errorsByMonitor = new Map();
        try {
            const response = await sendToSW({ action: 'getMonitorErrors' });
            const errors = response?.errors || [];
            errorsByMonitor = new Map(errors);
        } catch {
            // SW unavailable (tests / SW restart) — render without error lines.
        }

        // Counts for the group headers — best effort.
        let countsByMonitor = new Map();
        try {
            const status = await sendToSW({ action: 'getStatus' });
            countsByMonitor = new Map(status?.counts || []);
        } catch {
            // render without totals
        }

        const fragment = document.createDocumentFragment();
        const groups = groupMonitorsByProvider(monitors);
        groups.forEach(({ provider, monitors: groupMonitors }) => {
            const total = groupMonitors.reduce((sum, m) => sum + (countsByMonitor.get(m.id) || 0), 0);
            const header = document.createElement('div');
            header.className = 'monitor-group-header';
            header.textContent = `${provider.label} · ${groupMonitors.length} monitor${groupMonitors.length === 1 ? '' : 's'} · ${total} ticket${total === 1 ? '' : 's'}`;
            fragment.appendChild(header);

            groupMonitors.forEach((monitor) => {
                fragment.appendChild(createEndpointElement(monitor, errorsByMonitor.get(monitor.id)));
            });
        });
        endpointsList.replaceChildren(fragment);

    } catch (error) {
        Logger.error('Error loading monitors:', error);
        showError('Failed to load monitors');
    }
}

/**
 * Group monitors by provider, preserving provider registry order.
 * @param {Array} monitors
 * @returns {Array<{provider: object, monitors: Array}>}
 */
export function groupMonitorsByProvider(monitors) {
    const groups = [];
    for (const monitor of monitors) {
        const provider = getProvider(monitor.provider);
        let group = groups.find(g => g.provider.id === provider.id);
        if (!group) {
            group = { provider, monitors: [] };
            groups.push(group);
        }
        group.monitors.push(monitor);
    }
    return groups;
}

function createEndpointElement(monitor, error) {
    const div = document.createElement('div');
    div.className = 'endpoint-item';
    div.dataset.endpointId = String(monitor.id);

    div.innerHTML = `
        <div class="endpoint-info">
            <div class="endpoint-name">${escapeHtml(monitor.name)}</div>
            <div class="endpoint-url">${escapeHtml(monitor.url)}</div>
            <div class="endpoint-status ${monitor.enabled ? 'active' : 'inactive'}">
                ${monitor.enabled ? '● Active' : '○ Inactive'}
            </div>
            ${error ? `<div class="endpoint-error">⚠ ${escapeHtml(error.message)}</div>` : ''}
        </div>
        <div class="endpoint-actions">
            <button class="btn btn-secondary toggle-endpoint-btn" data-endpoint-id="${monitor.id}">
                ${monitor.enabled ? 'Disable' : 'Enable'}
            </button>
            <button class="btn btn-danger delete-endpoint-btn" data-endpoint-id="${monitor.id}">
                Delete
            </button>
        </div>
    `;

    return div;
}

/**
 * Re-index monitor row/button data attributes by monitor id (used by the
 * delegated click handlers to map DOM rows to storage entries).
 * @param {HTMLElement} container
 */
export function reindexEndpointElements(_container) {
    // no-op retained for backward compatibility — handlers now use monitor ids
}

// ─── Toggle / Delete ─────────────────────────────────────────────────────────

export async function toggleEndpoint(monitorId) {
    try {
        const monitors = await getMonitors();

        const monitor = monitors.find(m => String(m.id) === String(monitorId));
        if (!monitor) return;

        monitor.enabled = !monitor.enabled;
        const saved = await saveMonitorsList(monitors);
        if (saved) {
            await loadEndpoints();
            showSuccess(`Monitor ${monitor.enabled ? 'enabled' : 'disabled'}`);
        }
    } catch (error) {
        Logger.error('Error toggling monitor:', error);
        showError('Failed to toggle monitor');
    }
}

export async function deleteEndpoint(monitorId) {
    if (!confirm('Are you sure you want to delete this monitor?')) {
        return;
    }

    try {
        const monitors = await getMonitors();
        const index = monitors.findIndex(m => String(m.id) === String(monitorId));
        if (index === -1) return;

        monitors.splice(index, 1);
        const saved = await saveMonitorsList(monitors);
        if (saved) {
            await loadEndpoints();
            showSuccess('Monitor deleted');
        }
    } catch (error) {
        Logger.error('Error deleting monitor:', error);
        showError('Failed to delete monitor');
    }
}

// ─── Add / Save ─────────────────────────────────────────────────────────────

export function showAddEndpointModal() {
    document.getElementById('addEndpointModal').classList.remove('hidden');
    document.getElementById('endpointName').focus();
    updateProviderDetection('');
}

export function hideAddEndpointModal() {
    document.getElementById('addEndpointModal').classList.add('hidden');
    document.getElementById('endpointName').value = '';
    document.getElementById('endpointUrl').value = '';
    updateProviderDetection('');
}

/**
 * Live provider detection for the add-monitor modal (inference-first).
 * Exported for tests.
 * @param {string} url
 * @returns {string|null} — provider id or null
 */
export function updateProviderDetection(url) {
    const chip = document.getElementById('providerDetectChip');
    const errorEl = document.getElementById('endpointUrlError');

    if (!chip) return null;

    const providerId = detectProviderFromUrl(url);
    if (providerId) {
        const provider = getProvider(providerId);
        chip.textContent = `Detected: ${provider.label}`;
        chip.className = `provider-chip ${providerId}`;
        if (errorEl) errorEl.classList.add('hidden');
    } else {
        chip.textContent = '';
        chip.className = 'provider-chip';
        if (errorEl && url.length > 0) {
            errorEl.textContent = 'Could not detect a provider. Use a *.zendesk.com or *.atlassian.net search URL.';
            errorEl.classList.remove('hidden');
        } else if (errorEl) {
            errorEl.classList.add('hidden');
        }
    }
    return providerId;
}

export async function handleSaveEndpoint() {
    const name = document.getElementById('endpointName').value.trim();
    const url = document.getElementById('endpointUrl').value.trim();

    try {
        const monitors = await getMonitors();

        // Inference-first validation: detect the provider, then validate
        // against its rules (variant C).
        const validation = validateMonitorUrl(url);
        if (!validation.valid) {
            showError(validation.error);
            return;
        }
        const provider = validation.provider;

        const nameResult = validateEndpointName(name);
        if (!nameResult.valid) {
            showError(nameResult.error);
            return;
        }

        const dupResult = checkForDuplicates(monitors, name, url);
        if (dupResult.duplicate) {
            showError(dupResult.error);
            return;
        }

        const newMonitor = {
            id: Date.now(),
            name: name,
            url: normaliseMonitorUrl(url, provider),
            enabled: true,
            provider: provider,
            createdAt: Date.now()
        };

        monitors.push(newMonitor);
        const saved = await saveMonitorsList(monitors);
        if (saved) {
            hideAddEndpointModal();
            await loadEndpoints();
            showSuccess('Monitor added successfully');
        }

    } catch (error) {
        Logger.error('Error saving monitor:', error);
        showError('Failed to save monitor');
    }
}

// ─── Test Connection ─────────────────────────────────────────────────────────

export async function handleTestEndpoint() {
    const url = document.getElementById('endpointUrl').value.trim();

    const validation = validateMonitorUrl(url);
    if (!validation.valid) {
        showError(validation.error);
        return;
    }

    showLoading('Testing monitor connection...');
    const testResult = await testEndpoint(url, validation.provider);
    hideLoading();

    if (testResult.success) {
        showSuccess(testResult.message);
    } else {
        showError(testResult.message);
    }
}

export async function testEndpoint(url, providerId) {
    const provider = getProvider(providerId || detectProviderFromUrl(url));
    if (!providerId && !provider) {
        return { success: false, message: 'Could not detect a provider for that URL' };
    }

    try {
        const apiUrl = provider.buildApiUrl(url);
        const deps = { cookies: null, credentials: null };

        if (provider.id === 'zendesk') {
            const urlObj = new URL(url);
            const cookieString = await cookieService.getCookies(urlObj.hostname);
            if (!cookieString) {
                return { success: false, message: 'No Zendesk auth cookies found. Please log in to your Zendesk site in the browser.' };
            }
            deps.cookies = cookieString;
        } else if (provider.id === 'jira') {
            const urlObj = new URL(url);
            const { jiraCredentials } = await chrome.storage.local.get(['jiraCredentials']);
            const credentials = (jiraCredentials || {})[urlObj.hostname];
            if (!credentials || !credentials.email || !credentials.token) {
                return { success: false, message: `No Jira credentials configured for ${urlObj.hostname}. Add them in Settings → Jira credentials.` };
            }
            deps.credentials = credentials;
        }

        const response = await fetch(apiUrl, {
            ...provider.buildFetchOptions(deps),
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const count = provider.parseCount(data);

        // Strict response-shape check per provider: the count field must exist
        // (parseCount defaults to 0, which would mask a malformed response).
        const hasCount = provider.id === 'jira'
            ? typeof data.count !== 'undefined' || typeof data.total !== 'undefined'
            : typeof data.count !== 'undefined';
        if (!hasCount) {
            throw new Error('Invalid API response format');
        }

        return {
            success: true,
            count,
            message: `Success: Found ${count} tickets`
        };
    } catch (error) {
        Logger.error('Monitor test error:', error);
        return {
            success: false,
            message: error.message || 'Failed to connect to monitor'
        };
    }
}

// ─── Import / Export ─────────────────────────────────────────────────────────

export async function handleExportEndpoints() {
    try {
        const monitors = await getMonitors();

        if (monitors.length === 0) {
            showError('No monitors to export.');
            return;
        }

        const manifest = chrome.runtime.getManifest();
        const json = exportEndpoints(monitors, manifest.version);

        const today = new Date().toISOString().slice(0, 10);
        const filename = `ticket-monitors-${today}.json`;

        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);

        Logger.info(`Exported ${monitors.length} monitor(s) to ${filename}`);
        showSuccess(`Exported ${monitors.length} monitor(s)`);
    } catch (error) {
        Logger.error('Error exporting monitors:', error);
        showError('Failed to export monitors.');
    }
}

export function handleImportEndpoints() {
    document.getElementById('importFileInput').click();
}

export async function handleImportFileSelected(event) {
    const file = event.target.files[0];

    event.target.value = '';

    if (!file) {
        return;
    }

    if (file.size > MAX_IMPORT_SIZE_BYTES) {
        showError('File is too large. Maximum size is 1 MB.');
        return;
    }

    // Guard: MIME type (accept=".json" can be bypassed via "All Files")
    if (file.type && file.type !== 'application/json' && !file.type.startsWith('text/')) {
        showError('Invalid file type. Please select a JSON file.');
        return;
    }

    try {
        showLoading('Importing monitors...');

        const fileContent = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });

        const parsed = parseImportFile(fileContent);
        if (!parsed.success) {
            showError(parsed.error);
            return;
        }

        const listKey = parsed.data.monitors ? 'monitors' : 'endpoints';
        const existingMonitors = await getMonitors();
        const { valid, skipped } = validateImportedEndpoints(
            parsed.data[listKey],
            existingMonitors
        );

        if (valid.length === 0) {
            showError('No valid monitors found in file');
            return;
        }

        const newMonitors = prepareEndpointsForImport(valid);
        const mergedMonitors = [...existingMonitors, ...newMonitors];

        const saved = await saveMonitorsList(mergedMonitors);
        if (saved) {
            await loadEndpoints();
            showSuccess(
                `Imported ${valid.length} monitor(s)${skipped.length > 0 ? `. Skipped ${skipped.length} duplicate(s).` : ''}`
            );
        }
    } catch (error) {
        Logger.error('Error importing monitors:', error);
        showError('Failed to import monitors');
    } finally {
        hideLoading();
    }
}
