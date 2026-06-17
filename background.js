// Handles periodic monitoring, notifications, and cookie authentication
import Logger from './utils/logger.js';
import * as snoozeService from './utils/snooze-service.js';
import * as notificationManager from './utils/notification-manager.js';
import * as cookieService from './utils/cookie-service.js';
import * as rateLimitService from './utils/rate-limit-service.js';
import { MessageRouter } from './utils/message-router.js';
import { getSession, setSession, getLocal } from './utils/storage-service.js';

// ─── Session State Helpers ────────────────────────────────────────────────────
// Service workers are ephemeral. All mutable state that must survive a SW
// restart must live in chrome.storage.session (cleared on browser close) or
// chrome.storage.local (persists across sessions). We use session for transient
// runtime state and local for durable user data.

const MIN_REFRESH_INTERVAL = 30000; // 30 seconds minimum between manual refreshes
// Snooze state managed by snooze-service.js
// Notification state managed by notification-manager.js
// Rate-limit state managed by rate-limit-service.js
// Storage operations delegated to utils/storage-service.js

/**
 * Read endpointCounts from session storage.
 * Stored as an array of [endpointId, count] pairs (Maps can't be stored directly).
 * @returns {Promise<Map<number, number>>}
 */
async function getEndpointCounts() {
  const { endpointCounts } = await getSession(['endpointCounts']);
  return new Map(Array.isArray(endpointCounts) ? endpointCounts : []);
}

/**
 * Persist endpointCounts to session storage.
 * @param {Map<number, number>} map
 */
async function saveEndpointCounts(map) {
  await setSession({ endpointCounts: Array.from(map.entries()) });
}

// ─── Snooze State ─────────────────────────────────────────────────────────────
// Managed by utils/snooze-service.js

// ─── Rate Limit ────────────────────────────────────────────────────────────────
// Managed by utils/rate-limit-service.js
//   rateLimitService.isLimited()
//   rateLimitService.record(retryAfterHeader)
//   rateLimitService.clear()
//   rateLimitService.rescheduleIfLimited()

// ─── initialize extension ─────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  Logger.info('Extension event:', details.reason);

  // Get existing data
  const { endpoints, settings } = await getLocal(['endpoints', 'settings']);

  // Only set defaults if data doesn't exist
  const updates = {};

  if (!endpoints || !Array.isArray(endpoints)) {
    updates.endpoints = [
      {
        id: Date.now(),
        name: 'My Tickets',
        url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+assignee:me+status:open',
        enabled: true
      }
    ];
    Logger.info('Setting default endpoints');
  } else {
    Logger.info(`Preserving ${endpoints.length} existing endpoints`);
  }

  if (!settings) {
    updates.settings = {
      checkInterval: 1,
      soundEnabled: true,
      notificationEnabled: true,
      darkMode: false,
      debugMode: false
    };
    Logger.info('Setting default settings');
  } else {
    // Add missing properties to existing settings
    let changed = false;
    if (!('darkMode' in settings)) {
      settings.darkMode = false;
      changed = true;
    }
    if (!('debugMode' in settings)) {
      settings.debugMode = false;
      changed = true;
    }
    if (changed) {
      updates.settings = settings;
    }
    Logger.info('Preserving existing settings');
  }

  // Initialize Logger with current setting
  const currentSettings = updates.settings || settings;
  if (currentSettings) {
    Logger.setDebugMode(currentSettings.debugMode);
  }

  // Only update storage if we have new data to set
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }

  // Initialize session state defaults
  await setSession({
    isEnabled: true,
    lastCheckTime: 0
  });

  // Restore snooze state from local storage if still valid
  await snoozeService.restoreSnooze();

  // Initialise notification manager (registers click handler)
  notificationManager.init();

  startMonitoring();
});

// ─── Alarm Handler ────────────────────────────────────────────────────────────
// Single dispatcher for all alarm types.

chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case 'snoozeEnd':
      await snoozeService.clearSnooze();
      await updateBadge();
      break;

    case 'rateLimitResume':
      rateLimitService.clear();
      await startMonitoring();
      break;

    case 'ticketCheck': {
      if (rateLimitService.isLimited()) {
        Logger.info('Skipping ticket check due to active Zendesk rate limiting');
        return;
      }
      const { isEnabled } = await getSession(['isEnabled']);
      if (isEnabled !== false) { // default to enabled if not set
        checkAllEndpoints();
      }
      break;
    }

    default:
      Logger.warn('Unknown alarm received:', alarm.name);
  }
});

// ─── Monitoring ───────────────────────────────────────────────────────────────

// Start the monitoring process
export async function startMonitoring() {
  Logger.info('Starting Zendesk monitoring');
  if (rateLimitService.isLimited()) {
    rateLimitService.rescheduleIfLimited();
    return;
  }

  // Get current settings to determine check interval
  const { settings } = await getLocal(['settings']);
  const interval = settings?.checkInterval || 1;

  // Create periodic alarm (minimum 1 minute)
  await chrome.alarms.create('ticketCheck', {
    periodInMinutes: Math.max(1, interval)
  });

  Logger.info(`Monitoring alarm created with ${Math.max(1, interval)} minute interval`);

  // Initial check
  checkAllEndpoints();
}

// Main function to check all configured endpoints
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

    // Check endpoints in parallel with concurrency control (max 3 at a time)
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

