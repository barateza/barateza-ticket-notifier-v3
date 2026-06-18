// ─── Popup Update Checker ──────────────────────────────────────────────────────
//
// Checks GitHub Releases for newer extension versions.
// Results are cached in chrome.storage.local to avoid hitting GitHub API
// rate limits on every popup open.
// ───────────────────────────────────────────────────────────────────────────────

import Logger from './utils/logger.js';
import { getLocal, setLocal } from './utils/storage-service.js';

const CACHE_KEY = 'lastVersionCheck';
const CACHE_TTL_MS = 3600_000; // 1 hour

/**
 * Check for updates on GitHub
 */
export async function checkForUpdates() {
    // Check cache first
    const cached = await getLocal([CACHE_KEY]);
    if (cached[CACHE_KEY]) {
        const { timestamp, version } = cached[CACHE_KEY];
        if (Date.now() - timestamp < CACHE_TTL_MS) {
            // Cache is fresh — show banner if update was found, skip API call
            if (version && isNewerVersion(chrome.runtime.getManifest().version, version)) {
                showUpdateBanner(version);
            }
            return;
        }
    }

    try {
        const manifest = chrome.runtime.getManifest();
        const currentVersion = manifest.version;

        const response = await fetch('https://api.github.com/repos/barateza/barateza-ticket-notifier-v3/releases/latest');
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }

        const data = await response.json();
        const latestVersion = data.tag_name.replace(/^v/, '');

        // Cache the result
        await setLocal({
            [CACHE_KEY]: {
                timestamp: Date.now(),
                version: latestVersion
            }
        });

        if (isNewerVersion(currentVersion, latestVersion)) {
            showUpdateBanner(latestVersion);
        }
    } catch (error) {
        Logger.error('Failed to check for updates:', error);
    }
}

function showUpdateBanner(latestVersion) {
    const updateStatus = document.getElementById('updateStatus');
    if (!updateStatus) return;

    updateStatus.textContent = `Update available: v${latestVersion}`;
    updateStatus.href = 'https://github.com/barateza/barateza-ticket-notifier-v3/releases/latest';
    updateStatus.classList.remove('hidden');
    updateStatus.title = `Update available: v${latestVersion}. Click to open releases page.`;

    updateStatus.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: updateStatus.href });
    });
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
