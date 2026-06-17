// ─── Popup Shared Utilities ────────────────────────────────────────────────────
//
// Shared helpers used by the popup and its sub-modules.
// Extracted to avoid circular dependencies between popup.js and its siblings.
// ───────────────────────────────────────────────────────────────────────────────

import Logger from './utils/logger.js';

// ─── Service Worker Messaging ─────────────────────────────────────────────────

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
            Logger.warn('lastError:', chrome.runtime.lastError.message);
        }
        return null;
    }
}

// ─── Toast Messages ───────────────────────────────────────────────────────────

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

// ─── Loading Overlay ──────────────────────────────────────────────────────────

export function showLoading(message = 'Loading...') {
    const overlay = document.getElementById('loadingOverlay');
    const loadingContent = overlay.querySelector('.loading-content');
    loadingContent.querySelector('p').textContent = message;
    overlay.classList.remove('hidden');
}

export function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}
