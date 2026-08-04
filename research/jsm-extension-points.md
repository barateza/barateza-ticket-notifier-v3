# Codebase extension points for a second provider

Scope: adding **Jira Cloud** as a second provider to this MV3 extension (currently Zendesk-only).
This file maps every place Zendesk is hardcoded, proposes a provider abstraction sized for
two providers, and orders a minimal refactor. All citations are `file:line` relative to the
repo root (`D:\github\barateza-ticket-notifier-v3`, v3.6.0).

---

## 1. Zendesk-specific touch points

### 1.1 Manifest / permissions
| Location | What is hardcoded |
|---|---|
| `manifest.json:3` | `name: "Zendesk Ticket Monitor"` |
| `manifest.json:5` | `description: "Monitor Zendesk ticket endpoints..."` |
| `manifest.json:13-17` | `host_permissions` — `*://*.zendesk.com/*` is the only ticket-provider host (others: `api.github.com` for update checks, `myinstants.com` for custom sounds) |
| `manifest.json:24` | `action.default_title: "Zendesk Ticket Monitor"` |
| `manifest.json:6-12` | `permissions` — `cookies` is provider-scoped via host permissions; a Jira host pattern must be added for `chrome.cookies.getAll` to see `*.atlassian.net` cookies |

Jira Cloud needs: `*://*.atlassian.net/*` added to `host_permissions` (cookie access + fetch).

### 1.2 background.js (entry point)
| Location | What is hardcoded |
|---|---|
| `background.js:33-40` | Default seeded endpoint: `https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+assignee:me+status:open` (line 37) — no `provider` field on the endpoint model |
| `background.js:47-56` | Default `settings` object — no provider-related setting |
| `background.js:247` | Offscreen justification string "Play notification sounds for new Zendesk tickets" |
| `background.js:272` | Startup log "Zendesk Ticket Monitor background script loaded" |

### 1.3 utils/cookie-service.js — cookie domain filter
| Location | What is hardcoded |
|---|---|
| `cookie-service.js:33` | `fetchZendeskCookies(domain)` — function name itself is Zendesk-named |
| `cookie-service.js:36-42` | Auth-cookie **name filter**: `session`, `auth`, `_zendesk`, `csrf`, `_help_center_session` — Zendesk-specific; Jira Cloud uses different names (e.g. `cloud.session.token`) |
| `cookie-service.js:65-66` | JSDoc examples `cpanel.zendesk.com` |
| `cookie-service.js:68-101` | Cache (`domainCache`, `inFlightCache`, `cacheTimestamps`) is provider-agnostic and reusable — only the filter inside `fetchZendeskCookies` is provider-specific |

### 1.4 utils/poller.js — fetch / count parsing
| Location | What is hardcoded |
|---|---|
| `poller.js:43` | Log "active Zendesk rate limiting" |
| `poller.js:78-85` | Domain extraction + `cookieService.getCookies(domain)` then error "No **Zendesk** auth cookies for ... Please log in to ..." (line 83) |
| `poller.js:87-96` | `fetch` with `Cookie` header + `credentials: 'include'` — generic, reusable |
| `poller.js:99-102` | 429 handling with `Retry-After` — generic HTTP behaviour; log string "Rate limited by **Zendesk**" (line 102) |
| `poller.js:121` | **`const newCount = data.count || 0;` — response-parsing hardcode.** Zendesk Search API returns `{count, results}`; Jira Cloud JQL search (`/rest/api/3/search/jql`) returns `{total, issues, ...}` |
| `poller.js:123-146` | Count compare / notify / persist — provider-agnostic once `newCount` is obtained |

### 1.5 utils/notification-manager.js — click mapping + copy
| Location | What is hardcoded |
|---|---|
| `notification-manager.js:97` | Offscreen justification "new Zendesk tickets" |
| `notification-manager.js:130-149` | Click handler: opens mapped `endpointUrl`; **fallback `https://cpanel.zendesk.com/agent/dashboard` (line 144)** when mapping missing — Jira fallback is a different host (`https://<site>.atlassian.net/jira/your-work`) |
| `notification-manager.js:188` | Notification title "New **Zendesk** Tickets: ..." |
| `notification-manager.js:189` | Message "`new ticket(s)\nTotal: ... tickets`" — wording is Zendesk-ish but acceptable generically |

