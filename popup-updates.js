// ─── Popup Update Checker ──────────────────────────────────────────────────────
//
// Checks GitHub Releases for newer extension versions.
// ───────────────────────────────────────────────────────────────────────────────

import Logger from './utils/logger.js';

/**
 * Check for updates on GitHub
 */
export async function checkForUpdates() {
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
export function isNewerVersion(current, latest) {
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
