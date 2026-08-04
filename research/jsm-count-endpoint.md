# Jira Cloud count endpoint and rate limits

Research for [barateza/barateza-ticket-notifier-v3#38](https://github.com/barateza/barateza-ticket-notifier-v3/issues/38): the cheapest reliable way to poll the COUNT of Jira Cloud issues matching a JQL query from a browser-extension context, and the rate limits that apply. Use case: the extension polls every 1–15 minutes per monitored query and compares counts (today against the Zendesk Search API, whose response has `count`).

Confidence note up front: two details — the exact response field names of `approximate-count` and its `includeArchived` parameter — are taken from the official v3 OpenAPI spec and the docs anchor for the operation (listed in Sources). The spec section could not be rendered textually in the environment where this research ran, so **verify those two details once with one authenticated call** before relying on them. Everything else below was verified directly against the cited pages.

---

## Recommended endpoint + URL shape (with the response field to read)

**Primary — `GET /rest/api/3/search/approximate-count`** ("Get approximate count of issues matching JQL", v3 docs anchor; defined in the v3 OpenAPI spec):

```
GET https://<site>.atlassian.net/rest/api/3/search/approximate-count?jql=<url-encoded-JQL>&includeArchived=false
Authorization: Basic <base64("email:api_token")>      # or OAuth 2.0 3LO Bearer token
```

- Query params (per the v3 spec): `jql` (required), `includeArchived` (optional, default `false`).
- Response (per the v3 spec, schema `ApproximateCount`): `{ "count": <int>, "exact": <bool> }` — **read `.count`**. `exact` is `false` when the count is an estimate (complex JQL).
- Why it is the cheapest: the response is just the two numbers — no issue objects, so the points cost is the 1-point base with no object surcharge (see Rate limits) and the payload is a few hundred bytes.
- It exists on `v2`, `v3` and `latest` (`/rest/api/{2|3|latest}/search/...` family, same as `/search/jql` per the Search and Reconcile guide).

**Exact-count fallback — `GET /rest/api/3/search/jql?jql=...&maxResults=0`** → read `.total` (SearchResults shape: `{ expand, startAt, maxResults, total, issues, warningMessages, ... }`; community-verified that `maxResults=0` returns `total` with an empty `issues` array — see Pitfalls). There is also `POST /rest/api/3/search/jql` with the JQL in the JSON body (`{ "jql": "...", "maxResults": 0 }`) for very long queries.

**Do NOT use `GET /rest/api/3/search`** — it is deprecated and "currently being removed" (changelog CHANGE-2046); the docs explicitly point to the POST variant for large JQL. Build on `/search/jql` and `/search/approximate-count`.

**Browser/extension mechanics:** an MV3 service worker can call these endpoints directly — with `host_permissions: ["*://*.atlassian.net/*"]` extension fetches are exempt from CORS (Chrome docs). Authentication must be **Basic auth with an email + API token** (the documented ad-hoc method); cookie/session auth is deprecated and disabled for the Jira Cloud REST API (see `research/jsm-cookie-auth.md` for the full analysis — the `Authorization` header approach is the recommendation there).

## Rate limits (numbers + sources; is 1–15 min polling per query safe?)

All numbers below are from the current official "Rate limiting" page (https://developer.atlassian.com/cloud/jira/platform/rate-limiting/), unless noted. Jira Cloud enforces three independent systems simultaneously:

1. **Burst API rate limits (per-second, per tenant, per endpoint).** Token-bucket per API path; default steady-state for `GET` is **100 requests/second** (custom limits exist per endpoint; the bucket is scoped to one endpoint path, so `/rest/api/3/search/jql` and `/rest/api/3/search/approximate-count` have their own buckets). A burst buffer absorbs short spikes above the steady-state rate. Exceeding it → `429` with `RateLimit-Reason: jira-burst-based` and `Retry-After`.

2. **Points-based hourly quota.** Each request costs 1 base point + 1 point per object affected (Issues = 1 point; e.g. `GET /rest/api/3/issue/ABC-123` = 1 + 1 = 2 points). A count call returns no issue objects → **~1–2 points per poll**. Quotas: Tier 1 "Global Pool" (default) = **65,000 points/hour shared across all tenants**; Tier 2 per-tenant pool (after review) = Free 65,000 / Standard 100,000 + 10×users / Premium 130,000 + 20×users / Enterprise 150,000 + 30×users per hour (capped 500,000). Quota resets at the top of each UTC hour. **Enforcement begins March 2, 2026** for Forge, Connect and OAuth 2.0 (3LO) apps; **"API token-based traffic is not affected by this change, and will continue to be governed by existing burst rate limits"** (same page + changelog CHANGE-2958). This is the key line for this extension: polling with a user's API token stays under burst-only limits.

3. **Per-issue write limits** — irrelevant for read-only counting.

**Per-user request limits are not published** — the 2021 edition of the official doc states: "REST API rate limits are not published because the computation logic is evolving continuously..." (Wayback snapshot, 2021-07-27).

**Handling 429s (official guidance):** respect `Retry-After`, retry with exponential backoff + jitter, only for idempotent calls; monitor `X-RateLimit-*` / `RateLimit-Reason` / `Beta-RateLimit*` headers. 429 is the only signal — there is no gradual throttling.

**Is 1–15 min polling per query safe? Yes — by orders of magnitude.**

- Requests: polling N queries every 1 minute = N req/min. Even 100 queries at 1-min intervals ≈ 1.7 req/s sustained, against a 100 req/s per-endpoint burst limit with a burst buffer. At 5–15 min intervals it is a rounding error.
- Points: ~2 points per poll → 100 queries × 60 polls/h × 2 = 12,000 points/h worst case (18% of the 65,000 global pool); realistic usage (e.g. 20 queries at 15-min intervals) ≈ 160 points/h (0.25%). Under API-token auth the points quota does not even apply until/unless Atlassian changes the carve-out.
- The count endpoints return no issue objects, so they are also the cheapest possible polling target under the points model — cheaper than any search that returns issue rows.

## Pitfalls (maxResults=0 behavior, archived issues, permissions, encoding)

- **`maxResults=0` is accepted and returns the total.** Community-verified on `/rest/api/2/search` (mock/real response `{ "startAt": 0, "maxResults": 0, "total": 13, "issues": [] }`, 2020, community.developer.atlassian.com t/43424) and `/rest/api/3/search` used exactly as a count hack in Forge apps (`requestJira(route`/rest/api/3/search?jql=...&maxResults=0`)` then `return data.total;`, 2024, t/82953; "querying ?maxresults=0 in jira ... returns only the total count", 2023, t/65064). Same pagination model applies to `/search/jql` (verify once if you rely on it there).
- **`approximate-count` can be an estimate.** For very complex JQL the count may be approximate (`exact: false`). For change detection ("did the number move?") that is fine; if the number must equal Zendesk's exact count, use the search endpoint's `total` instead.
- **Archived issues are excluded by default.** JQL search excludes archived issues; `approximate-count` exposes `includeArchived` (default `false`) for this. Decide what the comparison baseline counts (what Zendesk Search returns) and keep the flag + JQL consistent, or "today" can jump when issues get archived mid-comparison.
- **Permissions scope the count.** Search/count operations only include issues where the caller has *Browse projects* (and issue-level security) permission; the docs' permission text for the search operations is exactly that. Counts are user-scoped — poll with the same identity you compare against. Note Zendesk and Jira permission models differ, so a count difference may be legitimate.
- **Encoding.** The `jql` parameter must be URL-encoded — the official examples use `jql=project%20%3D%20HSP` (spaces → `%20`, `=` → `%3D`; quoted strings need `%22`). In JS use `encodeURIComponent(jql)` on the whole query before interpolating into the URL. And per the docs: "If the JQL query expression is too large to be encoded as a query parameter, use the POST version" (`POST /rest/api/3/search/jql`, JQL in the body). There is no published max JQL length; the GET-vs-POST split is the documented boundary.
- **Eventual consistency.** Search is eventually consistent — recent writes may not appear for seconds to minutes ("The majority of modifications are shown within seconds"; bulk operations can take longer). `reconcileIssues` (max 50 issue IDs) exists for read-after-write needs. For 1–15 min polling this is a non-issue.
- **Auth.** Cookie/session auth is deprecated for Jira Cloud REST (401s since the 2019 deprecation; `/rest/auth/1/session` removed) — do not extend the Zendesk cookie pattern to Jira. Use Basic auth with an API token (works with 2FA/SAML sites). 3LO OAuth would need a client id/secret, which a front-end-only extension cannot keep secret — API token is the fit (see `research/jsm-cookie-auth.md`).
- **Deprecations.** `GET /rest/api/3/search` is "currently being removed" (CHANGE-2046). `GET`/`POST /rest/api/3/search/jql` and `GET /rest/api/3/search/approximate-count` are the current search surface.

## Sources

Primary (Atlassian):
- Issue search API group (v3) — operations incl. `GET /rest/api/3/search` (deprecated, "currently being removed"), `POST /rest/api/3/search/jql`, and the `approximate-count` anchor: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/ and https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-approximate-count-get (v2 mirror: https://developer.atlassian.com/cloud/jira/platform/rest/v2/api-group-issue-search/)
- Official v3 OpenAPI spec (paths `/rest/api/3/search/jql` + `/rest/api/3/search/approximate-count`, schema `ApproximateCount`): https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json
- Rate limiting (current; burst 100 RPS GET default, points-based quotas, enforcement 2026-03-02, API-token carve-out, 429/Retry-After handling): https://developer.atlassian.com/cloud/jira/platform/rate-limiting/
- Rate limiting (2021 edition; "REST API rate limits are not published"): https://web.archive.org/web/20210727175327/https://developer.atlassian.com/cloud/jira/platform/rate-limiting/
- Changelog: points-based rate limit enforcement https://developer.atlassian.com/cloud/jira/platform/changelog/#CHANGE-2958 ; GET /search removal https://developer.atlassian.com/changelog/#CHANGE-2046
- Search and Reconcile guide (`/rest/api/{2|3|latest}/search/jql`, eventual consistency, `reconcileIssues` max 50): https://developer.atlassian.com/cloud/jira/platform/search-and-reconcile/
- Basic auth for REST APIs (API token method): https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/
- Chrome extensions: host-permission fetches are CORS-exempt https://developer.chrome.com/docs/extensions/develop/concepts/network-requests

Secondary (community, for behavior not stated verbatim in docs):
- `maxResults=0` → `total` + empty `issues`: https://community.developer.atlassian.com/t/lagomfetch-a-library-to-abstract-out-http-requests/43424 (2020, response sample), https://community.developer.atlassian.com/t/forge-api-backend-example-help/82953 (2024, `data.total`), https://community.developer.atlassian.com/t/confluence-cql-to-get-only-size/65064 (2023), https://community.developer.atlassian.com/t/retrieving-issues-via-search-rest-api-cloud-with-specific-property-that-is-not-empty/27052 (2019)
- `approximate-count` recommended for estimating result sizes before bulk pulls: https://community.developer.atlassian.com/t/optimizing-triggers-and-high-volume-data-flows-in-atlassian-forge/94547 (2025)
- SearchResults `total` in real responses: https://community.developer.atlassian.com/t/how-do-i-limit-the-number-of-results-coming-back-from-an-api-query/77287 (2024)

Local cross-references: `research/jsm-cookie-auth.md` (why API-token Basic auth, not cookies, for Jira Cloud from this extension).
