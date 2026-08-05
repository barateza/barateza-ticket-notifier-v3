// Unit tests for schema v2 monitor import/export (v1 accepted on import).
import { SCHEMA_ID, SCHEMA_VERSION, LEGACY_SCHEMA_VERSION, MAX_IMPORT_SIZE_BYTES } from '../utils/endpoint-schema.js';
import { exportEndpoints } from '../utils/endpoint-export.js';
import { parseImportFile, validateImportedEndpoints, prepareEndpointsForImport } from '../utils/endpoint-import.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_MONITOR = {
    id: 100,
    name: 'My Tickets',
    url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+assignee:me+status:open',
    enabled: true,
    provider: 'zendesk',
    createdAt: 1000
};

const VALID_MONITOR_2 = {
    id: 200,
    name: 'EMEA Tickets',
    url: 'https://company.zendesk.com/api/v2/search.json?query=type:ticket+group:emea',
    enabled: false,
    provider: 'zendesk',
    createdAt: 2000
};

const VALID_JIRA_MONITOR = {
    id: 300,
    name: 'SUPPORT Open',
    url: 'https://myco.atlassian.net/issues/?jql=project%20%3D%20SUPPORT%20AND%20status%20%3D%20Open',
    enabled: true,
    provider: 'jira',
    createdAt: 3000
};

function buildExportJson(overrides = {}) {
    return JSON.stringify({
        $schema: SCHEMA_ID,
        version: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        source: { extension: 'Zendesk Ticket Monitor', version: '3.2.3' },
        monitors: [{ name: VALID_MONITOR.name, url: VALID_MONITOR.url, enabled: VALID_MONITOR.enabled, provider: VALID_MONITOR.provider }],
        ...overrides
    });
}

/** v1 export shape — the legacy `endpoints` key without provider. */
function buildV1ExportJson(overrides = {}) {
    return JSON.stringify({
        $schema: 'zendesk-ticket-monitor/endpoints/v1',
        version: LEGACY_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        source: { extension: 'Zendesk Ticket Monitor', version: '3.2.3' },
        endpoints: [{ name: VALID_MONITOR.name, url: VALID_MONITOR.url, enabled: VALID_MONITOR.enabled }],
        ...overrides
    });
}

// ─── exportEndpoints ──────────────────────────────────────────────────────────

describe('exportEndpoints', () => {
    test('returns a valid JSON string', () => {
        const json = exportEndpoints([VALID_MONITOR], '3.2.3');
        expect(() => JSON.parse(json)).not.toThrow();
    });

    test('includes required top-level fields', () => {
        const data = JSON.parse(exportEndpoints([VALID_MONITOR], '3.2.3'));
        expect(data.$schema).toBe(SCHEMA_ID);
        expect(data.version).toBe(SCHEMA_VERSION);
        expect(data.exportedAt).toBeDefined();
        expect(data.source.extension).toBe('Zendesk Ticket Monitor');
        expect(data.source.version).toBe('3.2.3');
        expect(Array.isArray(data.monitors)).toBe(true);
    });

    test('exports name, url, enabled, provider — not id or createdAt', () => {
        const data = JSON.parse(exportEndpoints([VALID_MONITOR], '3.2.3'));
        const ep = data.monitors[0];
        expect(ep.name).toBe(VALID_MONITOR.name);
        expect(ep.url).toBe(VALID_MONITOR.url);
        expect(ep.enabled).toBe(VALID_MONITOR.enabled);
        expect(ep.provider).toBe('zendesk');
        expect(ep.id).toBeUndefined();
        expect(ep.createdAt).toBeUndefined();
    });

    test('exports the jira provider for jira monitors', () => {
        const data = JSON.parse(exportEndpoints([VALID_JIRA_MONITOR], '3.2.3'));
        expect(data.monitors[0].provider).toBe('jira');
    });

    test('defaults missing provider to zendesk on export', () => {
        const data = JSON.parse(exportEndpoints([{ ...VALID_MONITOR, provider: undefined }], '3.2.3'));
        expect(data.monitors[0].provider).toBe('zendesk');
    });

    test('handles multiple monitors', () => {
        const data = JSON.parse(exportEndpoints([VALID_MONITOR, VALID_MONITOR_2], '3.2.3'));
        expect(data.monitors).toHaveLength(2);
        expect(data.monitors[1].enabled).toBe(false); // preserves disabled state
    });

    test('handles empty monitors array', () => {
        const data = JSON.parse(exportEndpoints([], '3.2.3'));
        expect(data.monitors).toHaveLength(0);
    });

    test('handles null/undefined monitors gracefully', () => {
        const data = JSON.parse(exportEndpoints(null, '3.2.3'));
        expect(data.monitors).toHaveLength(0);
    });

    test('coerces enabled field to boolean', () => {
        const ep = { ...VALID_MONITOR, enabled: 1 };
        const data = JSON.parse(exportEndpoints([ep], '3.2.3'));
        expect(typeof data.monitors[0].enabled).toBe('boolean');
    });
});

