// ─── Monitor Import ──────────────────────────────────────────────────────────
//
// Parses, validates, and prepares imported monitor configurations.
// I/O-free pipeline: parse → validate → prepare.
// Accepts schema v1 (`endpoints`, no provider — defaults to zendesk) and
// schema v2 (`monitors`, explicit provider). Entries with an unknown
// provider are skipped with a clear message.
// ───────────────────────────────────────────────────────────────────────────────

import { SCHEMA_VERSION, LEGACY_SCHEMA_VERSION } from './endpoint-schema.js';
import {
    validateEndpointName,
    checkForDuplicates,
    validateMonitorUrl,
    normaliseMonitorUrl
} from './validators.js';

const VALID_PROVIDERS = ['zendesk', 'jira'];

// ─── Parse ────────────────────────────────────────────────────────────────────

/**
 * Parse and structurally validate raw file content from an imported JSON file.
 * Does NOT validate individual monitors — call validateImportedEndpoints() for that.
 *
 * @param {string} fileContent - Raw string from FileReader
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
export function parseImportFile(fileContent) {
    let parsed;
    try {
        parsed = JSON.parse(fileContent);
    } catch {
        return { success: false, error: 'Invalid file format. Could not parse the file as JSON.' };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { success: false, error: 'Invalid file format. Expected a JSON object, got ' + (Array.isArray(parsed) ? 'an array' : typeof parsed) + '.' };
    }

    // Accept schema v1 and v2; anything else is unsupported.
    if (parsed.version !== SCHEMA_VERSION && parsed.version !== LEGACY_SCHEMA_VERSION) {
        return {
            success: false,
            error: 'Unsupported file format. Please use a file exported from this extension.'
        };
    }

    const listKey = parsed.version === LEGACY_SCHEMA_VERSION ? 'endpoints' : 'monitors';

    if (!Array.isArray(parsed[listKey])) {
        return { success: false, error: `Invalid file format. Missing or invalid "${listKey}" array in the file.` };
    }

    if (parsed[listKey].length === 0) {
        return { success: false, error: `No ${listKey === 'monitors' ? 'monitors' : 'endpoints'} found in file.` };
    }

    return { success: true, data: parsed };
}

// ─── Validate ─────────────────────────────────────────────────────────────────

/**
 * Validate each monitor from a parsed import file against existing validators
 * and check for duplicates against currently stored monitors.
 *
 * Entries are validated against their declared provider (v2) or defaulted to
 * zendesk (v1 / missing provider). Unknown providers are skipped. URLs are
 * normalised to their provider's canonical form.
 *
 * Extra/unknown fields on each monitor object are silently ignored.
 *
 * @param {Array<object>} importedMonitors - Raw monitor objects from parsed file
 * @param {Array<object>} existingMonitors - Currently stored monitors
 * @returns {{ valid: Array, skipped: Array<string> }}
 */
export function validateImportedEndpoints(importedMonitors, existingMonitors) {
    const valid = [];
    const skipped = [];

    for (const raw of importedMonitors) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            skipped.push('Skipped entry with invalid structure');
            continue;
        }

        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        const url = typeof raw.url === 'string' ? raw.url.trim() : '';
        const enabled = 'enabled' in raw ? Boolean(raw.enabled) : true;

        // Provider: explicit (v2) or defaulted to zendesk (v1); unknown → skip.
        const provider = raw.provider === undefined ? 'zendesk' : raw.provider;
        if (!VALID_PROVIDERS.includes(provider)) {
            skipped.push(`Skipped "${name || '(unnamed)'}": unknown provider "${raw.provider}"`);
            continue;
        }

        const nameResult = validateEndpointName(name);
        if (!nameResult.valid) {
            skipped.push(`Skipped "${name || '(unnamed)'}": ${nameResult.error}`);
            continue;
        }

        const urlResult = validateMonitorUrl(url, provider);
        if (!urlResult.valid) {
            skipped.push(`Skipped "${name}": ${urlResult.error}`);
            continue;
        }

        // Normalise first so the duplicate check compares like-for-like
        // (stored monitors hold the canonical URL; a raw Jira board URL and
        // its canonical /issues/?jql= form must not both slip through).
        const normalisedUrl = normaliseMonitorUrl(url, provider);

        const allMonitors = [...existingMonitors, ...valid];
        const dupResult = checkForDuplicates(allMonitors, name, normalisedUrl);
        if (dupResult.duplicate) {
            skipped.push(`Skipped "${name}": already exists`);
            continue;
        }

        valid.push({
            name,
            url: normalisedUrl,
            enabled,
            provider
        });
    }

    return { valid, skipped };
}

// ─── Prepare ──────────────────────────────────────────────────────────────────

/**
 * Assign runtime fields (id, createdAt) to a list of validated monitor objects.
 * Uses Date.now() + array index offset to prevent ID collisions within a batch.
 *
 * @param {Array<{name: string, url: string, enabled: boolean, provider: string}>} validMonitors
 * @returns {Array<{id: number, name: string, url: string, enabled: boolean, provider: string, createdAt: number}>}
 */
export function prepareEndpointsForImport(validMonitors) {
    const now = Date.now();
    return validMonitors.map((monitor, index) => ({
        id: now + index,
        name: monitor.name,
        url: monitor.url,
        enabled: monitor.enabled,
        provider: monitor.provider,
        createdAt: now
    }));
}
