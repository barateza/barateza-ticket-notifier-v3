// ─── Jira Provider Adapter ────────────────────────────────────────────────────
//
// Jira Cloud (JSM) specifics: users paste Jira UI search URLs (any
// *.atlassian.net URL carrying a jql param); the adapter normalises them to
// the canonical /issues/?jql= form for storage and derives the
// approximate-count polling URL. Auth is API-token Basic (no cookies).
// See docs/jsm-support-spec.md §5–§6.
// ───────────────────────────────────────────────────────────────────────────────

const JIRA_PLACEHOLDER_URL =
  'https://your-site.atlassian.net/issues/?jql=project%20%3D%20SUPPORT%20AND%20status%20%3D%20Open';

export const jiraProvider = {
  id: 'jira',
  label: 'Jira',
  placeholderUrl: JIRA_PLACEHOLDER_URL,

  /** Host-based detection: any *.atlassian.net host. */
  detectFromUrl(url) {
    try {
      const hostname = new URL(url).hostname;
      const parts = hostname.split('.');
      return (
        parts.length >= 3 &&
        parts[parts.length - 2] === 'atlassian' &&
        parts[parts.length - 1] === 'net'
      );
    } catch {
      return false;
    }
  },

  /**
   * Validate a Jira search URL: *.atlassian.net host + a jql query param.
   * @param {string} url
   * @returns {{valid: boolean, error?: string}}
   */
  validateUrl(url) {
    if (!url || typeof url !== 'string') {
      return { valid: false, error: 'URL is required' };
    }

    try {
      const urlObj = new URL(url);

      if (!this.detectFromUrl(url)) {
        return {
          valid: false,
          error: 'URL must be an Atlassian site (*.atlassian.net)'
        };
      }

      if (!urlObj.searchParams.has('jql')) {
        return {
          valid: false,
          error: 'URL must include a JQL query (?jql=…)'
        };
      }

      return { valid: true };
    } catch (_error) {
      return { valid: false, error: 'Please enter a valid URL' };
    }
  },

  /** Canonical stored form: https://<site>/issues/?jql=<url-encoded>. */
  normaliseUrl(url) {
    const urlObj = new URL(url);
    const jql = urlObj.searchParams.get('jql') || '';
    return `${urlObj.protocol}//${urlObj.hostname}/issues/?jql=${encodeURIComponent(jql)}`;
  },

  /** Derive the count polling URL from a stored UI search URL. */
  buildApiUrl(url) {
    const urlObj = new URL(url);
    const jql = urlObj.searchParams.get('jql') || '';
    return `${urlObj.protocol}//${urlObj.hostname}/rest/api/3/search/approximate-count?jql=${encodeURIComponent(jql)}&includeArchived=false`;
  },

  /**
   * Parse the count: `.count` from approximate-count, `.total` from the
   * search/jql fallback.
   */
  parseCount(data) {
    if (data && typeof data.count === 'number') return data.count;
    if (data && typeof data.total === 'number') return data.total;
    return 0;
  },

  /** Jira uses API-token auth — never cookies. */
  isAuthCookie() {
    return false;
  },

  /**
   * Build fetch options for a Jira API call: Basic auth from per-site
   * credentials; no Cookie header.
   * @param {{cookies?: string, credentials?: {email?: string, token?: string}}} deps
   * @returns {{method: string, headers: object}}
   */
  buildFetchOptions({ credentials }) {
    const headers = { 'Accept': 'application/json' };
    if (credentials && credentials.email && credentials.token) {
      headers.Authorization = 'Basic ' + btoa(`${credentials.email}:${credentials.token}`);
    }
    return { method: 'GET', headers };
  },

  /** Notification-click fallback: the site's issues page. */
  fallbackDashboardUrl(monitorUrl) {
    try {
      const urlObj = new URL(monitorUrl);
      return `${urlObj.protocol}//${urlObj.hostname}/issues/`;
    } catch {
      return 'https://id.atlassian.net/issues/';
    }
  }
};
