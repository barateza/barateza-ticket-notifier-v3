// ─── Poller ───────────────────────────────────────────────────────────────────
//
// Core polling logic: iterates enabled monitors, checks each one with retry
// logic, compares ticket counts, and dispatches notifications. Provider-aware
// via the provider registry: each monitor's adapter supplies the polling URL,
// fetch options (cookies vs Basic auth), and count parsing.
// Does NOT handle alarm creation or badge updates — those belong in monitor.js.
//
// Exported API (2 functions):
//   checkAllEndpoints() — iterates enabled monitors with concurrency control
//   checkEndpoint()     — single-monitor check with retries
// ───────────────────────────────────────────────────────────────────────────────

import Logger from './logger.js';
import * as snoozeService from './snooze-service.js';
import * as notificationManager from './notification-manager.js';
import * as cookieService from './cookie-service.js';
import * as rateLimitService from './rate-limit-service.js';
import { getProvider } from './providers/provider-registry.js';
import { getSession, setSession, getLocal, getMonitors } from './storage-service.js';

// ─── Count Persistence (internal) ──────────────────────────────────────────────

async function getEndpointCounts() {
  const { endpointCounts } = await getSession(['endpointCounts']);
  return new Map(Array.isArray(endpointCounts) ? endpointCounts : []);
}

async function saveEndpointCounts(map) {
  await setSession({ endpointCounts: Array.from(map.entries()) });
}

/** Exported for use by monitor.js (updateBadge). */
async function getAllCounts() {
  const { endpointCounts } = await getSession(['endpointCounts']);
  return Array.isArray(endpointCounts) ? endpointCounts : [];
}

export { getAllCounts };

// ─── Monitor Error State (internal) ───────────────────────────────────────────
//
// Session-persisted per-monitor error lines surfaced in the popup.
// Cleared on the next successful poll.

async function getMonitorErrors() {
  const { monitorErrors } = await getSession(['monitorErrors']);
  return new Map(Array.isArray(monitorErrors) ? monitorErrors : []);
}

async function saveMonitorErrors(map) {
  await setSession({ monitorErrors: Array.from(map.entries()) });
}

/** Exported for background.js (getMonitorErrors message handler). */
async function getAllMonitorErrors() {
  const { monitorErrors } = await getSession(['monitorErrors']);
  return Array.isArray(monitorErrors) ? monitorErrors : [];
}

export { getAllMonitorErrors };

async function setMonitorError(monitorId, type, message) {
  try {
    const map = await getMonitorErrors();
    map.set(monitorId, { type, message, at: Date.now() });
    await saveMonitorErrors(map);
  } catch (error) {
    Logger.error('Failed to persist monitor error state:', error);
  }
}

async function clearMonitorError(monitorId) {
  try {
    const map = await getMonitorErrors();
    if (map.delete(monitorId)) {
      await saveMonitorErrors(map);
    }
  } catch (error) {
    Logger.error('Failed to persist monitor error state:', error);
  }
}

// ─── Check All ────────────────────────────────────────────────────────────────

export async function checkAllEndpoints() {
  Logger.info('Checking all monitors...');

  try {
    const monitors = await getMonitors();
    const { settings } = await getLocal(['settings']);

    if (!monitors.length) {
      Logger.info('No monitors configured');
      return;
    }

    const enabledMonitors = monitors.filter(monitor => monitor.enabled);
    const concurrency = 3;

    for (let i = 0; i < enabledMonitors.length; i += concurrency) {
      const batch = enabledMonitors.slice(i, i + concurrency);
      await Promise.all(
        batch.map(monitor => checkEndpoint(monitor, settings, 0))
      );
    }

    Logger.info(`Completed checking ${enabledMonitors.length} monitors`);
  } catch (error) {
    Logger.error('Error checking monitors:', error);
  }
}

// ─── Check Single Monitor ─────────────────────────────────────────────────────

