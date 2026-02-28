// Unit tests for utils/endpoint-io.js
import {
    SCHEMA_ID,
    SCHEMA_VERSION,
    MAX_IMPORT_SIZE_BYTES,
    exportEndpoints,
    parseImportFile,
    validateImportedEndpoints,
    prepareEndpointsForImport
} from '../utils/endpoint-io.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_ENDPOINT = {
    id: 100,
    name: 'AMER Tickets',
    url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket',
    enabled: true,
    createdAt: 1000
};

const VALID_ENDPOINT_2 = {
    id: 200,
    name: 'EMEA Tickets',
    url: 'https://company.zendesk.com/api/v2/search.json?query=type:ticket+group:emea',
    enabled: false,
    createdAt: 2000
};

function buildExportJson(overrides = {}) {
    return JSON.stringify({
        $schema: SCHEMA_ID,
        version: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        source: { extension: 'Zendesk Ticket Monitor', version: '3.2.3' },
        endpoints: [{ name: VALID_ENDPOINT.name, url: VALID_ENDPOINT.url, enabled: VALID_ENDPOINT.enabled }],
        ...overrides
    });
}

// ─── exportEndpoints ──────────────────────────────────────────────────────────

describe('exportEndpoints', () => {
    test('returns a valid JSON string', () => {
        const json = exportEndpoints([VALID_ENDPOINT], '3.2.3');
        expect(() => JSON.parse(json)).not.toThrow();
    });

    test('includes required top-level fields', () => {
        const data = JSON.parse(exportEndpoints([VALID_ENDPOINT], '3.2.3'));
        expect(data.$schema).toBe(SCHEMA_ID);
        expect(data.version).toBe(SCHEMA_VERSION);
        expect(data.exportedAt).toBeDefined();
        expect(data.source.extension).toBe('Zendesk Ticket Monitor');
        expect(data.source.version).toBe('3.2.3');
        expect(Array.isArray(data.endpoints)).toBe(true);
    });

    test('exports only name, url, enabled — not id or createdAt', () => {
        const data = JSON.parse(exportEndpoints([VALID_ENDPOINT], '3.2.3'));
        const ep = data.endpoints[0];
        expect(ep.name).toBe(VALID_ENDPOINT.name);
        expect(ep.url).toBe(VALID_ENDPOINT.url);
        expect(ep.enabled).toBe(VALID_ENDPOINT.enabled);
        expect(ep.id).toBeUndefined();
        expect(ep.createdAt).toBeUndefined();
    });

    test('handles multiple endpoints', () => {
        const data = JSON.parse(exportEndpoints([VALID_ENDPOINT, VALID_ENDPOINT_2], '3.2.3'));
        expect(data.endpoints).toHaveLength(2);
        expect(data.endpoints[1].enabled).toBe(false); // preserves disabled state
    });

    test('handles empty endpoints array', () => {
        const data = JSON.parse(exportEndpoints([], '3.2.3'));
        expect(data.endpoints).toHaveLength(0);
    });

    test('handles null/undefined endpoints gracefully', () => {
        const data = JSON.parse(exportEndpoints(null, '3.2.3'));
        expect(data.endpoints).toHaveLength(0);
    });

    test('coerces enabled field to boolean', () => {
        const ep = { ...VALID_ENDPOINT, enabled: 1 };
        const data = JSON.parse(exportEndpoints([ep], '3.2.3'));
        expect(typeof data.endpoints[0].enabled).toBe('boolean');
    });
});

// ─── parseImportFile ──────────────────────────────────────────────────────────

describe('parseImportFile', () => {
    test('accepts a valid export JSON string', () => {
        const result = parseImportFile(buildExportJson());
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

    test('rejects wrong schema version', () => {
        const result = parseImportFile(buildExportJson({ version: 99 }));
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Unsupported file format/);
    });

    test('rejects missing version field', () => {
        const json = JSON.stringify({
            $schema: SCHEMA_ID,
            endpoints: [{ name: 'Test', url: 'https://x.zendesk.com/api/v2/search.json?query=q', enabled: true }]
        });
        const result = parseImportFile(json);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Unsupported file format/);
    });

    test('rejects missing endpoints field', () => {
        const json = JSON.stringify({ $schema: SCHEMA_ID, version: SCHEMA_VERSION });
        const result = parseImportFile(json);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Invalid file format/);
    });

    test('rejects endpoints that is not an array', () => {
        const result = parseImportFile(buildExportJson({ endpoints: {} }));
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Invalid file format/);
    });

    test('rejects empty endpoints array', () => {
        const result = parseImportFile(buildExportJson({ endpoints: [] }));
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/No endpoints found/);
    });

    test('ignores extra/unknown top-level fields', () => {
        const result = parseImportFile(buildExportJson({ unknownField: 'ignored' }));
        expect(result.success).toBe(true);
    });
});

// ─── validateImportedEndpoints ────────────────────────────────────────────────

