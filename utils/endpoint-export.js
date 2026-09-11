// ─── Monitor Export ──────────────────────────────────────────────────────────
//
// Serializes monitor configurations to a versioned JSON file (schema v2:
// `monitors` key with a per-monitor `provider` field).
// Pure function — no I/O, no side effects.
// ───────────────────────────────────────────────────────────────────────────────

import { SCHEMA_ID, SCHEMA_VERSION } from './endpoint-schema.js';

/**
 * Generate a versioned JSON string from a monitors array.
 * Only exports user-facing fields (name, url, enabled, provider).
 * Internal fields (id, createdAt) are intentionally omitted;
 * they will be regenerated on import.
 *
 * @param {Array<{name: string, url: string, enabled: boolean, provider?: string}>} monitors
 * @param {string} extensionVersion - e.g. "3.2.3" from manifest
 * @returns {string} JSON string ready to be saved to a file
 */
export function exportEndpoints(monitors, extensionVersion) {
    const payload = {
        $schema: SCHEMA_ID,
        version: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        source: {
            extension: 'Zendesk Ticket Monitor',
            version: extensionVersion
        },
        monitors: (monitors || []).map(({ name, url, enabled, provider }) => ({
            name,
            url,
            enabled: Boolean(enabled),
            provider: provider === 'jira' ? 'jira' : 'zendesk'
        }))
    };

    return JSON.stringify(payload, null, 2);
}