### 1.6 utils/monitor.js — badge assumptions
| Location | What is hardcoded |
|---|---|
| `monitor.js:22` | Log "Starting **Zendesk** monitoring" |
| `monitor.js:46` | Log "active Zendesk rate limiting" |
| `monitor.js:58-72` | `updateBadge()` sums **all** endpoint counts into one badge — no per-provider assumption, works across providers as-is; the only "assumption" is a single global count (no per-provider badge), which is fine for two providers |

### 1.7 utils/rate-limit-service.js
| Location | What is hardcoded |
|---|---|
| `rate-limit-service.js:67` | Log "Zendesk rate limit active..." |
| `rate-limit-service.js:87` | Log "active Zendesk rate limiting" |
| `rate-limit-service.js:27-38` | `parseRetryAfterMs` — generic HTTP header parsing, reusable for Jira (Jira Cloud also sends `Retry-After`) |

### 1.8 utils/validators.js — URL validation
| Location | What is hardcoded |
|---|---|
| `validators.js:18-30` | **Zendesk subdomain check**: `hostnameParts[length-2] === 'zendesk' && [length-1] === 'com'`; error string "URL must be a Zendesk domain (*.zendesk.com)" (line 28) — rejects `*.atlassian.net` outright |
| `validators.js:33-39` | Path check `pathname.includes('/api/v2/search')` — Zendesk Search API path only; Jira uses `/rest/api/3/search/jql` |
| `validators.js:42-47` | `searchParams.has('query')` — Zendesk uses `query=`; Jira JQL uses `jql=` |
| `validators.js:112-134` | `validateEndpoint(endpoint, existing)` — no provider field passed through |

### 1.9 utils/endpoint-schema.js — schema identity
| Location | What is hardcoded |
|---|---|
| `endpoint-schema.js:6` | `SCHEMA_ID = 'zendesk-ticket-monitor/endpoints/v1'` |
| `endpoint-schema.js:7` | `SCHEMA_VERSION = 1` |
| `endpoint-schema.js:8` | `MAX_IMPORT_SIZE_BYTES` — provider-agnostic |

### 1.10 utils/endpoint-export.js / endpoint-import.js — serialisation
| Location | What is hardcoded |
|---|---|
| `endpoint-export.js:28-33` | Serialises only `{name, url, enabled}` — **no `provider` field**; `source.extension: 'Zendesk Ticket Monitor'` (line 35) |
| `endpoint-export.js:38-42` | Per-endpoint mapping drops any future fields |
| `endpoint-import.js:71-73` | Extracts only `name`, `url`, `enabled` from raw entries |
| `endpoint-import.js:81-85` | Validates URL via Zendesk-only `validateEndpointUrl` |
| `endpoint-import.js:94` | Rebuilds `{name, url, enabled}` — provider lost on round-trip |
| `endpoint-import.js:109-118` | `prepareEndpointsForImport` — assigns `id`/`createdAt` only |
| `endpoint-io.js:13` | Duplicated `SCHEMA_ID = 'zendesk-ticket-monitor/endpoints/v1'` (dead duplicate of endpoint-schema.js) |

### 1.11 popup — form placeholders, validation, hints
| Location | What is hardcoded |
|---|---|
| `popup.html:7` | `<title>Zendesk Ticket Monitor</title>` |
| `popup.html:15` | Header "Zendesk Monitor" |
| `popup.html:192` | Label "**Zendesk API URL:**" |
| `popup.html:193-195` | Textarea `placeholder="https://your-domain.zendesk.com/api/v2/search.json?query=..."` — no provider selector in the Add Endpoint modal |
| `popup.js:1` | Header comment |
| `popup-endpoints.js:194` | `validateEndpoint({name, url}, endpoints)` — Zendesk-only validation |
| `popup-endpoints.js:244-284` | `testEndpoint(url)`: calls Zendesk `cookieService.getCookies`, fetches, requires **`data.count`** (lines 268-270, error "Invalid API response format") and success message "Found N tickets" (line 275) |
| `popup-endpoints.js:301` | Export filename `` `zendesk-endpoints-${today}.json` `` |
| `popup-endpoints.js:34-44` | `saveEndpoints` — generic storage write, reusable |