export async function checkEndpoint(monitor, settings, retryCount = 0) {
  const maxRetries = 2;
  const provider = getProvider(monitor.provider);

  try {
    if (rateLimitService.isLimited(provider.id)) {
      Logger.info(`Skipping ${monitor.name} — ${provider.id} is rate limited`);
      return;
    }

    Logger.info(`Checking monitor: ${monitor.name} (${provider.id})`);

    const url = new URL(monitor.url);
    const domain = url.hostname;
    const apiUrl = provider.buildApiUrl(monitor.url);

    const deps = { cookies: null, credentials: null };

    if (provider.id === 'zendesk') {
      const cookies = await cookieService.getCookies(domain);
      if (!cookies) {
        const message = `No Zendesk auth cookies for ${domain}. Please log in to ${domain} in your browser.`;
        Logger.error(message);
        await setMonitorError(monitor.id, 'auth', message);
        return;
      }
      deps.cookies = cookies;
    } else if (provider.id === 'jira') {
      const { jiraCredentials } = await getLocal(['jiraCredentials']);
      const credentials = (jiraCredentials || {})[domain];
      if (!credentials || !credentials.email || !credentials.token) {
        const message = `No Jira credentials configured for ${domain}. Add them in Settings → Jira credentials.`;
        Logger.error(message);
        await setMonitorError(monitor.id, 'missingCredentials', message);
        return;
      }
      deps.credentials = credentials;
    }

    const response = await fetch(apiUrl, {
      ...provider.buildFetchOptions(deps),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers?.get('Retry-After');
        rateLimitService.record(provider.id, retryAfter);
        const message = `Rate limited by ${provider.label} — will resume automatically`;
        Logger.error(`Rate limited by ${provider.label} for ${monitor.name} (Retry-After: ${retryAfter || 'missing'})`);
        await setMonitorError(monitor.id, 'rateLimit', message);
        return;
      }

      if (response.status === 401 && provider.id === 'jira') {
        const message = `Jira rejected the credentials for ${domain} — check Settings → Jira credentials`;
        Logger.error(message);
        await setMonitorError(monitor.id, 'auth', message);
        return;
      }

      Logger.error(`HTTP ${response.status} for ${monitor.name}`);
      if (response.status >= 500 && retryCount < maxRetries) {
        Logger.info(`Retrying ${monitor.name} (${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return checkEndpoint(monitor, settings, retryCount + 1);
      }
      await setMonitorError(monitor.id, 'http', `HTTP ${response.status} — will retry on the next check`);
      return;
    }

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      Logger.error(`Invalid JSON response for ${monitor.name}:`, parseError);
      await setMonitorError(monitor.id, 'http', 'Invalid response format — will retry on the next check');
      return;
    }
    const newCount = provider.parseCount(data);

    await clearMonitorError(monitor.id);

    const endpointCounts = await getEndpointCounts();
    const previousCount = endpointCounts.get(monitor.id) ?? -1;

    Logger.info(`${monitor.name}: ${newCount} tickets (was ${previousCount === -1 ? 'unknown' : previousCount})`);

    if (newCount > previousCount && previousCount >= 0) {
      const newTickets = newCount - previousCount;

      if (!(await snoozeService.isSnoozed())) {
        await notificationManager.notify({
          endpointId: monitor.id,
          endpointName: monitor.name,
          newTickets,
          totalCount: newCount,
          endpointUrl: monitor.url,
          providerId: provider.id,
          providerLabel: provider.label,
          providerFallbackUrl: provider.fallbackDashboardUrl(monitor.url),
          settings
        });
      } else {
        Logger.info(`Snoozed — skipping notification for ${monitor.name}`);
      }
    }

    endpointCounts.set(monitor.id, newCount);
    await saveEndpointCounts(endpointCounts);

  } catch (error) {
    Logger.error(`Error checking ${monitor.name}:`, error);

    if (retryCount < maxRetries && error.name !== 'AbortError') {
      Logger.info(`Retrying ${monitor.name} (${retryCount + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return checkEndpoint(monitor, settings, retryCount + 1);
    }

    const message = error.name === 'AbortError'
      ? `Timed out after 10 seconds — will retry on the next check`
      : `Network error — will retry on the next check`;
    Logger.error(`Endpoint ${monitor.name} ${error.name === 'AbortError' ? 'timed out after 10 seconds' : 'failed'}`);
    await setMonitorError(monitor.id, 'network', message);
  }
}