// ─── parseImportFile ──────────────────────────────────────────────────────────

describe('parseImportFile', () => {
    test('accepts a valid v2 export JSON string', () => {
        const result = parseImportFile(buildExportJson());
        expect(result.success).toBe(true);
        expect(result.data.monitors).toHaveLength(1);
    });

    test('accepts a valid v1 export JSON string', () => {
        const result = parseImportFile(buildV1ExportJson());
        expect(result.success).toBe(true);
        expect(result.data.endpoints).toHaveLength(1);
    });

    test('rejects invalid JSON', () => {
        const result = parseImportFile('{ not valid json }');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Invalid file format/);
    });

    test('rejects non-object JSON (e.g., plain array)', () => {
        const result = parseImportFile(JSON.stringify([{ foo: 'bar' }]));
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Invalid file format/);
    });

    test('rejects unsupported schema version', () => {
        const result = parseImportFile(buildExportJson({ version: 99 }));
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Unsupported file format/);
    });

    test('rejects missing version field', () => {
        const json = JSON.stringify({
            $schema: SCHEMA_ID,
            monitors: [{ name: 'Test', url: 'https://x.zendesk.com/api/v2/search.json?query=q', enabled: true }]
        });
        const result = parseImportFile(json);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Unsupported file format/);
    });

    test('rejects missing monitors field in v2', () => {
        const json = JSON.stringify({ $schema: SCHEMA_ID, version: SCHEMA_VERSION });
        const result = parseImportFile(json);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Invalid file format/);
    });

    test('rejects monitors that is not an array', () => {
        const result = parseImportFile(buildExportJson({ monitors: {} }));
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Invalid file format/);
    });

    test('rejects empty monitors array', () => {
        const result = parseImportFile(buildExportJson({ monitors: [] }));
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/No monitors found/);
    });

    test('ignores extra/unknown top-level fields', () => {
        const result = parseImportFile(buildExportJson({ unknownField: 'ignored' }));
        expect(result.success).toBe(true);
    });
});

// ─── validateImportedEndpoints ────────────────────────────────────────────────

describe('validateImportedEndpoints', () => {
    const existing = [VALID_MONITOR];

    test('accepts valid zendesk monitors', () => {
        const raw = [{ name: 'New Queue', url: 'https://company.zendesk.com/api/v2/search.json?query=type:ticket', enabled: true, provider: 'zendesk' }];
        const { valid, skipped } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(1);
        expect(valid[0].provider).toBe('zendesk');
        expect(skipped).toHaveLength(0);
    });

    test('accepts valid jira monitors and normalises the URL', () => {
        const raw = [{
            name: 'Jira Queue',
            url: 'https://myco.atlassian.net/jira/software/c/projects/SUPPORT/boards/1?jql=assignee%20%3D%20currentUser()',
            enabled: true,
            provider: 'jira'
        }];
        const { valid, skipped } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(1);
        expect(valid[0].provider).toBe('jira');
        expect(valid[0].url).toBe('https://myco.atlassian.net/issues/?jql=assignee%20%3D%20currentUser()');
        expect(skipped).toHaveLength(0);
    });

    test('v1 entries without provider default to zendesk', () => {
        const raw = [{ name: 'Legacy', url: 'https://x.zendesk.com/api/v2/search.json?query=q', enabled: true }];
        const { valid } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(1);
        expect(valid[0].provider).toBe('zendesk');
    });

    test('skips entries with unknown provider', () => {
        const raw = [{ name: 'Alien', url: 'https://x.zendesk.com/api/v2/search.json?query=q', provider: 'salesforce' }];
        const { valid, skipped } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(0);
        expect(skipped).toHaveLength(1);
        expect(skipped[0]).toContain('unknown provider');
    });

    test('skips jira entries that fail jira validation', () => {
        const raw = [{ name: 'Bad Jira', url: 'https://myco.atlassian.net/issues/', provider: 'jira' }];
        const { valid, skipped } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(0);
        expect(skipped[0]).toContain('jql');
    });

    test('skips entries with invalid URL (non-Zendesk domain)', () => {
        const raw = [{ name: 'Bad URL', url: 'https://example.com/api/v2/search.json?query=type:ticket', enabled: true, provider: 'zendesk' }];
        const { valid, skipped } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(0);
        expect(skipped).toHaveLength(1);
        expect(skipped[0]).toContain('Bad URL');
    });

    test('skips entries with missing API path', () => {
        const raw = [{ name: 'No API', url: 'https://company.zendesk.com/agent/view', enabled: true, provider: 'zendesk' }];
        const { valid, skipped } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(0);
        expect(skipped).toHaveLength(1);
    });

    test('skips entries with name > 50 characters', () => {
        const raw = [{ name: 'n'.repeat(51), url: 'https://x.zendesk.com/api/v2/search.json?query=q', enabled: true, provider: 'zendesk' }];
        const { valid, skipped } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(0);
        expect(skipped).toHaveLength(1);
    });

    test('skips entries with missing name', () => {
        const raw = [{ name: '', url: 'https://x.zendesk.com/api/v2/search.json?query=q', enabled: true, provider: 'zendesk' }];
        const { valid, skipped } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(0);
        expect(skipped).toHaveLength(1);
    });

    test('skips entries that duplicate existing monitor URL', () => {
        const raw = [{ name: 'Dup URL', url: VALID_MONITOR.url, enabled: true, provider: 'zendesk' }];
        const { valid, skipped } = validateImportedEndpoints(raw, existing);
        expect(valid).toHaveLength(0);
        expect(skipped).toHaveLength(1);
        expect(skipped[0]).toMatch(/already exists/);
    });

    test('skips entries that duplicate existing monitor name', () => {
        const raw = [{ name: VALID_MONITOR.name, url: 'https://x.zendesk.com/api/v2/search.json?query=q', enabled: true, provider: 'zendesk' }];
        const { valid, skipped } = validateImportedEndpoints(raw, existing);
        expect(valid).toHaveLength(0);
        expect(skipped).toHaveLength(1);
    });

    test('skips duplicates within the import batch itself', () => {
        const ep1 = { name: 'Same', url: 'https://x.zendesk.com/api/v2/search.json?query=q', enabled: true, provider: 'zendesk' };
        const ep2 = { name: 'Same Copy', url: 'https://x.zendesk.com/api/v2/search.json?query=q', enabled: true, provider: 'zendesk' }; // same URL
        const { valid, skipped } = validateImportedEndpoints([ep1, ep2], []);
        expect(valid).toHaveLength(1);
        expect(skipped).toHaveLength(1);
    });

    test('accepts partial batch — valid pass, invalid skip', () => {
        const raw = [
            { name: 'Valid', url: 'https://company.zendesk.com/api/v2/search.json?query=type:ticket', enabled: true, provider: 'zendesk' },
            { name: '', url: 'bad-url', enabled: true, provider: 'zendesk' }
        ];
        const { valid, skipped } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(1);
        expect(skipped).toHaveLength(1);
    });

    test('skips non-object entries', () => {
        const raw = ['not-an-object', null, 42];
        const { valid, skipped } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(0);
        expect(skipped).toHaveLength(3);
    });

    test('defaults missing enabled field to true', () => {
        const raw = [{ name: 'No Enabled', url: 'https://x.zendesk.com/api/v2/search.json?query=q', provider: 'zendesk' }];
        const { valid } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(1);
        expect(valid[0].enabled).toBe(true);
    });

    test('ignores extra fields on monitor objects', () => {
        const raw = [{ name: 'With Extra', url: 'https://x.zendesk.com/api/v2/search.json?query=q', enabled: false, id: 999, createdAt: 0, unknown: true, provider: 'zendesk' }];
        const { valid } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(1);
        expect(valid[0].id).toBeUndefined();
        expect(valid[0].unknown).toBeUndefined();
    });
});

// ─── prepareEndpointsForImport ────────────────────────────────────────────────

describe('prepareEndpointsForImport', () => {
    test('assigns id and createdAt to each monitor', () => {
        const input = [{ name: 'A', url: 'url1', enabled: true, provider: 'zendesk' }];
        const result = prepareEndpointsForImport(input);
        expect(typeof result[0].id).toBe('number');
        expect(typeof result[0].createdAt).toBe('number');
    });

    test('each monitor in a batch gets a unique id', () => {
        const input = [
            { name: 'A', url: 'url1', enabled: true, provider: 'zendesk' },
            { name: 'B', url: 'url2', enabled: false, provider: 'zendesk' }
        ];
        const result = prepareEndpointsForImport(input);
        expect(result[0].id).not.toBe(result[1].id);
    });

    test('preserves name, url, enabled, and provider from input', () => {
        const input = [{ name: 'My Queue', url: 'https://x.atlassian.net/issues/?jql=q', enabled: false, provider: 'jira' }];
        const result = prepareEndpointsForImport(input);
        expect(result[0].name).toBe('My Queue');
        expect(result[0].url).toBe('https://x.atlassian.net/issues/?jql=q');
        expect(result[0].enabled).toBe(false);
        expect(result[0].provider).toBe('jira');
    });

    test('returns empty array for empty input', () => {
        expect(prepareEndpointsForImport([])).toEqual([]);
    });
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe('module constants', () => {
    test('SCHEMA_VERSION is 2', () => {
        expect(SCHEMA_VERSION).toBe(2);
    });

    test('LEGACY_SCHEMA_VERSION is 1', () => {
        expect(LEGACY_SCHEMA_VERSION).toBe(1);
    });

    test('SCHEMA_ID is the v2 monitors id', () => {
        expect(SCHEMA_ID).toBe('zendesk-ticket-monitor/monitors/v2');
    });

    test('MAX_IMPORT_SIZE_BYTES is 1MB', () => {
        expect(MAX_IMPORT_SIZE_BYTES).toBe(1024 * 1024);
    });
});
