// ─── Endpoint Schema Constants ────────────────────────────────────────────────
//
// Shared versioning and config constants for monitor import/export.
// v1: `endpoints` key, no provider field (Zendesk only).
// v2: `monitors` key, per-monitor `provider` field.
// Imported by both endpoint-export.js and endpoint-import.js.

export const SCHEMA_ID = 'zendesk-ticket-monitor/monitors/v2';
export const SCHEMA_VERSION = 2;
export const LEGACY_SCHEMA_VERSION = 1;
export const MAX_IMPORT_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB
