# Jira Cloud cookie auth feasibility

Research for [barateza/barateza-ticket-notifier-v3#37](https://github.com/barateza/barateza-ticket-notifier-v3/issues/37): can a Manifest V3 Chrome extension authenticate to the Jira Cloud (`*.atlassian.net`) REST API v3 using browser session cookies read via `chrome.cookies` — with no API token?

Local context: the extension currently does this for Zendesk — `utils/cookie-service.js` collects auth cookies per domain via `chrome.cookies.getAll({ domain })` with a 5-minute in-memory cache, and `utils/poller.js` sends them as a `Cookie` header on `fetch(..., { credentials: 'include' })` (manifest has `"cookies"` permission + `*://*.zendesk.com/*` host permissions). This document evaluates whether the identical pattern can target Jira Cloud.

## Verdict (yes/no/qualified)

**No — not feasible as a supported mechanism.** Atlassian has deprecated and disabled cookie-based authentication for the Jira Cloud REST API:

- The official Cloud doc "Cookie-based auth for REST APIs" states at the top: **"Cookie-based authentication is deprecated. Jira Cloud has deprecated cookie-based authentication in favor of basic authentication with API tokens or OAuth."** (https://developer.atlassian.com/cloud/jira/platform/jira-rest-api-cookie-based-authentication/)
- The official deprecation notice states: **"From June 3rd, 2019, we will be progressively disabling this authentication method"** and that "Basic authentication with passwords and cookie-based authentication are now deprecated and will be removed in 2019", and lists "Jira Cloud public REST API" among the surfaces where "all requests using basic authentication with a non-API token credential will return 401 (Unauthorized) after the deprecation period". It also says the Cloud endpoint **`/rest/auth/1/session` will be removed** (https://developer.atlassian.com/cloud/jira/platform/deprecation-notice-basic-auth-and-cookie-based-auth/)
- The Jira Cloud REST API v3 intro's "Authentication and authorization" section documents only: Forge apps (scopes), Connect apps (JWT), OAuth 2.0 (3LO) apps, and ad-hoc API calls via **basic authentication** — session-cookie auth is not listed at all (https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)
- Cookie/session auth (`POST /rest/auth/1/session`, JSESSIONID) is a **Jira Data Center/Server** concept ("Jira uses cookie-based authentication in the browser… you can POST to the /auth/1/session resource"), not a Cloud API feature (https://developer.atlassian.com/server/jira/platform/rest/v1000/intro/)
- An Atlassian Team member (accepted answer, Nov 2021) confirmed the boundary: browser built-in APIs on the Jira page itself ride the browser session, but **"if you are connecting from a scripted function or external application (i.e. curl command from terminal or app like Postman), this will require the API token"** (https://community.atlassian.com/forums/Jira-questions/JIRA-Rest-API-Cookie-based-authentication-with-a-session-token/qaq-p/1870317)

The MV3 mechanics are *not* the blocker — a service worker can read the cookies and send them. The blocker is server-side: Atlassian rejects cookie-authenticated scripted calls to the Cloud REST API (401).

**Qualification:** enforcement has historically been inconsistent — users reported cookie-based calls "still work[ing]" in 2021 (thread 1870317), and a 2022 thread documents people using `cloud.session.token` against internal APIs, with the user themselves noting "this is not supported official API" (https://community.atlassian.com/forums/Jira-questions/cloud-session-token-to-access-internal-api/qaq-p/2224630). So it may *appear* to work for some sites/endpoints, but it is officially unsupported, can break or 401 at any time, and is explicitly the pattern Atlassian tells scripted clients to replace with API tokens. It is not a viable design for a product extension.

## Cookies and headers required (with sources)

If one were to attempt cookie auth anyway (not recommended), the relevant cookies/headers are:

- **`cloud.session.token`** — the Atlassian-account session cookie (JWT-format value) set on `.atlassian.net`; historically returned by `POST/GET /rest/auth/1/session` on Cloud instead of JSESSIONID. Users report receiving `{"session":{"name":"cloud.session.token","value":"eyJraWQiOiJzZXNzaW9uLXN..."}}` from `/rest/auth/1/session` (https://community.atlassian.com/forums/Jira-questions/JIRA-API-Authentication-Cookie-No-JSESSIONID-but-cloud-session/qaq-p/607903; also https://community.atlassian.com/forums/Confluence-questions/How-to-fetch-cloud-session-token-cookie-through-REST-API/qaq-p/1235521)
- **`JSESSIONID`** — the classic Jira session cookie (Server/DC model; the Cloud equivalent is `cloud.session.token` per thread 607903). In Cloud it is not the session cookie you can rely on for API auth.
- **`crowd.token_key`** — legacy Crowd SSO cookie (Server/DC era). **No primary source for it being usable on Cloud was verified during this research; it is not needed for the conclusion.** (Deprecation notice above makes cookie auth moot regardless.)
- Request shape: send `Cookie: cloud.session.token=<value>` (plus whatever the site set) on every request to `https://<site>.atlassian.net/rest/api/3/...`. The extension's own pattern (Cookie header + `credentials: 'include'`) is technically sendable from an MV3 service worker because:
  - `chrome.cookies.getAll({ domain })` returns cookies (including `HttpOnly` ones — the `Cookie` object exposes `httpOnly`) **only for domains the extension has host permissions for**; declaring `"cookies"` + `*://*.atlassian.net/*` is the documented requirement (https://developer.chrome.com/docs/extensions/reference/api/cookies)
  - Cross-origin `fetch()` from an extension service worker is allowed and CORS-exempt when host permissions are granted (https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
  - Requests from an extension to a host it has permissions for are treated as same-site, so SameSite cookies are sent (https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)
- The server will reject them anyway (401 / deprecation), so these mechanics are necessary but not sufficient.

## Blockers (2FA, bot protection, XSRF, cookie rotation)

1. **Deprecation / 401 (decisive).** Cookie-based auth was progressively disabled from June 3, 2019; requests to the Jira Cloud public REST API with non-API-token credentials return 401; `/rest/auth/1/session` (the only endpoint that could mint/renew a session cookie) was removed from Cloud (https://developer.atlassian.com/cloud/jira/platform/deprecation-notice-basic-auth-and-cookie-based-auth/; https://developer.atlassian.com/cloud/jira/platform/jira-rest-api-cookie-based-authentication/)
2. **No session-renewal path.** With `/rest/auth/1/session` gone, an extension cannot create or refresh a Cloud session programmatically; it would depend entirely on whatever cookie the user's browser has after a manual web login, which expires (expired cookies → 401 with an invalid-cookie message; "you will need to re-authenticate to the session resource" — which no longer exists on Cloud) (https://developer.atlassian.com/cloud/jira/platform/jira-rest-api-cookie-based-authentication/)
3. **Scripted-call policy.** Atlassian Team explicitly states external/scripted clients (which is what an extension service worker is) must use an API token, not the browser session (https://community.atlassian.com/forums/Jira-questions/JIRA-Rest-API-Cookie-based-authentication-with-a-session-token/qaq-p/1870317)
4. **2FA/SAML.** Not a direct blocker for the cookie approach (the user is already logged in via the browser), but irrelevant here — the approach fails server-side regardless. Conversely, API tokens are the documented replacement precisely because "API tokens will allow you to authenticate even if your Atlassian Cloud organization has two-factor authentication or SAML enabled" (https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/)
5. **Bot protection / CAPTCHA.** Atlassian's docs confirm a CAPTCHA is triggered after consecutive failed logins and "you cannot use Jira's REST API to authenticate with a Jira site, once Jira's CAPTCHA upon login feature has been triggered" (https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/; same text in https://developer.atlassian.com/cloud/jira/platform/jira-rest-api-cookie-based-authentication/). Scripted cookie-authenticated calls are also the exact traffic Atlassian's bot defenses target, so expect flaky 403/captcha behavior on top of the 401 policy. (No separate official "bot management" doc was verified in this research; the CAPTCHA mechanism above is the documented, citable part.)
6. **XSRF / form-token checking.** For REST operations that accept multipart/form-data, the Cloud API blocks requests missing `X-Atlassian-Token: no-check` due to CSRF protection (https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/ — "Special request and response headers"). Atlassian's cookie-auth doc confirms Jira's form-token checking affects form-encoded endpoints (e.g. attachments) for clients not using basic auth (https://developer.atlassian.com/cloud/jira/platform/jira-rest-api-cookie-based-authentication/). A read-only `GET /rest/api/3/search` doesn't need the token, but any state-changing/multipart call made under cookie auth would.
7. **Cookie rotation/expiry.** `cloud.session.token` changes on each login and expires; the extension's 5-minute cache (utils/cookie-service.js) doesn't help when the session itself dies, and there is no supported way to detect/refresh it server-side (https://developer.atlassian.com/cloud/jira/platform/jira-rest-api-cookie-based-authentication/ — "Cookie expiration" section)
8. **Unsupported = breakable.** Community reports (2019–2022) treat `cloud.session.token`-based calls as unsupported/unofficial (https://community.atlassian.com/forums/Jira-questions/cloud-session-token-to-access-internal-api/qaq-p/2224630; https://community.atlassian.com/forums/Confluence-questions/How-to-fetch-cloud-session-token-cookie-through-REST-API/qaq-p/1235521)

## Fallback: API-token auth shape

Atlassian's supported replacement for cookie auth on Cloud is **basic auth with an API token** (this is the "ad-hoc API calls" method the v3 intro documents):

- User generates an API token for their Atlassian account at https://id.atlassian.com/manage/api-tokens (https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/)
- Request shape (unchanged from what the extension already does, minus cookies):

  ```
  GET https://your-domain.atlassian.net/rest/api/3/search?jql=...
  Authorization: Basic base64("user@example.com:api_token")
  Accept: application/json
  ```

  (https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/; URL shape `https://<site-url>/rest/api/3/<resource-name>` per https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)
- Passwords are deprecated; API tokens work with 2FA/SAML orgs (https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/)
- For a distributable app rather than a per-user token, Atlassian recommends OAuth 2.0 authorization-code grants (3LO): `https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/...` with a bearer token (https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/; https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/)
- Extension impact: store the token via `chrome.storage`, send the `Authorization` header from the service worker (CORS-exempt with `host_permissions` for `*://*.atlassian.net/*` — https://developer.chrome.com/docs/extensions/develop/concepts/network-requests). The `cookies` permission and `Cookie`-header/`credentials:'include'` logic are then not needed for Jira at all.

## Sources (URLs)

- https://developer.atlassian.com/cloud/jira/platform/deprecation-notice-basic-auth-and-cookie-based-auth/ — cookie-based auth deprecated; disabled from June 3, 2019; 401 for non-API-token credentials; `/rest/auth/1/session` removed
- https://developer.atlassian.com/cloud/jira/platform/jira-rest-api-cookie-based-authentication/ — "Cookie-based authentication is deprecated" banner; how session cookies work; cookie expiration → 401; CAPTCHA; form-token checking
- https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/ — Cloud REST API v3: supported auth = Forge/Connect/OAuth 2.0 (3LO)/basic auth; `X-Atlassian-Token: no-check` CSRF requirement for multipart endpoints
- https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/ — API-token basic auth shape; tokens work with 2FA/SAML; passwords deprecated; CAPTCHA on failed logins
- https://developer.atlassian.com/server/jira/platform/rest/v1000/intro/ — cookie/session auth (`/auth/1/session`) is a Data Center/Server mechanism, not Cloud
- https://community.atlassian.com/forums/Jira-questions/JIRA-Rest-API-Cookie-based-authentication-with-a-session-token/qaq-p/1870317 — 2021: user reports cookie auth "still works"; Atlassian Team: scripted/external calls require API token
- https://community.atlassian.com/forums/Jira-questions/JIRA-API-Authentication-Cookie-No-JSESSIONID-but-cloud-session/qaq-p/607903 — 2017: Cloud returns `cloud.session.token` (not JSESSIONID) from `/rest/auth/1/session`
- https://community.atlassian.com/forums/Jira-questions/cloud-session-token-to-access-internal-api/qaq-p/2224630 — 2022: `cloud.session.token` for internal APIs is explicitly "not supported official API"
- https://community.atlassian.com/forums/Confluence-questions/How-to-fetch-cloud-session-token-cookie-through-REST-API/qaq-p/1235521 — 2019: attempts to obtain `cloud.session.token` programmatically (Confluence-side, same platform cookies)
- https://developer.chrome.com/docs/extensions/reference/api/cookies — chrome.cookies: requires `cookies` + host permissions; returns HttpOnly cookies; `getAll` restricted to host-permission domains
- https://developer.chrome.com/docs/extensions/develop/concepts/network-requests — extension service worker fetch is cross-origin-capable and CORS-exempt with host permissions
- https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies — extension requests to host-permission domains treated as same-site (SameSite cookies sent)
- https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/ — OAuth 2.0 (3LO) for integrations (referenced by the v3 intro and basic-auth pages)

Local files reviewed: `manifest.json` (permissions: cookies, host_permissions `*://*.zendesk.com/*` — would need `*://*.atlassian.net/*`), `utils/cookie-service.js` (per-domain cookie collection, 5-min cache), `utils/poller.js` (fetch with `Cookie` header + `credentials: 'include'`).
