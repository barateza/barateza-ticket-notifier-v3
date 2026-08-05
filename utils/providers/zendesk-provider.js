// ─── Zendesk Provider Adapter ─────────────────────────────────────────────────
//
// Encapsulates everything Zendesk-specific: URL validation, count parsing,
// auth cookie filtering, fetch options, and click fallbacks. Behaviour is
// unchanged from the pre-registry code (utils/validators.js, cookie-service,
// poller) — this module is a pure extraction.
// ───────────────────────────────────────────────────────────────────────────────

const ZENDESK_PLACEHOLDER_URL =
  'https://your-domain.zendesk.com/api/v2/search.json?query=type:ticket+status:new';

export const zendeskProvider = {
  id: 'zendesk',
  label: 'Zendesk',
  placeholderUrl: ZENDESK_PLACEHOLDER_URL,

  /** Host-based detection: any *.zendesk.com host. */
  detectFromUrl(url) {
    try {
      const hostname = new URL(url).hostname;
      const parts = hostname.split('.');
      return (
        parts.length >= 3 &&
        parts[parts.length - 2] === 'zendesk' &&
        parts[parts.length - 1] === 'com'
      );
    } catch {
      return false;
    }
  },

  /**
   * Validate a Zendesk Search API URL.
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
          error: 'URL must be a Zendesk domain (*.zendesk.com)'
        };
      }

      if (!urlObj.pathname.includes('/api/v2/search')) {
        return {
          valid: false,
          error: 'URL must be a Zendesk API endpoint'
        };
      }

      if (!urlObj.searchParams.has('query')) {
        return {
          valid: false,
          error: 'URL must include a search query parameter'
        };
      }

      return { valid: true };
    } catch (_error) {
      return { valid: false, error: 'Please enter a valid URL' };
    }
  },

  /** Zendesk URLs are stored as pasted. */
  normaliseUrl(url) {
    return url;
  },

  /** The stored URL is the polling URL. */
  buildApiUrl(url) {
    return url;
  },

  /** Zendesk Search API responses carry the count in `count`. */
  parseCount(data) {
    return data?.count || 0;
  },

  /** Zendesk auth cookie names (session/auth/_zendesk/csrf/help center). */
  isAuthCookie(name) {
    return (
      name.includes('session') ||
      name.includes('auth') ||
      name.includes('_zendesk') ||
      name.includes('csrf') ||
      name === '_help_center_session'
    );
  },

  /**
   * Build fetch options for a Zendesk API call.
   * @param {{cookies?: string, credentials?: object}} deps
   * @returns {{method: string, credentials: string, headers: object}}
   */
  buildFetchOptions({ cookies }) {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    if (cookies) {
      headers.Cookie = cookies;
    }
    return { method: 'GET', credentials: 'include', headers };
  },

  /** Notification-click fallback when the URL mapping is missing. */
  fallbackDashboardUrl() {
    return 'https://cpanel.zendesk.com/agent/dashboard';
  }
};
