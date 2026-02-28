// Endpoint Import/Export Utilities for Zendesk Ticket Monitor
// Provides serialization/deserialization of endpoint configurations
// with schema versioning for forward compatibility.

import {
    validateEndpointUrl,
    validateEndpointName,
    checkForDuplicates
} from './validators.js';

// ─── Schema Constants ─────────────────────────────────────────────────────────

export const SCHEMA_ID = 'zendesk-ticket-monitor/endpoints/v1';
export const SCHEMA_VERSION = 1;
export const MAX_IMPORT_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Generate a versioned JSON string from an endpoints array.
 * Only exports user-facing fields (name, url, enabled).
 * Internal fields (id, createdAt) are intentionally omitted;
 * they will be regenerated on import.
 *
 * @param {Array<{name: string, url: string, enabled: boolean}>} endpoints
 * @param {string} extensionVersion - e.g. "3.2.3" from manifest
 * @returns {string} JSON string ready to be saved to a file
 */
export function exportEndpoints(endpoints, extensionVersion) {
    const payload = {
        $schema: SCHEMA_ID,
        version: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        source: {
            extension: 'Zendesk Ticket Monitor',
            version: extensionVersion
        },
        endpoints: (endpoints || []).map(({ name, url, enabled }) => ({
            name,
            url,
            enabled: Boolean(enabled)
        }))
    };

    return JSON.stringify(payload, null, 2);
}

// ─── Import: Parse ────────────────────────────────────────────────────────────

/**
 * Parse and structurally validate raw file content from an imported JSON file.
 * Does NOT validate individual endpoints — call validateImportedEndpoints() for that.
 *
 * @param {string} fileContent - Raw string from FileReader
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
export function parseImportFile(fileContent) {
    // 1. Parse JSON
    let parsed;
    try {
        parsed = JSON.parse(fileContent);
    } catch {
        return { success: false, error: 'Invalid file format. Please select a valid JSON file.' };
    }

    // 2. Ensure it's an object (guards against plain JSON arrays, strings, etc.)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { success: false, error: 'Invalid file format. Please select a valid JSON file.' };
    }

    // 3. Validate schema version
    if (parsed.version !== SCHEMA_VERSION) {
        return {
            success: false,
            error: 'Unsupported file format. Please use a file exported from this extension.'
        };
    }

    // 4. Validate endpoints array presence
    if (!Array.isArray(parsed.endpoints)) {
        return { success: false, error: 'Invalid file format. Please select a valid JSON file.' };
    }

    // 5. Empty array guard
    if (parsed.endpoints.length === 0) {
        return { success: false, error: 'No endpoints found in file.' };
    }

    return { success: true, data: parsed };
}

// ─── Import: Validate ─────────────────────────────────────────────────────────

/**
 * Validate each endpoint from a parsed import file against existing validators
 * and check for duplicates against currently stored endpoints.
 *
 * Extra/unknown fields on each endpoint object are silently ignored.
 *
 * @param {Array<object>} importedEndpoints - Raw endpoint objects from parsed file
 * @param {Array<object>} existingEndpoints - Currently stored endpoints
 * @returns {{ valid: Array, skipped: Array<string> }}
 *   - valid: endpoints ready to persist
 *   - skipped: human-readable reason strings for each rejected entry
 */
export function validateImportedEndpoints(importedEndpoints, existingEndpoints) {
    const valid = [];
    const skipped = [];

    for (const raw of importedEndpoints) {
        // Guard: must be a plain object
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            skipped.push('Skipped entry with invalid structure');
            continue;
        }

        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        const url = typeof raw.url === 'string' ? raw.url.trim() : '';
        const enabled = 'enabled' in raw ? Boolean(raw.enabled) : true;

        // Validate name
        const nameResult = validateEndpointName(name);
        if (!nameResult.valid) {
            skipped.push(`Skipped "${name || '(unnamed)'}": ${nameResult.error}`);
            continue;
        }

        // Validate URL
        const urlResult = validateEndpointUrl(url);
        if (!urlResult.valid) {
            skipped.push(`Skipped "${name}": ${urlResult.error}`);
            continue;
        }

        // Check against existing endpoints (in storage) AND already-validated entries
        // in this same import batch to avoid duplicate-from-batch issues.
        const allEndpoints = [...existingEndpoints, ...valid];
        const dupResult = checkForDuplicates(allEndpoints, name, url);
        if (dupResult.duplicate) {
            skipped.push(`Skipped "${name}": already exists`);
            continue;
        }

        // Only carry over user-meaningful fields
        valid.push({ name, url, enabled });
    }

    return { valid, skipped };
}

// ─── Import: Prepare ──────────────────────────────────────────────────────────

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