describe('validateImportedEndpoints', () => {
    const existing = [VALID_ENDPOINT];

    test('accepts valid endpoints', () => {
        const raw = [{ name: 'New Queue', url: 'https://company.zendesk.com/api/v2/search.json?query=type:ticket', enabled: true }];
        const { valid, skipped } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(1);
        expect(skipped).toHaveLength(0);
    });

    test('skips entries with invalid URL (non-Zendesk domain)', () => {
        const raw = [{ name: 'Bad URL', url: 'https://example.com/api/v2/search.json?query=type:ticket', enabled: true }];
        const { valid, skipped } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(0);
        expect(skipped).toHaveLength(1);
        expect(skipped[0]).toContain('Bad URL');
    });

    test('skips entries with missing API path', () => {
        const raw = [{ name: 'No API', url: 'https://company.zendesk.com/agent/view', enabled: true }];
        const { valid, skipped } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(0);
        expect(skipped).toHaveLength(1);
    });

    test('skips entries with name > 50 characters', () => {
        const raw = [{ name: 'n'.repeat(51), url: 'https://x.zendesk.com/api/v2/search.json?query=q', enabled: true }];
        const { valid, skipped } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(0);
        expect(skipped).toHaveLength(1);
    });

    test('skips entries with missing name', () => {
        const raw = [{ name: '', url: 'https://x.zendesk.com/api/v2/search.json?query=q', enabled: true }];
        const { valid, skipped } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(0);
        expect(skipped).toHaveLength(1);
    });

    test('skips entries that duplicate existing endpoint URL', () => {
        const raw = [{ name: 'Dup URL', url: VALID_ENDPOINT.url, enabled: true }];
        const { valid, skipped } = validateImportedEndpoints(raw, existing);
        expect(valid).toHaveLength(0);
        expect(skipped).toHaveLength(1);
        expect(skipped[0]).toMatch(/already exists/);
    });

    test('skips entries that duplicate existing endpoint name', () => {
        const raw = [{ name: VALID_ENDPOINT.name, url: 'https://x.zendesk.com/api/v2/search.json?query=q', enabled: true }];
        const { valid, skipped } = validateImportedEndpoints(raw, existing);
        expect(valid).toHaveLength(0);
        expect(skipped).toHaveLength(1);
    });

    test('skips duplicates within the import batch itself', () => {
        const ep1 = { name: 'Same', url: 'https://x.zendesk.com/api/v2/search.json?query=q', enabled: true };
        const ep2 = { name: 'Same Copy', url: 'https://x.zendesk.com/api/v2/search.json?query=q', enabled: true }; // same URL
        const { valid, skipped } = validateImportedEndpoints([ep1, ep2], []);
        expect(valid).toHaveLength(1);
        expect(skipped).toHaveLength(1);
    });

    test('accepts partial batch — valid pass, invalid skip', () => {
        const raw = [
            { name: 'Valid', url: 'https://company.zendesk.com/api/v2/search.json?query=type:ticket', enabled: true },
            { name: '', url: 'bad-url', enabled: true }
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
        const raw = [{ name: 'No Enabled', url: 'https://x.zendesk.com/api/v2/search.json?query=q' }];
        const { valid } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(1);
        expect(valid[0].enabled).toBe(true);
    });

    test('ignores extra fields on endpoint objects', () => {
        const raw = [{ name: 'With Extra', url: 'https://x.zendesk.com/api/v2/search.json?query=q', enabled: false, id: 999, createdAt: 0, unknown: true }];
        const { valid } = validateImportedEndpoints(raw, []);
        expect(valid).toHaveLength(1);
        expect(valid[0].id).toBeUndefined();
        expect(valid[0].unknown).toBeUndefined();
    });
});

// ─── prepareEndpointsForImport ────────────────────────────────────────────────

describe('prepareEndpointsForImport', () => {
    test('assigns id and createdAt to each endpoint', () => {
        const input = [{ name: 'A', url: 'url1', enabled: true }];
        const result = prepareEndpointsForImport(input);
        expect(typeof result[0].id).toBe('number');
        expect(typeof result[0].createdAt).toBe('number');
    });

    test('each endpoint in a batch gets a unique id', () => {
        const input = [
            { name: 'A', url: 'url1', enabled: true },
            { name: 'B', url: 'url2', enabled: false }
        ];
        const result = prepareEndpointsForImport(input);
        expect(result[0].id).not.toBe(result[1].id);
    });

    test('preserves name, url, and enabled from input', () => {
        const input = [{ name: 'My Queue', url: 'https://x.zendesk.com/api', enabled: false }];
        const result = prepareEndpointsForImport(input);
        expect(result[0].name).toBe('My Queue');
        expect(result[0].url).toBe('https://x.zendesk.com/api');
        expect(result[0].enabled).toBe(false);
    });

    test('returns empty array for empty input', () => {
        expect(prepareEndpointsForImport([])).toEqual([]);
    });
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe('module constants', () => {
    test('SCHEMA_VERSION is a positive integer', () => {
        expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
        expect(SCHEMA_VERSION).toBeGreaterThan(0);
    });

    test('SCHEMA_ID is a non-empty string', () => {
        expect(typeof SCHEMA_ID).toBe('string');
        expect(SCHEMA_ID.length).toBeGreaterThan(0);
    });

    test('MAX_IMPORT_SIZE_BYTES is 1MB', () => {
        expect(MAX_IMPORT_SIZE_BYTES).toBe(1024 * 1024);
    });
});