### 1.12 utils/* provider-agnostic (no change needed)
`storage-service.js`, `message-router.js`, `snooze-service.js`, `logger.js` (only header comment `logger.js:2`),
`offscreen.js`, `popup-utils.js`, `popup-settings.js`, `popup-snooze.js` — no Zendesk coupling.
`popup-updates.js` talks to GitHub releases only (separate concern, `popup-updates.js:35`).

### 1.13 Scripts & docs
| Location | What is hardcoded |
|---|---|
| `scripts/setup-e2e-auth.mjs:24` | `ZENDESK_LOGIN_URL = 'https://YOUR_SUBDOMAIN.zendesk.com/auth/v2/login'` |
| `package.json:4` | description "Zendesk ticket monitor..." |
| `package.json:18` | keyword `"zendesk"` |
| `REASONIX.md:109` | "`cookies` permission scoped to `*://*.zendesk.com/*`" |
| `REASONIX.md:125-127` | Endpoint validation rules (Zendesk API search endpoints, `count` property) |
| `REASONIX.md:129-168` | Entire "Zendesk API Search Syntax" section (query examples, default URL `cpanel.zendesk.com` line 165) |
| `README.md:1,3,25,34-35,57,69,74,76` | Title/description, login steps, "Cookie Authentication - Uses your existing Zendesk login", "Multiple Endpoints - Monitor multiple Zendesk search queries" |
| `README.md:78-94` | "Adding Zendesk Endpoints" + 4 example `*.zendesk.com` URLs |
| `README.md:123-128,134,144,158,165-168,181` | Cookie auth explanation, click action "open your Zendesk dashboard", troubleshooting |
| `README.md:185-188` | "Zendesk Search API Format" |
| `README.md:231,237,259` | Privacy blurb, project tree, `cookie-service.js # Zendesk cookie retrieval` |
| `install-guide.html:6,80,138,143-150` | Title, heading, "Log in to Zendesk" step, `your-domain.zendesk.com` example |
| `PRIVACY_POLICY.md:11-12,15,18,22-23,34,38` | "Zendesk Ticket Data", host permission `*://*.zendesk.com/*`, Zendesk API/`search.json` wording |

### 1.14 Test fixtures (pipeline mocking)
| Location | What is hardcoded |
|---|---|
| `__tests__/cookie-service.test.js:17,24,51,69,81` | Cookie fixtures: `_zendesk_shared_api_token`, `_help_center_session`; domain `cpanel.zendesk.com` throughout (lines 22,27,36,44,54-55,66-67,84,86) |
| `__tests__/background-unit.test.js:32` | Endpoint fixture `https://cpanel.zendesk.com/api/v2/search.json?...` |
| `__tests__/background-unit.test.js:88-92` | **fetch mock returns `{ count: 5 }`** — the `count` shape is the contract the poller asserts |
| `__tests__/background-unit.test.js:157,175,181,197,283` | More `*.zendesk.com` search-URL fixtures |
| `__tests__/background-unit.test.js:233-245` | 429 + `Retry-After: '60'` mock (generic, but asserts Zendesk rate-limit flow) |
| `__tests__/background.test.js:16,76,227` | Zendesk URL fixtures + `validUrl` |
| `__tests__/integration.test.js:17,23` | Zendesk endpoint fixtures; `:75-77` cookie mock `'__Host-ps'`; `:232` `expect.stringContaining('zendesk.com')` in click test |
| `__tests__/notification-manager.test.js:12` | `endpointUrl` fixture `cpanel.zendesk.com/...` |
| `__tests__/endpoint-io.test.js:11,19,29,116,154,169,176,183,198,205-206,214,230,237,265,268` | Export/import fixtures; `source.extension 'Zendesk Ticket Monitor'` (line 29); non-Zendesk URL rejected (line 161) |
| `__tests__/popup.test.js:17,83,141` | Zendesk URL fixtures; `:67-68` validation cases; `:263-267` re-implements the Zendesk hostname check in the test; `:275` |
| `__tests__/popup-unit.test.js:6` | Zendesk fixture |
| `__tests__/e2e/background.spec.mjs:42` | Route mock `**/*.zendesk.com/api/v2/search.json*` → `{ count: 3, results: [] }` (line 46) |
| `__tests__/e2e/popup.spec.mjs:16` | `https://playwright.zendesk.com/api/v2/search.json?query=type:ticket`; `:52` title regex `/zendesk|ticket|monitor/i` |
| `__tests__/e2e/fixtures.mjs:5,24` | Comments about a persisted "Zendesk session" (`.playwright-auth-data`) |
| `jest.setup.js:4-63` | Chrome API mock — provider-agnostic, no change |

