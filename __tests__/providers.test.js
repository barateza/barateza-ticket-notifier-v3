// Unit tests for utils/providers — registry + Zendesk/Jira adapters.
// Seams under test (spec §13): detection, URL validation, normalisation,
// API URL derivation, count parsing + fallback, fetch options, cookie filter.

import {
  registerProvider,
  getProvider,
  listProviders,
  detectProviderFromUrl,
  getZendeskProvider,
  getJiraProvider
} from '../utils/providers/provider-registry.js';

const ZEN_URL = 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+status:new';
const JIRA_UI_URL = 'https://myco.atlassian.net/issues/?jql=project%20%3D%20SUPPORT%20AND%20status%20%3D%20Open';
const JIRA_BOARD_URL = 'https://myco.atlassian.net/jira/software/c/projects/SUPPORT/boards/1?jql=assignee%20%3D%20currentUser()';

describe('provider-registry', () => {
  test('auto-registers zendesk and jira adapters', () => {
    expect(listProviders().map(p => p.id).sort()).toEqual(['jira', 'zendesk']);
  });

  test('getProvider falls back to zendesk for unknown ids', () => {
    expect(getProvider('nope').id).toBe('zendesk');
    expect(getProvider('zendesk').id).toBe('zendesk');
    expect(getProvider('jira').id).toBe('jira');
  });

  test('detectProviderFromUrl maps hosts to provider ids', () => {
    expect(detectProviderFromUrl(ZEN_URL)).toBe('zendesk');
    expect(detectProviderFromUrl(JIRA_UI_URL)).toBe('jira');
    expect(detectProviderFromUrl('https://example.com/api')).toBeNull();
  });

  test('registerProvider can register/override an adapter', () => {
    const fake = { id: 'fake', detectFromUrl: () => true };
    registerProvider(fake);
    expect(getProvider('fake').id).toBe('fake');
    expect(detectProviderFromUrl('https://anything.test/x')).toBe('fake');
  });

  test('getZendeskProvider / getJiraProvider return the adapters', () => {
    expect(getZendeskProvider().id).toBe('zendesk');
    expect(getJiraProvider().id).toBe('jira');
  });
});

describe('zendesk-provider', () => {
  const zen = getZendeskProvider();

  test('label and id', () => {
    expect(zen.id).toBe('zendesk');
    expect(zen.label).toBe('Zendesk');
  });

  test('validateUrl accepts a real Zendesk search URL', () => {
    expect(zen.validateUrl(ZEN_URL).valid).toBe(true);
  });

  test('validateUrl rejects non-Zendesk hosts', () => {
    const r = zen.validateUrl(JIRA_UI_URL);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('zendesk.com');
  });

  test('validateUrl rejects non-search paths and missing query', () => {
    expect(zen.validateUrl('https://cpanel.zendesk.com/api/v2/tickets.json').valid).toBe(false);
    expect(zen.validateUrl('https://cpanel.zendesk.com/api/v2/search.json').valid).toBe(false);
  });

  test('normaliseUrl is identity for Zendesk', () => {
    expect(zen.normaliseUrl(ZEN_URL)).toBe(ZEN_URL);
  });

  test('buildApiUrl is identity for Zendesk', () => {
    expect(zen.buildApiUrl(ZEN_URL)).toBe(ZEN_URL);
  });

  test('parseCount reads data.count', () => {
    expect(zen.parseCount({ count: 5, results: [] })).toBe(5);
    expect(zen.parseCount({})).toBe(0);
  });

  test('isAuthCookie recognises Zendesk auth cookie names', () => {
    expect(zen.isAuthCookie('_zendesk_shared_session')).toBe(true);
    expect(zen.isAuthCookie('session')).toBe(true);
    expect(zen.isAuthCookie('theme')).toBe(false);
  });

  test('buildFetchOptions includes cookies when supplied, never Authorization', () => {
    const opts = zen.buildFetchOptions({ cookies: 'a=1; b=2', credentials: { token: 'x' } });
    expect(opts.headers.Cookie).toBe('a=1; b=2');
    expect(opts.headers.Authorization).toBeUndefined();
    expect(opts.credentials).toBe('include');
  });

  test('fallbackDashboardUrl is the Zendesk agent dashboard', () => {
    expect(zen.fallbackDashboardUrl()).toBe('https://cpanel.zendesk.com/agent/dashboard');
  });
});

describe('jira-provider', () => {
  const jira = getJiraProvider();

  test('label and id', () => {
    expect(jira.id).toBe('jira');
    expect(jira.label).toBe('Jira');
  });

  test('validateUrl accepts any *.atlassian.net URL with a jql param', () => {
    expect(jira.validateUrl(JIRA_UI_URL).valid).toBe(true);
    expect(jira.validateUrl(JIRA_BOARD_URL).valid).toBe(true);
  });

  test('validateUrl rejects non-Atlassian hosts', () => {
    const r = jira.validateUrl(ZEN_URL);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('atlassian.net');
  });

  test('validateUrl rejects atlassian.net URLs without jql', () => {
    const r = jira.validateUrl('https://myco.atlassian.net/issues/');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('jql');
  });

  test('normaliseUrl produces the canonical /issues/?jql= URL', () => {
    expect(jira.normaliseUrl(JIRA_UI_URL))
      .toBe('https://myco.atlassian.net/issues/?jql=project%20%3D%20SUPPORT%20AND%20status%20%3D%20Open');
    expect(jira.normaliseUrl(JIRA_BOARD_URL))
      .toBe('https://myco.atlassian.net/issues/?jql=assignee%20%3D%20currentUser()');
  });

  test('buildApiUrl derives the approximate-count endpoint', () => {
    expect(jira.buildApiUrl(JIRA_UI_URL))
      .toBe('https://myco.atlassian.net/rest/api/3/search/approximate-count?jql=project%20%3D%20SUPPORT%20AND%20status%20%3D%20Open&includeArchived=false');
  });

  test('parseCount reads .count from approximate-count and .total from search/jql', () => {
    expect(jira.parseCount({ count: 7, exact: true })).toBe(7);
    expect(jira.parseCount({ total: 12, issues: [] })).toBe(12);
    expect(jira.parseCount({})).toBe(0);
  });

  test('isAuthCookie always false — token auth, no cookies', () => {
    expect(jira.isAuthCookie('cloud.session.token')).toBe(false);
    expect(jira.isAuthCookie('anything')).toBe(false);
  });

  test('buildFetchOptions attaches Basic auth from credentials and no Cookie header', () => {
    const opts = jira.buildFetchOptions({ cookies: 'x=1', credentials: { email: 'me@corp.com', token: 'sekret' } });
    expect(opts.headers.Authorization).toBe('Basic ' + btoa('me@corp.com:sekret'));
    expect(opts.headers.Cookie).toBeUndefined();
  });

  test('buildFetchOptions without credentials omits Authorization', () => {
    const opts = jira.buildFetchOptions({});
    expect(opts.headers.Authorization).toBeUndefined();
  });

  test('fallbackDashboardUrl derives the site issues page from the monitor URL', () => {
    expect(jira.fallbackDashboardUrl(JIRA_UI_URL)).toBe('https://myco.atlassian.net/issues/');
  });

  test('placeholderUrl is a Jira search URL example', () => {
    expect(jira.placeholderUrl).toContain('atlassian.net');
    expect(jira.placeholderUrl).toContain('jql=');
  });
});