// Check a single endpoint with retry logic
export async function checkEndpoint(endpoint, settings, retryCount = 0) {
  const maxRetries = 2;
  try {
    Logger.info(`Checking endpoint: ${endpoint.name}`);

    // Get Zendesk domain from URL
    const url = new URL(endpoint.url);
    const domain = url.hostname;

    // Get authentication cookies (cached internally by cookieService)
    const cookies = await cookieService.getCookies(domain);
    if (!cookies) {
      Logger.error(`No Zendesk auth cookies for ${endpoint.name}. Please log in to ${domain} in your browser.`);
      return;
    }

    // Make API request with cookies
    const response = await fetch(endpoint.url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Cookie': cookies
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
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

    // Read the current count map from session storage
    const endpointCounts = await getEndpointCounts();
    const previousCount = endpointCounts.get(endpoint.id) ?? -1;

    Logger.info(`${endpoint.name}: ${newCount} tickets (was ${previousCount === -1 ? 'unknown' : previousCount})`);

    // Check if count increased compared to previous known count
    if (newCount > previousCount && previousCount >= 0) {
      const newTickets = newCount - previousCount;
      await notificationManager.notify({
        endpointId: endpoint.id,
        endpointName: endpoint.name,
        newTickets,
        totalCount: newCount,
        endpointUrl: endpoint.url,
        settings
      });
    }

    // Update stored count
    endpointCounts.set(endpoint.id, newCount);
    await saveEndpointCounts(endpointCounts);

    // Update badge with total count across all endpoints
    await updateBadge();

  } catch (error) {
    Logger.error(`Error checking ${endpoint.name}:`, error);

    // Retry logic:
    // - Retry on 5xx errors (already handled above)
    // - Retry on network errors (TypeError)
    // - Do NOT retry on timeouts (AbortError) to avoid prolonged delays
    if (retryCount < maxRetries && error.name !== 'AbortError') {
      Logger.info(`Retrying ${endpoint.name} (${retryCount + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return checkEndpoint(endpoint, settings, retryCount + 1);
    } else if (error.name === 'AbortError') {
      Logger.error(`Endpoint ${endpoint.name} timed out after 10 seconds`);
    }
  }
}

// Cookie retrieval delegated to utils/cookie-service.js

export async function updateBadge() {
  const endpointCounts = await getEndpointCounts();
  const totalCount = Array.from(endpointCounts.values()).reduce((sum, count) => sum + count, 0);

  // If notifications are snoozed, show special badge
  if (await snoozeService.isSnoozed()) {
    await chrome.action.setBadgeText({ text: '⏰' });
    await chrome.action.setBadgeBackgroundColor({ color: '#F39C12' }); // Orange
  } else {
    await chrome.action.setBadgeText({
      text: totalCount > 0 ? totalCount.toString() : ''
    });
    await chrome.action.setBadgeBackgroundColor({
      color: totalCount > 0 ? '#FF6B6B' : '#4ECDC4'
    });
  }
}

// ─── Message Router Setup ────────────────────────────────────────────────────
// Each handler is a function(request, sendResponse) registered by action name.

const router = new MessageRouter();

router.register('refreshNow', async (request, sendResponse) => {
  const { lastCheckTime = 0 } = await getSession(['lastCheckTime']);
  const now = Date.now();
  if (now - lastCheckTime < MIN_REFRESH_INTERVAL) {
    Logger.info('Refresh rate limited');
    sendResponse({
      success: false,
      error: 'Please wait 30 seconds before refreshing again'
    });
    return;
  }
  await setSession({ lastCheckTime: now });
  Logger.info('Manual refresh requested');
  checkAllEndpoints();
  sendResponse({ success: true });
});

router.register('toggleEnabled', async (request, sendResponse) => {
  await setSession({ isEnabled: request.enabled });
  Logger.info(`Monitoring ${request.enabled ? 'enabled' : 'disabled'}`);
  sendResponse({ success: true });
});

router.register('getStatus', async (request, sendResponse) => {
  const { isEnabled = true, lastCheckTime = 0 } = await getSession(['isEnabled', 'lastCheckTime']);
  const counts = Array.from((await getEndpointCounts()).entries());
  const snoozed = await snoozeService.isSnoozed();
  sendResponse({
    enabled: isEnabled,
    counts,
    lastCheck: lastCheckTime,
    isSnoozed: snoozed
  });
});

router.register('setSnooze', async (request, sendResponse) => {
  const result = await snoozeService.setSnooze(request.duration);
  await updateBadge();
  sendResponse(result);
});

router.register('clearSnooze', async (request, sendResponse) => {
  Logger.info('clearSnooze action received, clearing snooze...');
  const result = await snoozeService.clearSnooze();
  await updateBadge();
  Logger.info('clearSnooze completed, isSnoozed:', await snoozeService.isSnoozed());
  sendResponse(result);
});

router.register('getSnoozeStatus', async (request, sendResponse) => {
  const snoozed = await snoozeService.isSnoozed();
  const remainingTime = await snoozeService.getRemainingTime();
  Logger.info('getSnoozeStatus: isSnoozed=', snoozed, 'remainingTime=', remainingTime);
  sendResponse({
    isSnoozed: snoozed,
    remainingTime
  });
});

router.register('updateInterval', async (request, sendResponse) => {
  const interval = Math.max(1, request.interval);
  await chrome.alarms.clear('ticketCheck');
  await chrome.alarms.create('ticketCheck', {
    periodInMinutes: interval
  });
  Logger.info(`Alarm interval updated to ${interval} minutes`);
  sendResponse({ success: true });
});

// Wire the router
chrome.runtime.onMessage.addListener(router.createListener());

// ─── Storage Change Listener ──────────────────────────────────────────────────

// Handle changes to settings (like Debug Mode)
chrome.storage.onChanged.addListener((changes, area) => {
  snoozeService.handleStorageChange(changes, area);

  if (area === 'local' && changes.settings) {
    const newSettings = changes.settings.newValue;
    if (newSettings && 'debugMode' in newSettings) {
      Logger.setDebugMode(newSettings.debugMode);
      Logger.info('Debug mode updated:', newSettings.debugMode);
    }
  }
});

Logger.info('Zendesk Ticket Monitor background script loaded');
