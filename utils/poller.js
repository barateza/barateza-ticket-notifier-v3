// ─── Poller ───────────────────────────────────────────────────────────────────
//
// Core polling logic: iterates enabled monitors, checks each one with retry
// logic, compares ticket counts, and dispatches notifications. Provider-aware
// via the provider registry: each monitor's adapter supplies the polling URL,
// fetch options (cookies vs Basic auth), and count parsing.
// Does NOT handle alarm creation or badge updates — those belong in monitor.js.
// Does NOT know how to talk to a provider — utils/endpoint-source.js performs the
// read and owns the auth/error taxonomy; this module decides what an observed
// count *means*.
//
// Exported API (4 functions):
//   checkAllEndpoints()     — iterates enabled monitors with concurrency control
//   checkEndpoint()         — single-monitor check with retries
//   getAllCounts()          — raw [id, count] pairs (used by monitor.js for the badge)
//   getAllMonitorErrors()   — per-monitor error state for the popup
// ───────────────────────────────────────────────────────────────────────────────

import Logger from './logger.js';
import * as snoozeService from './snooze-service.js';
import * as notificationManager from './notification-manager.js';
import * as rateLimitService from './rate-limit-service.js';
import { getProvider } from './providers/provider-registry.js';
import { readMonitor } from './endpoint-source.js';
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

    const outcome = await readMonitor(monitor, provider);

    if (!outcome.ok) {
      // Rate limiting is the one failure with a side effect: it pauses the
      // provider for everyone until the window lifts.
      if (outcome.status === 'rate-limited') {
        rateLimitService.record(provider.id, outcome.retryAfter);
        Logger.error(`Rate limited by ${provider.label} for ${monitor.name} (Retry-After: ${outcome.retryAfter || 'missing'})`);
        await setMonitorError(monitor.id, 'rateLimit', outcome.message);
        return;
      }

      if (outcome.retryable && retryCount < maxRetries) {
        Logger.info(`Retrying ${monitor.name} (${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return checkEndpoint(monitor, settings, retryCount + 1);
      }

      Logger.error(`Endpoint ${monitor.name} failed: ${outcome.message}`);
      await setMonitorError(monitor.id, outcome.errorType, outcome.message);
      return;
    }

    await clearMonitorError(monitor.id);

    const newCount = outcome.count;

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
