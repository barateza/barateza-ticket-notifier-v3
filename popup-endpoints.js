// ─── Popup Endpoints ──────────────────────────────────────────────────────────
//
// Handles endpoint CRUD (create, read, update, delete), import/export,
// and connection testing in the popup UI.
// ───────────────────────────────────────────────────────────────────────────────

import Logger from './utils/logger.js';
import * as cookieService from './utils/cookie-service.js';
import { validateEndpointUrl, validateEndpoint } from './utils/validators.js';
import {
    exportEndpoints
} from './utils/endpoint-export.js';
import {
    parseImportFile,
    validateImportedEndpoints,
    prepareEndpointsForImport
} from './utils/endpoint-import.js';
import { MAX_IMPORT_SIZE_BYTES } from './utils/endpoint-schema.js';
import { showLoading, hideLoading, showSuccess, showError } from './popup-utils.js';

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

// ─── Load & Render ───────────────────────────────────────────────────────────

export async function loadEndpoints() {
    try {
        const { endpoints } = await chrome.storage.local.get(['endpoints']);
        const endpointsList = document.getElementById('endpointsList');

        if (!endpoints || endpoints.length === 0) {
            endpointsList.innerHTML = '<div class="error">No endpoints configured</div>';
            return;
        }

        const fragment = document.createDocumentFragment();
        endpoints.forEach((endpoint, index) => {
            fragment.appendChild(createEndpointElement(endpoint, index));
        });
        endpointsList.replaceChildren(fragment);

    } catch (error) {
        Logger.error('Error loading endpoints:', error);
        showError('Failed to load endpoints');
    }
}

function createEndpointElement(endpoint, index) {
    const div = document.createElement('div');
    div.className = 'endpoint-item';
    div.dataset.index = String(index);
    div.dataset.endpointId = String(endpoint.id);

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

/**
 * Re-index endpoint row/button data-index attributes after row deletions
 * so delegated click handlers continue mapping DOM rows to storage array indexes.
 * @param {HTMLElement} container
 */
export function reindexEndpointElements(container) {
    const items = container.querySelectorAll('.endpoint-item');
    items.forEach((item, index) => {
        item.dataset.index = String(index);
        const toggleBtn = item.querySelector('.toggle-endpoint-btn');
        const deleteBtn = item.querySelector('.delete-endpoint-btn');
        if (toggleBtn) toggleBtn.dataset.index = String(index);
        if (deleteBtn) deleteBtn.dataset.index = String(index);
    });
}

// ─── Toggle / Delete ─────────────────────────────────────────────────────────

export async function toggleEndpoint(index) {
    try {
        const { endpoints } = await chrome.storage.local.get(['endpoints']);

        if (endpoints && endpoints[index]) {
            endpoints[index].enabled = !endpoints[index].enabled;
            const saved = await saveEndpoints(endpoints);
            if (saved) {
                const endpointsList = document.getElementById('endpointsList');
                const currentNode = endpointsList.querySelector(`.endpoint-item[data-index="${index}"]`);
                const updatedNode = createEndpointElement(endpoints[index], index);
                if (currentNode) {
                    currentNode.replaceWith(updatedNode);
                } else {
                    await loadEndpoints();
                }
                showSuccess(`Endpoint ${endpoints[index].enabled ? 'enabled' : 'disabled'}`);
            }
        }
    } catch (error) {
        Logger.error('Error toggling endpoint:', error);
        showError('Failed to toggle endpoint');
    }
}

export async function deleteEndpoint(index) {
    if (!confirm('Are you sure you want to delete this endpoint?')) {
        return;
    }

    try {
        const { endpoints } = await chrome.storage.local.get(['endpoints']);

        if (endpoints && endpoints[index]) {
            endpoints.splice(index, 1);
            const saved = await saveEndpoints(endpoints);
            if (saved) {
                const endpointsList = document.getElementById('endpointsList');
                const currentNode = endpointsList.querySelector(`.endpoint-item[data-index="${index}"]`);
                if (currentNode) {
                    currentNode.remove();
                    if (endpoints.length === 0) {
                        endpointsList.innerHTML = '<div class="error">No endpoints configured</div>';
                    } else {
                        reindexEndpointElements(endpointsList);
                    }
                } else {
                    await loadEndpoints();
                }
                showSuccess('Endpoint deleted');
            }
        }
    } catch (error) {
        Logger.error('Error deleting endpoint:', error);
        showError('Failed to delete endpoint');
    }
}

// ─── Add / Save ─────────────────────────────────────────────────────────────

export function showAddEndpointModal() {
    document.getElementById('addEndpointModal').classList.remove('hidden');
    document.getElementById('endpointName').focus();
}

export function hideAddEndpointModal() {
    document.getElementById('addEndpointModal').classList.add('hidden');
    document.getElementById('endpointName').value = '';
    document.getElementById('endpointUrl').value = '';
}

export async function handleSaveEndpoint() {
    const name = document.getElementById('endpointName').value.trim();
    const url = document.getElementById('endpointUrl').value.trim();

    try {
        const { endpoints = [] } = await chrome.storage.local.get(['endpoints']);

        // Validate endpoint
        const validation = validateEndpoint({ name, url }, endpoints);
        if (!validation.valid) {
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

// ─── Test Connection ─────────────────────────────────────────────────────────

export async function handleTestEndpoint() {
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

export async function testEndpoint(url) {
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;

        const cookieString = await cookieService.getCookies(domain);

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

// ─── Import / Export ─────────────────────────────────────────────────────────

export async function handleExportEndpoints() {
    try {
        const { endpoints } = await chrome.storage.local.get(['endpoints']);

        if (!endpoints || endpoints.length === 0) {
            showError('No endpoints to export.');
            return;
        }

        const manifest = chrome.runtime.getManifest();
        const json = exportEndpoints(endpoints, manifest.version);

        const today = new Date().toISOString().slice(0, 10);
        const filename = `zendesk-endpoints-${today}.json`;

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
        showLoading('Importing endpoints...');

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

        const { endpoints: existingEndpoints = [] } = await chrome.storage.local.get(['endpoints']);
        const { valid, skipped } = validateImportedEndpoints(
            parsed.data.endpoints,
            existingEndpoints
        );

        if (valid.length === 0) {
            showError('No valid endpoints found in file');
            return;
        }

        const newEndpoints = prepareEndpointsForImport(valid);
        const mergedEndpoints = [...existingEndpoints, ...newEndpoints];

        const saved = await saveEndpoints(mergedEndpoints);
        if (saved) {
            await loadEndpoints();
            showSuccess(
                `Imported ${valid.length} endpoint(s)${skipped.length > 0 ? `. Skipped ${skipped.length} duplicate(s).` : ''}`
            );
        }
    } catch (error) {
        Logger.error('Error importing endpoints:', error);
        showError('Failed to import endpoints');
    } finally {
        hideLoading();
    }
}
