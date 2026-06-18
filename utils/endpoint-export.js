// ─── Endpoint Export ──────────────────────────────────────────────────────────
//
// Serializes endpoint configurations to a versioned JSON file.
// Pure function — no I/O, no side effects.
// ───────────────────────────────────────────────────────────────────────────────

import { SCHEMA_ID, SCHEMA_VERSION } from './endpoint-schema.js';

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