---

## 2. Recommended provider abstraction

**Registry + adapter, not a switch.** The existing `MessageRouter` (`utils/message-router.js:13-50`) already
demonstrates the registry pattern this codebase likes; mirror it. Sized for two providers, a static
Map registry is enough (no async discovery).

### New modules
| Module | Responsibility |
|---|---|
| `utils/providers/provider-registry.js` | `register(provider)`, `getProvider(id)`, `getAll()`, `getDefault()` (returns Zendesk for backward compatibility). Throws/logs on unknown id. |
| `utils/providers/zendesk-provider.js` | Moves all current Zendesk behaviour into one adapter (see interface below). |
| `utils/providers/jira-provider.js` | New adapter: JQL search URL validation, `total` parsing, `*.atlassian.net` cookie filter, Jira fallback dashboard URL. |

### Provider adapter interface (implemented by both)
```js
{
  id: 'zendesk' | 'jira',
  label: 'Zendesk' | 'Jira Cloud',
  domainPattern: '*.zendesk.com' | '*.atlassian.net',      // docs + validation hint
  validateUrl(url) -> { valid, error },                    // from validators.js:8-53 logic
  extractDomain(url) -> hostname,                          // already generic via new URL()
  isAuthCookie(cookie) -> boolean,                         // from cookie-service.js:36-42 filter
  parseCount(responseJson) -> number,                      // Zendesk: data.count; Jira: data.total
  fallbackDashboardUrl(domain) -> string,                  // Zendesk: agent/dashboard; Jira: /jira/your-work
  placeholderUrl: string,                                  // popup form placeholder
  defaultEndpointUrl: string,                              // background.js:37 seed
  labelNoun: 'ticket' | 'issue'                            // notification/UI copy
}
```
Core pipeline stays generic: `poller.js` calls `provider.parseCount(data)` instead of `data.count`;
`notification-manager.js` calls `provider.fallbackDashboardUrl(domain)` instead of the
`cpanel.zendesk.com/agent/dashboard` literal; `cookie-service.js` calls `provider.isAuthCookie(cookie)`.

### How each existing module changes
| Module | Change |
|---|---|
| `endpoint-schema.js` | Add `PROVIDER_IDS = ['zendesk', 'jira']`; bump `SCHEMA_VERSION` to 2; endpoint shape gains `provider: 'zendesk' \| 'jira'`. |
| `background.js` | Seed endpoint gains `provider: 'zendesk'` (line 37); on-install migration: endpoints missing `provider` get `'zendesk'` (extend the `onInstalled` migration block, lines 29-44). |
| `validators.js` | `validateEndpointUrl(url, providerId = 'zendesk')` delegates to `getProvider(providerId).validateUrl(url)`; keep the current signature as a Zendesk-defaulting wrapper so popup/import call sites don't all change at once. |
| `cookie-service.js` | `getCookies(domain, providerId)` — pass the adapter's `isAuthCookie` into the fetch (rename `fetchZendeskCookies` → `fetchProviderCookies`); cache keyed by domain stays valid (domains are provider-disjoint). |
| `poller.js` | `checkEndpoint`: resolve provider from `endpoint.provider`; replace line 121 with `provider.parseCount(data)`; genericise error strings (lines 83, 102). 429/Retry-After handling stays generic (Jira Cloud also uses `Retry-After`). |
| `notification-manager.js` | `notify()` and click handler carry `provider` (or derive from stored endpoint); title → "New tickets/New issues" via `labelNoun`; fallback URL via `fallbackDashboardUrl(new URL(endpointUrl).hostname)` (line 144). |
| `endpoint-export.js` / `endpoint-import.js` | Serialise `provider` (default `'zendesk'` when absent on import for v1 files); bump schema version; `source.extension` generic ("Ticket Monitor"). |
| `popup.html` / `popup-endpoints.js` | Add provider `<select>` in Add Endpoint modal; swap label/placeholder per provider (lines 192-195); `validateEndpoint` and `testEndpoint` pass provider; `testEndpoint` checks `provider.parseCount`; export filename `endpoints-${today}.json` (line 301). |
| `manifest.json` | Add `*://*.atlassian.net/*` to `host_permissions` (line 13-17). |
| `monitor.js`, `rate-limit-service.js` | No functional change; genericise log strings. Badge sum (monitor.js:58-72) works across providers unchanged. |
| `utils/endpoint-io.js` | Delete the duplicated constants (line 13) — already imported from `endpoint-schema.js` in export/import. |
| Docs | REASONIX.md, README.md, install-guide.html, PRIVACY_POLICY.md, package.json description/keywords — add Jira sections / genericise. |

