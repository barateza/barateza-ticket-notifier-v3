# JSM Ticket Monitoring — Implementation Spec

Status: **decision-locked** — every decision below was resolved through the
[wayfinder map](https://github.com/barateza/barateza-ticket-notifier-v3/issues/36)
("Map: JSM ticket monitoring support"). This document is the destination of
that map: it is the input for a separate implementation effort. Nothing here is
"to be decided" — unresolved implementation-era items are listed in
[Deferred items](#deferred-items) and are open questions, not design gaps.

## 1. Overview

Add Jira Service Management (JSM) Cloud ticket monitoring to the existing
Zendesk Ticket Monitor Chrome extension, alongside the current Zendesk
monitoring. The product shape is unchanged: the extension polls the count of
tickets matching a query and notifies when the count increases.

| Dimension | Decision | Source |
|---|---|---|
| Scope | Count-based JQL monitoring (same pipeline shape as Zendesk) | Charting |
| Deployment | JSM Cloud only (`*.atlassian.net`) | Charting |
| Auth | Atlassian API token, `Authorization: Basic base64(email:token)` | [Jira Cloud cookie auth feasibility](https://github.com/barateza/barateza-ticket-notifier-v3/issues/37) |
| Count API | `GET /rest/api/3/search/approximate-count` → `.count`; fallback `search/jql?maxResults=0` → `.total` | [Jira Cloud count endpoint and rate limits](https://github.com/barateza/barateza-ticket-notifier-v3/issues/38) |
| Data model | One `monitors` list, each `{id, name, url, enabled, provider}` | [Jira endpoint schema and URL format](https://github.com/barateza/barateza-ticket-notifier-v3/issues/41) |
| Provider id | `jira` (UI label "Jira"; "JSM" is the marketing tier name) | [Canonical language for multi-provider monitoring](https://github.com/barateza/barateza-ticket-notifier-v3/issues/40) |
| Sites | Multiple Jira sites supported; credentials per site | Charting + [Auth and permissions design for Jira](https://github.com/barateza/barateza-ticket-notifier-v3/issues/43) |

Out of scope (per the map): JSM queue picker UI, per-ticket notifications,
SLAs/approvals/satisfaction, JSM Server/Data Center.

## 2. Vocabulary

Use the glossary in [`CONTEXT.md`](../../CONTEXT.md): **ticket** (umbrella
noun), **monitor** (the configured unit — "endpoint" is retired), **provider**
(`zendesk` \| `jira`), **site** (a provider instance; credentials per site),
**query** (Zendesk search query or Jira JQL embedded in the monitor URL),
**Jira/JSM** (provider id is `jira`).

## 3. Data model

### 3.1 `chrome.storage.local`

- `monitors` (renamed from `endpoints`) — array of
  `{ id: number, name: string, url: string, enabled: boolean, provider: 'zendesk' | 'jira' }`.
- `jiraCredentials` (new) — `{ [siteHostname: string]: { email: string, token: string } }`.
- `settings` — unchanged shape.

### 3.2 Migration (on read)

- `endpoints` → `monitors`: read the old key if the new one is absent, migrate
  with `provider: 'zendesk'` added to every entry, write back.
- Every monitor read is sanitised: `provider` coerced to `'zendesk' | 'jira'`,
  defaulting to `'zendesk'` when missing/invalid.

## 4. Provider abstraction

New module tree (mirrors the existing `MessageRouter` registry pattern):

```
utils/providers/
├── provider-registry.js   # register(name, adapter) + get(name)
├── zendesk-provider.js
└── jira-provider.js
```

Adapter interface (from [Codebase extension points for a second provider](https://github.com/barateza/barateza-ticket-notifier-v3/issues/39)):

| Method | Purpose |
|---|---|
| `id` | `'zendesk'` \| `'jira'` |
| `label` | UI label ("Zendesk", "Jira") |
| `validateUrl(url)` | Provider-specific validation → `{valid, error}` |
| `normaliseUrl(url)` | Canonical stored form (Jira: `https://<site>/issues/?jql=<encoded>`) |
| `buildApiUrl(storedUrl)` | Derive the polling URL (Jira: `…/rest/api/3/search/approximate-count?jql=<encoded>&includeArchived=false`) |
| `parseCount(json)` | Read the count (zendesk: `.count`; jira: `.count`, fallback `.total`) |
| `buildFetchOptions(monitor, credentials)` | Headers (jira: `Authorization: Basic …`; zendesk: none — cookies flow separately) |
| `isAuthCookie(name)` | Zendesk cookie filter (moved from `cookie-service.js`) |
| `fallbackDashboardUrl()` | Click fallback (zendesk: `…/agent/dashboard`; jira: `…/issues/`) |
| `placeholderUrl`, `defaultEndpointUrl` | Popup hints / default |
| `detectFromUrl(url)` | Host-based detection: `*.zendesk.com` → `zendesk`, `*.atlassian.net` → `jira`, else `null` (new — feeds the inference UI) |

Consumers rewired: `validators.js` (delegates per provider), `poller.js`
(parseCount + fetch options), `notification-manager.js` (click target +
fallback), `cookie-service.js` (isAuthCookie), popup (placeholders, hints,
detection, Test Connection parse).

## 5. URL contract

| | Zendesk (unchanged) | Jira |
|---|---|---|
| User pastes | `https://<sub>.zendesk.com/api/v2/search.json?query=…` | Any `*.atlassian.net` URL carrying a `jql` param (search bar, saved filter, board/queue URLs) |
| Stored (`url`) | as pasted | Normalised: `https://<site>.atlassian.net/issues/?jql=<url-encoded>` |
| Polled | as pasted | Derived: `https://<site>.atlassian.net/rest/api/3/search/approximate-count?jql=<encoded>&includeArchived=false` |
| Validation | `*.zendesk.com` + `/api/v2/search` + `query` | `*.atlassian.net` + `jql` param; errors: "URL must be an Atlassian site (*.atlassian.net)" / "URL must include a JQL query (?jql=…)" |

Jira count parsing: read `.count` from `approximate-count`
(`{count, exact}` — verify both field names once at runtime); on 400/410,
fall back to `…/search/jql?jql=<encoded>&maxResults=0` → `.total`. Cache the
chosen path per site so the fallback is not re-probed every cycle.

## 6. Auth

- Per-site credentials: `jiraCredentials[siteHostname] = {email, token}`.
- Entry UX: a "Jira credentials" section in the popup settings; sites
  auto-listed from monitor hostnames; per-site status line:
  configured / missing / rejected. The add-monitor flow has no credential step.
- Storage: `chrome.storage.local` (extension storage is unencrypted —
  documented). PRIVACY_POLICY + Web Store listing wording: tokens stored
  locally on the user's machine, never transmitted to us, sent only to the
  user's own Jira site.
- Wiring: the adapter's `buildFetchOptions` attaches
  `Authorization: Basic base64(email:token)` for `jira` provider API calls
  only. Zendesk keeps the cookie path.
- 401 handling: site-level **rejected** state; the popup shows an auth-failed
  line under that site's monitors; notifications are skipped for that site
  until a poll succeeds again (self-heals); Test Connection re-checks.

## 7. Polling, rate limits, errors

- Cadence unchanged: one poll cycle at the shared alarm cadence iterates all
  monitors (per-provider pacing unnecessary — see rate limits below).
- Rate limits: per-provider backoff state inside the existing rate-limit
  service (keyed per provider/site host). A Jira 429 pauses Jira polling only.
  Parse `Retry-After` per provider; log Jira's `RateLimit-Reason` in debug
  mode. Jira Cloud limits: 100 req/s burst per endpoint; 65,000 pts/hour
  (API-token traffic exempt from points enforcement as of March 2026);
  1–15 min polling is orders of magnitude within limits.
- Error surfacing: inline per-monitor error line under the monitor's URL —
  "auth rejected — check Jira credentials", "missing credentials",
  "rate limited — retrying in Xm", "network error — will retry". No
  notifications for any error; details in debug logs.
- Counts/badge: badge sums last-known counts across all monitors; on error the
  last-known count is kept (never zeroed); the comparison baseline updates
  only on successful polls — a transient outage cannot cause a false
  "+N tickets" notification on recovery.

## 8. Popup UI (provider selection)

Variant C, **inference-first** (prototype on throwaway branch
`prototype/provider-select`, not merged):

- The add-monitor modal has **no provider selector**. As the user types the
  URL, the provider is detected from the host (`*.zendesk.com` → Zendesk,
  `*.atlassian.net` → Jira) and shown as a live chip ("Detected: Jira") next
  to the field.
- Undetectable URLs fail validation ("Could not detect a provider. Use a
  *.zendesk.com or *.atlassian.net search URL.") and Save is blocked.
  Once detected, the provider's own validation applies with per-provider
  error copy. The URL field shows a dual placeholder (both URL shapes) and a
  helper line explaining detection.
- The monitors list is **grouped per provider** with totals
  ("2 monitors · 4 tickets"); empty groups hidden; no per-row provider badges.
- Test Connection parses per provider via `adapter.parseCount`.

## 9. Notifications

- Jira notifications are **count-only** (the count API returns no issue keys):
  legacy count format (`+N ticket(s) | Total: M`), title with the provider
  label, no ticket list.
- Clicking a Jira notification opens the **stored UI search URL** (the
  monitor's pasted URL — the live queue in Jira). Zendesk click behavior
  unchanged (per ADR-0003: newest ticket's page; fallback = search URL).
- Sound: unchanged single sound path (beep/custom MP3) — see
  [Deferred items](#deferred-items) for per-provider sound settings.

## 10. Import / export

- Schema v2: `SCHEMA_ID = 'zendesk-ticket-monitor/monitors/v2'`, version 2.
- Export writes `monitors: [{name, url, enabled, provider}]`
  (no `id`/`createdAt` — regenerated on import, as today).
- Import accepts v1 (`endpoints`, no `provider` → defaults to `zendesk`) and
  v2 (`monitors`). Version gate: `version >= 1`. Entries with an
  invalid/unknown `provider` are skipped with a clear message. URLs validate
  against their declared provider's rules.

## 11. Manifest / permissions delta

- Add `"host_permissions": ["*://*.atlassian.net/*"]`.
- `"cookies"` permission stays scoped to `*://*.zendesk.com/*` — no Jira
  cookies needed (token auth).
- No other permission changes. The atlassian.net host scope is standard and
  low-risk for Web Store review; the privacy listing must mention the stored
  API token (see §6).

## 12. Implementation order

From [Codebase extension points for a second provider](https://github.com/barateza/barateza-ticket-notifier-v3/issues/39),
adjusted for later decisions:

1. `endpoints` → `monitors` storage migration + `provider` field (default
   `'zendesk'`, sanitised on read).
2. Extract `utils/providers/` registry + Zendesk adapter — no behavior change.
3. Rewire `validators.js`, `cookie-service.js`, `poller.js`,
   `notification-manager.js` to the registry.
4. Schema v2 import/export (accept v1 + v2).
5. Popup: grouped list, inference-first modal (detection chip, dual
   placeholder, per-provider errors), credentials settings section.
6. Manifest delta + docs (README, PRIVACY_POLICY, install-guide).
7. Update test fixtures; adapter tests for both providers.
8. Add `jira-provider.js` last — purely additive.

Provider-agnostic modules (storage-service, message-router, snooze-service,
offscreen, logger, popup-utils/settings/snooze) need no changes.

## 13. Testing notes

- Mock shape: a second provider fixture set — Jira `approximate-count`
  (`{count, exact}`) and `search/jql` (`{total, issues: []}`) responses,
  `jql`-bearing URL fixtures, `*.atlassian.net` cookie/credential stubs.
- Adapter unit tests: URL normalisation, API URL derivation, parseCount +
  fallback, detection, fetch options (Basic header), per-provider error copy.
- Poller tests: per-provider backoff isolation (a Jira 429 does not pause
  Zendesk), last-known-count retention on error, no notifications on error.
- Import tests: v1 + v2 acceptance, provider defaulting, invalid-provider
  skip, per-provider URL validation.

## 14. Deferred items

Open questions for the implementation effort, not design gaps (they do not
block implementation):

- **Per-provider sound settings**: whether Jira monitors need their own sound
  config. Default for now: shared settings, unchanged.
- **Docs**: README / install-guide updates for a second provider and the
  `endpoint → monitor` rename (copy decisions belong to implementation).
- **Web Store listing text**: privacy wording from §6 to be drafted at
  release time.
- **Verify at runtime**: the exact field names of the `approximate-count`
  response (`{count, exact}`) and that `maxResults=0` returns `total` as
  researched.

## 15. References

All decisions, with full detail, live in the closed tickets of the map
[Map: JSM ticket monitoring support](https://github.com/barateza/barateza-ticket-notifier-v3/issues/36):
Jira Cloud cookie auth feasibility · Jira Cloud count endpoint and rate limits
· Codebase extension points for a second provider · Canonical language for
multi-provider monitoring · Jira endpoint schema and URL format · Popup UI
sketch for provider selection · Auth and permissions design for Jira ·
Polling and error handling per provider. Throwaway research findings:
`research/` branches (`research/jsm-cookie-auth`, `research/jsm-count-endpoint`,
`research/jsm-extension-points`); UI prototype: branch `prototype/provider-select`.
