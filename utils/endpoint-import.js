// ─── Endpoint Import ──────────────────────────────────────────────────────────
//
// Parses, validates, and prepares imported endpoint configurations.
// I/O-free pipeline: parse → validate → prepare.
// ───────────────────────────────────────────────────────────────────────────────

import { SCHEMA_VERSION } from './endpoint-schema.js';
import { validateEndpointUrl, validateEndpointName, checkForDuplicates } from './validators.js';

// ─── Parse ────────────────────────────────────────────────────────────────────

/**
 * Parse and structurally validate raw file content from an imported JSON file.
 * Does NOT validate individual endpoints — call validateImportedEndpoints() for that.
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

    if (parsed.version !== SCHEMA_VERSION) {
        return {
            success: false,
            error: 'Unsupported file format. Please use a file exported from this extension.'
        };
    }

    if (!Array.isArray(parsed.endpoints)) {
        return { success: false, error: 'Invalid file format. Missing or invalid "endpoints" array in the file.' };
    }

    if (parsed.endpoints.length === 0) {
        return { success: false, error: 'No endpoints found in file.' };
    }

    return { success: true, data: parsed };
}

// ─── Validate ─────────────────────────────────────────────────────────────────

/**
 * Validate each endpoint from a parsed import file against existing validators
 * and check for duplicates against currently stored endpoints.
 *
 * Extra/unknown fields on each endpoint object are silently ignored.
 *
 * @param {Array<object>} importedEndpoints - Raw endpoint objects from parsed file
 * @param {Array<object>} existingEndpoints - Currently stored endpoints
 * @returns {{ valid: Array, skipped: Array<string> }}
 */
export function validateImportedEndpoints(importedEndpoints, existingEndpoints) {
    const valid = [];
    const skipped = [];

    for (const raw of importedEndpoints) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            skipped.push('Skipped entry with invalid structure');
            continue;
        }

        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        const url = typeof raw.url === 'string' ? raw.url.trim() : '';
        const enabled = 'enabled' in raw ? Boolean(raw.enabled) : true;

        const nameResult = validateEndpointName(name);
        if (!nameResult.valid) {
            skipped.push(`Skipped "${name || '(unnamed)'}": ${nameResult.error}`);
            continue;
        }

        const urlResult = validateEndpointUrl(url);
        if (!urlResult.valid) {
            skipped.push(`Skipped "${name}": ${urlResult.error}`);
            continue;
        }

        const allEndpoints = [...existingEndpoints, ...valid];
        const dupResult = checkForDuplicates(allEndpoints, name, url);
        if (dupResult.duplicate) {
            skipped.push(`Skipped "${name}": already exists`);
            continue;
        }

        valid.push({ name, url, enabled });
    }

    return { valid, skipped };
}

// ─── Prepare ──────────────────────────────────────────────────────────────────

/**
 * Assign runtime fields (id, createdAt) to a list of validated endpoint objects.
 * Uses Date.now() + array index offset to prevent ID collisions within a batch.
 *
 * @param {Array<{name: string, url: string, enabled: boolean}>} validEndpoints
 * @returns {Array<{id: number, name: string, url: string, enabled: boolean, createdAt: number}>}
 */
export function prepareEndpointsForImport(validEndpoints) {
    const now = Date.now();
    return validEndpoints.map((endpoint, index) => ({
        id: now + index,
        name: endpoint.name,
        url: endpoint.url,
        enabled: endpoint.enabled,
        createdAt: now
    }));
}
