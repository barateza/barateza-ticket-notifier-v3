// ─── Poller ───────────────────────────────────────────────────────────────────
//
// Core polling logic: iterates enabled endpoints, checks each one with retry
// logic, compares ticket counts, and dispatches notifications.
// Does NOT handle alarm creation or badge updates — those belong in monitor.js.
// Does NOT know how to talk to Zendesk — that belongs in endpoint-source.js; this
// module decides what an observed count *means*.
//
// Exported API (3 functions):
//   checkAllEndpoints() — iterates enabled endpoints with concurrency control
//   checkEndpoint()     — single-endpoint check with retries
//   getAllCounts()      — raw [id, count] pairs (used by monitor.js for the badge)
// ───────────────────────────────────────────────────────────────────────────────

import Logger from './logger.js';
import * as snoozeService from './snooze-service.js';
import * as notificationManager from './notification-manager.js';
import * as rateLimitService from './rate-limit-service.js';
import { readEndpoint } from './endpoint-source.js';
import { getSession, getLocal, setSession } from './storage-service.js';

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

// ─── Check All ────────────────────────────────────────────────────────────────

export async function checkAllEndpoints() {
  Logger.info('Checking all endpoints...');
  if (rateLimitService.isLimited()) {
    Logger.info('Skipping endpoint checks due to active Zendesk rate limiting');
    return;
  }

  try {
    const { endpoints, settings } = await getLocal(['endpoints', 'settings']);

    if (!endpoints || !Array.isArray(endpoints)) {
      Logger.info('No endpoints configured');
      return;
    }

    const enabledEndpoints = endpoints.filter(endpoint => endpoint.enabled);
    const concurrency = 3;

    for (let i = 0; i < enabledEndpoints.length; i += concurrency) {
      const batch = enabledEndpoints.slice(i, i + concurrency);
      await Promise.all(
        batch.map(endpoint => checkEndpoint(endpoint, settings, 0))
      );
    }

    Logger.info(`Completed checking ${enabledEndpoints.length} endpoints`);
  } catch (error) {
    Logger.error('Error checking endpoints:', error);
  }
}

// ─── Check Single Endpoint ────────────────────────────────────────────────────

export async function checkEndpoint(endpoint, settings, retryCount = 0) {
  const maxRetries = 2;
  try {
    Logger.info(`Checking endpoint: ${endpoint.name}`);

    const outcome = await readEndpoint(endpoint.url);

    if (!outcome.ok) {
      // Rate limiting is the one failure with a side effect: it pauses everything.
      if (outcome.status === 'rate-limited') {
        rateLimitService.record(outcome.retryAfter);
        Logger.error(`Rate limited by Zendesk for ${endpoint.name} (Retry-After: ${outcome.retryAfter || 'missing'})`);
        return;
      }

      if (outcome.status === 'http-error') {
        Logger.error(`HTTP ${outcome.httpStatus} for ${endpoint.name}`);
      }
      // unauthenticated / timed-out / malformed / network-error are logged by
      // endpoint-source.js, which knows what the failure actually was.

      if (outcome.retryable && retryCount < maxRetries) {
        Logger.info(`Retrying ${endpoint.name} (${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return checkEndpoint(endpoint, settings, retryCount + 1);
      }
      return;
    }

    const newCount = outcome.count;

    const endpointCounts = await getEndpointCounts();
    const previousCount = endpointCounts.get(endpoint.id) ?? -1;

    Logger.info(`${endpoint.name}: ${newCount} tickets (was ${previousCount === -1 ? 'unknown' : previousCount})`);

    if (newCount > previousCount && previousCount >= 0) {
      const newTickets = newCount - previousCount;

      if (!(await snoozeService.isSnoozed())) {
        await notificationManager.notify({
          endpointId: endpoint.id,
          endpointName: endpoint.name,
          newTickets,
          totalCount: newCount,
          endpointUrl: endpoint.url,
          settings
        });
      } else {
        Logger.info(`Snoozed — skipping notification for ${endpoint.name}`);
      }
    }

    endpointCounts.set(endpoint.id, newCount);
    await saveEndpointCounts(endpointCounts);

  } catch (error) {
    Logger.error(`Error checking ${endpoint.name}:`, error);

    if (retryCount < maxRetries && error.name !== 'AbortError') {
      Logger.info(`Retrying ${endpoint.name} (${retryCount + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return checkEndpoint(endpoint, settings, retryCount + 1);
    } else if (error.name === 'AbortError') {
      Logger.error(`Endpoint ${endpoint.name} timed out after 10 seconds`);
    }
  }
}
