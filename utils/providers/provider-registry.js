// ─── Provider Registry ────────────────────────────────────────────────────────
//
// Registers provider adapters and exposes lookup + detection. Mirrors the
// MessageRouter registry pattern. Auto-registers the built-in providers on
// import; registerProvider() allows overriding in tests.
//
// Interface:
//   getProvider(id)             → adapter (falls back to zendesk)
//   listProviders()             → all registered adapters
//   detectProviderFromUrl(url)  → provider id or null (host-based)
// ───────────────────────────────────────────────────────────────────────────────

import { zendeskProvider } from './zendesk-provider.js';
import { jiraProvider } from './jira-provider.js';

const providers = new Map();

export function registerProvider(provider) {
  providers.set(provider.id, provider);
}

export function getProvider(id) {
  return providers.get(id) || providers.get('zendesk');
}

export function listProviders() {
  return [...providers.values()];
}

export function getZendeskProvider() {
  return getProvider('zendesk');
}

export function getJiraProvider() {
  return getProvider('jira');
}

/**
 * Detect the provider for a URL by asking each adapter (host-based).
 * @param {string} url
 * @returns {string|null} — provider id, or null when no adapter claims it
 */
export function detectProviderFromUrl(url) {
  for (const provider of providers.values()) {
    if (provider.detectFromUrl(url)) {
      return provider.id;
    }
  }
  return null;
}

// Auto-register the built-in providers.
registerProvider(zendeskProvider);
registerProvider(jiraProvider);