### Notes / decisions to make during implementation
- **Jira response shape**: JQL search `/rest/api/3/search/jql?jql=...` returns `{startAt, maxResults, total, issues}` → `parseCount` reads `data.total`. Jira may also require `Accept: application/json` only (no `Content-Type` on GET is fine) and newer instances want `X-ExperimentalApi: opt-in` only for experimental fields — not needed for counts.
- **Jira cookie names**: `cloud.session.token`, plus `atlassian.cookies`-family names; the adapter's `isAuthCookie` is where the exact list lives.
- **Cookie permission**: `"cookies"` in MV3 only exposes cookies for hosts granted in `host_permissions`, so the manifest change is the actual permission gate.
- **Counts keyed by `endpoint.id`** (`poller.js:124`, `monitor.js:60`) — ids are `Date.now()`-based (popup-endpoints.js:201, endpoint-import.js:109-118); with two providers, two popups saving in the same ms is the only (unlikely) collision; optionally namespace ids by provider.
- **Badge**: single global sum is acceptable; do not split per provider unless product asks.

---

## 3. Minimal refactor surface (rough ordering)

1. **Data model**: add `provider` field (default `'zendesk'`) — `endpoint-schema.js`, `background.js:29-44` migration, `popup-endpoints.js:200-206` (new endpoint), `endpoint-import.js:71-94,109-118` (round-trip), `endpoint-export.js:28-42`.
2. **Registry + Zendesk adapter extraction** (no behaviour change): new `utils/providers/provider-registry.js` + `utils/providers/zendesk-provider.js`; move URL validation (`validators.js:8-53`), cookie filter (`cookie-service.js:33-50`), count parsing (`poller.js:121`), fallback URL (`notification-manager.js:144`) into the adapter; wire the registry in with `getProvider('zendesk')` defaults.
3. **Rewire consumers**: `validators.js` (delegate), `cookie-service.js` (isAuthCookie), `poller.js` (parseCount + generic errors), `notification-manager.js` (fallback + copy), `monitor.js`/`rate-limit-service.js` (log strings only).
4. **Import/export**: schema v2 with `provider`, backward-compatible v1 import (default `zendesk`), delete duplicate constants in `endpoint-io.js:13`.
5. **Popup UX**: provider selector + dynamic placeholder/label (`popup.html:192-195`), `testEndpoint` via provider (`popup-endpoints.js:244-284`), export filename (`popup-endpoints.js:301`).
6. **Manifest + docs**: `manifest.json:13-17` add atlassian host; REASONIX.md, README.md, install-guide.html, PRIVACY_POLICY.md, package.json:4,18.
7. **Test fixtures**: add `provider` to endpoint fixtures (`background-unit.test.js:32`, `integration.test.js:17,23`, `popup.test.js:17`, `notification-manager.test.js:12`, `endpoint-io.test.js:11,19`, `popup-unit.test.js:6`, e2e `popup.spec.mjs:16`); parameterise the `count` fixture shape (`background-unit.test.js:88-92`, e2e `background.spec.mjs:42-47`); keep cookie fixtures (`cookie-service.test.js`) but add a provider param; add registry + adapter unit tests; add Jira fixture set (`*.atlassian.net`, `{total, issues}`).
8. **Jira adapter** (last, additive): `utils/providers/jira-provider.js` — JQL URL validation, `total` parse, atlassian cookie filter, `/jira/your-work` fallback, placeholder; e2e route pattern for `*.atlassian.net/rest/api/3/search/jql*`.
