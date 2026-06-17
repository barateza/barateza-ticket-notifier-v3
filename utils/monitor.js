// ─── Monitor ──────────────────────────────────────────────────────────────────
//
// Orchestrates the Zendesk ticket monitoring loop: alarm creation, endpoint
// checking with retry logic, count comparison, notification dispatch, and
// badge updates. Delegates to utility modules for cross-cutting concerns
// (cookies, storage, rate-limiting, snooze, notifications).
//
// Exported API (5 functions):
//   startMonitoring()   — creates the periodic alarm and runs an initial check
//   handleAlarmTick()   — called by background.js when ticketCheck alarm fires
//   checkAllEndpoints() — iterates enabled endpoints with concurrency control
//   checkEndpoint()     — single-endpoint check with retries
//   updateBadge()       — updates the extension icon badge
// ───────────────────────────────────────────────────────────────────────────────

import Logger from './logger.js';
import * as snoozeService from './snooze-service.js';
import * as notificationManager from './notification-manager.js';
import * as cookieService from './cookie-service.js';
import * as rateLimitService from './rate-limit-service.js';
import { getSession, getLocal, setSession } from './storage-service.js';

// ─── Count Persistence ────────────────────────────────────────────────────────

async function getEndpointCounts() {
  const { endpointCounts } = await getSession(['endpointCounts']);
  return new Map(Array.isArray(endpointCounts) ? endpointCounts : []);
}

async function saveEndpointCounts(map) {
  await setSession({ endpointCounts: Array.from(map.entries()) });
}

// ─── Start Monitoring ─────────────────────────────────────────────────────────

export async function startMonitoring() {
  Logger.info('Starting Zendesk monitoring');
  if (rateLimitService.isLimited()) {
    rateLimitService.rescheduleIfLimited();
    return;
  }

  const { settings } = await getLocal(['settings']);
  const interval = settings?.checkInterval || 1;

  await chrome.alarms.create('ticketCheck', {
    periodInMinutes: Math.max(1, interval)
  });

  Logger.info(`Monitoring alarm created with ${Math.max(1, interval)} minute interval`);

  // Initial check
  checkAllEndpoints();
}

// ─── Alarm Tick ───────────────────────────────────────────────────────────────

export async function handleAlarmTick() {
  if (rateLimitService.isLimited()) {
    Logger.info('Skipping ticket check due to active Zendesk rate limiting');
    return;
  }
  const { isEnabled } = await getSession(['isEnabled']);
  if (isEnabled !== false) {
    checkAllEndpoints();
  }
}

// ─── Check All Endpoints ──────────────────────────────────────────────────────

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

    const url = new URL(endpoint.url);
    const domain = url.hostname;

    const cookies = await cookieService.getCookies(domain);
    if (!cookies) {
      Logger.error(`No Zendesk auth cookies for ${endpoint.name}. Please log in to ${domain} in your browser.`);
      return;
    }

    const response = await fetch(endpoint.url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Cookie': cookies
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers?.get('Retry-After');
        rateLimitService.record(retryAfter);
        Logger.error(`Rate limited by Zendesk for ${endpoint.name} (Retry-After: ${retryAfter || 'missing'})`);
        return;
      }
      Logger.error(`HTTP ${response.status} for ${endpoint.name}`);
      if (response.status >= 500 && retryCount < maxRetries) {
        Logger.info(`Retrying ${endpoint.name} (${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return checkEndpoint(endpoint, settings, retryCount + 1);
      }
      return;
    }

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      Logger.error(`Invalid JSON response for ${endpoint.name}:`, parseError);
      return;
    }
    const newCount = data.count || 0;

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

    await updateBadge();

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

// ─── Badge ────────────────────────────────────────────────────────────────────

export async function updateBadge() {
  const endpointCounts = await getEndpointCounts();
  const totalCount = Array.from(endpointCounts.values()).reduce((sum, count) => sum + count, 0);

  if (await snoozeService.isSnoozed()) {
    await chrome.action.setBadgeText({ text: '⏰' });
    await chrome.action.setBadgeBackgroundColor({ color: '#F39C12' });
  } else {
    await chrome.action.setBadgeText({
      text: totalCount > 0 ? totalCount.toString() : ''
    });
    await chrome.action.setBadgeBackgroundColor({
      color: totalCount > 0 ? '#FF6B6B' : '#4ECDC4'
    });
  }
}
