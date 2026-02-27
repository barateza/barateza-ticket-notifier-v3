// Handles periodic monitoring, notifications, and cookie authentication
import Logger from './utils/logger.js';

// ─── Session State Helpers ────────────────────────────────────────────────────
// Service workers are ephemeral. All mutable state that must survive a SW
// restart must live in chrome.storage.session (cleared on browser close) or
// chrome.storage.local (persists across sessions). We use session for transient
// runtime state and local for durable user data.

const MIN_REFRESH_INTERVAL = 30000; // 30 seconds minimum between manual refreshes

/**
 * Batch-read keys from chrome.storage.session.
 * Returns a plain object with the requested keys (missing keys are undefined).
 * @param {string[]} keys
 * @returns {Promise<object>}
 */
async function getSessionState(keys) {
  return new Promise((resolve) => {
    chrome.storage.session.get(keys, (data) => resolve(data));
  });
}

/**
 * Batch-write data to chrome.storage.session.
 * @param {object} data
 * @returns {Promise<void>}
 */
async function setSessionState(data) {
  return new Promise((resolve) => {
    chrome.storage.session.set(data, resolve);
  });
}

/**
 * Batch-read keys from chrome.storage.local using callback-style (testable).
 * @param {string[]} keys
 * @returns {Promise<object>}
 */
async function getLocalState(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (data) => resolve(data));
  });
}

/**
 * Read endpointCounts from session storage.
 * Stored as an array of [endpointId, count] pairs (Maps can't be stored directly).
 * @returns {Promise<Map<number, number>>}
 */
async function getEndpointCounts() {
  const { endpointCounts } = await getSessionState(['endpointCounts']);
  return new Map(Array.isArray(endpointCounts) ? endpointCounts : []);
}

/**
 * Persist endpointCounts to session storage.
 * @param {Map<number, number>} map
 */
async function saveEndpointCounts(map) {
  await setSessionState({ endpointCounts: Array.from(map.entries()) });
}

/**
 * Read notificationEndpointMap from session storage.
 * Stored as an array of [notificationId, url] pairs.
 * @returns {Promise<Map<string, string>>}
 */
async function getNotificationMap() {
  const { notificationEndpointMap } = await getSessionState(['notificationEndpointMap']);
  return new Map(Array.isArray(notificationEndpointMap) ? notificationEndpointMap : []);
}

/**
 * Persist notificationEndpointMap to session storage.
 * @param {Map<string, string>} map
 */
async function saveNotificationMap(map) {
  await setSessionState({ notificationEndpointMap: Array.from(map.entries()) });
}

// ─── Snooze State ─────────────────────────────────────────────────────────────

/**
 * Re-hydrate snoozeEndTime from chrome.storage.local.
 * Called on SW wake-up before any operation that checks snoze.
 * Returns the snoozeEndTime (ms) or null if not snoozed / expired.
 */
async function rehydrateSnoozeEndTime() {
  const { snoozeState } = await getLocalState(['snoozeState']);
  if (snoozeState && snoozeState.endTime && snoozeState.endTime > Date.now()) {
    return snoozeState.endTime;
  }
  // Expired — clean up
  if (snoozeState) {
    await chrome.storage.local.remove('snoozeState');
  }
  return null;
}

// ─── initialize extension ─────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  Logger.info('Extension event:', details.reason);

  // Get existing data
  const { endpoints, settings } = await getLocalState(['endpoints', 'settings']);

  // Only set defaults if data doesn't exist
  const updates = {};

  if (!endpoints || !Array.isArray(endpoints)) {
    updates.endpoints = [
      {
        id: Date.now(),
        name: 'New AMER Tickets',
        url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+group:amer+assignee:none+status:new',
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
  await setSessionState({
    isEnabled: true,
    lastCheckTime: 0
  });

  // Restore snooze state from local storage if still valid
  const snoozeEndTime = await rehydrateSnoozeEndTime();
  if (snoozeEndTime) {
    const delay = snoozeEndTime - Date.now();
    chrome.alarms.create('snoozeEnd', { delayInMinutes: delay / 60000 });
    Logger.info('Restored snooze state from storage, ending at:', new Date(snoozeEndTime));
  }

  startMonitoring();
});

// ─── Handle snooze end alarm ──────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'snoozeEnd') {
    await clearSnooze();
  }
});

// ─── Snooze Functions ─────────────────────────────────────────────────────────

// Snooze notifications for a specific duration
export async function setSnooze(durationMinutes) {
  const now = Date.now();
  let snoozeEndTime;

  if (durationMinutes === 0) {
    // "Until I turn back on" - set snooze to a far future time
    snoozeEndTime = now + (1000 * 60 * 60 * 24 * 365); // 1 year
  } else {
    snoozeEndTime = now + (1000 * 60 * durationMinutes);
  }

  // Save snooze state to local storage (survives browser close)
  await chrome.storage.local.set({
    snoozeState: {
      endTime: snoozeEndTime,
      duration: durationMinutes
    }
  });

  // Schedule alarm to clear snooze
  if (durationMinutes > 0) {
    chrome.alarms.create('snoozeEnd', {
      delayInMinutes: durationMinutes
    });
  }

  Logger.info(`Notifications snoozed ${durationMinutes === 0 ? 'indefinitely' : `for ${durationMinutes} minutes`}`);

  // Update badge to indicate snooze state
  await updateBadge();

  return { success: true, endTime: snoozeEndTime };
}

// Clear snooze state
export async function clearSnooze() {
  await chrome.storage.local.remove('snoozeState');
  await chrome.alarms.clear('snoozeEnd');
  Logger.info('Notifications no longer snoozed');

  // Update badge
  await updateBadge();

  return { success: true };
}

// Check if notifications are currently snoozed
// NOTE: This is intentionally async to support re-hydration after SW restarts.
export async function isSnoozed() {
  const snoozeEndTime = await rehydrateSnoozeEndTime();
  return snoozeEndTime !== null;
}

// Get remaining snooze time in minutes
export async function getRemainingSnoozeTime() {
  const snoozeEndTime = await rehydrateSnoozeEndTime();
  if (!snoozeEndTime) return 0;
  return Math.ceil((snoozeEndTime - Date.now()) / 60000); // minutes
}

// ─── Monitoring ───────────────────────────────────────────────────────────────

// Start the monitoring process
export async function startMonitoring() {
  Logger.info('Starting Zendesk monitoring');

  // Get current settings to determine check interval
  const { settings } = await getLocalState(['settings']);
  const interval = settings?.checkInterval || 1;

  // Create periodic alarm (minimum 1 minute)
  await chrome.alarms.create('ticketCheck', {
    periodInMinutes: Math.max(1, interval)
  });

  Logger.info(`Monitoring alarm created with ${Math.max(1, interval)} minute interval`);

  // Initial check
  checkAllEndpoints();
}

// Handle alarm events
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'ticketCheck') {
    const { isEnabled } = await getSessionState(['isEnabled']);
    if (isEnabled !== false) { // default to enabled if not set
      checkAllEndpoints();
    }
  }
});

// Main function to check all configured endpoints
export async function checkAllEndpoints() {
  Logger.info('Checking all endpoints...');

  try {
    const { endpoints, settings } = await getLocalState(['endpoints', 'settings']);

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
        batch.map(endpoint => checkEndpoint(endpoint, settings))
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

    // Try to get authentication cookies
    const cookies = await getZendeskCookies(domain);

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
      Logger.error(`HTTP ${response.status} for ${endpoint.name}`);
      if (response.status >= 500 && retryCount < maxRetries) {
        Logger.info(`Retrying ${endpoint.name} (${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return checkEndpoint(endpoint, settings, retryCount + 1);
      }
      return;
    }

    const data = await response.json();
    const newCount = data.count || 0;

    // Read the current count map from session storage
    const endpointCounts = await getEndpointCounts();
    const previousCount = endpointCounts.get(endpoint.id) ?? -1;

    Logger.info(`${endpoint.name}: ${newCount} tickets (was ${previousCount === -1 ? 'unknown' : previousCount})`);

    // Check if count increased compared to previous known count
    if (newCount > previousCount && previousCount >= 0) {
      const newTickets = newCount - previousCount;
      await notifyNewTickets(endpoint.name, newTickets, newCount, settings, endpoint);
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

// Get Zendesk authentication cookies
export async function getZendeskCookies(domain) {
  try {
    const cookies = await chrome.cookies.getAll({
      domain: domain
    });

    // Filter for relevant authentication cookies
    const authCookies = cookies.filter(cookie =>
      cookie.name.includes('session') ||
      cookie.name.includes('auth') ||
      cookie.name.includes('_zendesk') ||
      cookie.name.includes('csrf') ||
      cookie.name === '_help_center_session'
    );

    // Build cookie string
    const cookieString = authCookies
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .join('; ');

    Logger.info(`Found ${authCookies.length} authentication cookies for ${domain}`);
    return cookieString;

  } catch (error) {
    Logger.error('Error getting cookies:', error);
    return '';
  }
}

// Send notifications when new tickets are found
export async function notifyNewTickets(endpointName, newTickets, totalCount, settings, endpoint) {
  // Check if notifications are snoozed (re-hydrates from storage on SW restart)
  if (await isSnoozed()) {
    Logger.info(`Notifications are snoozed - skipping notification for ${endpointName}`);
    return;
  }

  Logger.info(`New tickets detected: ${newTickets} new tickets in ${endpointName}`);

  // Play sound notification
  if (settings && settings.soundEnabled) {
    playNotificationSound();
  }

  // Show browser notification
  if (settings && settings.notificationEnabled) {
    const notificationId = `ticket-notification-${endpoint.id}-${Date.now()}`;
    const notificationOptions = {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: `New Zendesk Tickets: ${endpointName}`,
      message: `${newTickets} new ticket(s)\nTotal: ${totalCount} tickets`,
      priority: 2
    };

    // Persist notification → URL mapping in session storage
    const notifMap = await getNotificationMap();
    notifMap.set(notificationId, endpoint.url);
    await saveNotificationMap(notifMap);

    await chrome.notifications.create(notificationId, notificationOptions);
  }
}

// Play notification sound using offscreen document
export async function playNotificationSound() {
  try {
    await createOffscreen();
    await chrome.runtime.sendMessage({
      play: {
        type: 'beep',
        volume: 0.3
      }
    });
    Logger.info('Played notification sound');
  } catch (error) {
    Logger.error('Error playing sound:', error);
  }
}

// Create offscreen document for audio playback
export async function createOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play notification sounds for new Zendesk tickets'
  });
}

// Update extension badge with total ticket count
export async function updateBadge() {
  const endpointCounts = await getEndpointCounts();
  const totalCount = Array.from(endpointCounts.values()).reduce((sum, count) => sum + count, 0);

  // If notifications are snoozed, show special badge
  if (await isSnoozed()) {
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

// ─── Message Handler ──────────────────────────────────────────────────────────

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle async actions in a separate function
  (async () => {
    switch (request.action) {
      case 'refreshNow': {
        const { lastCheckTime = 0 } = await getSessionState(['lastCheckTime']);
        const now = Date.now();
        if (now - lastCheckTime < MIN_REFRESH_INTERVAL) {
          Logger.info('Refresh rate limited');
          sendResponse({
            success: false,
            error: 'Please wait 30 seconds before refreshing again'
          });
          return;
        }
        await setSessionState({ lastCheckTime: now });
        Logger.info('Manual refresh requested');
        checkAllEndpoints();
        sendResponse({ success: true });
        break;
      }

      case 'toggleEnabled': {
        await setSessionState({ isEnabled: request.enabled });
        Logger.info(`Monitoring ${request.enabled ? 'enabled' : 'disabled'}`);
        sendResponse({ success: true });
        break;
      }

      case 'getStatus': {
        const { isEnabled = true, lastCheckTime = 0 } = await getSessionState(['isEnabled', 'lastCheckTime']);
        const counts = Array.from((await getEndpointCounts()).entries());
        const snoozed = await isSnoozed();
        const snoozeEndTime = await rehydrateSnoozeEndTime();
        sendResponse({
          enabled: isEnabled,
          counts,
          lastCheck: lastCheckTime,
          isSnoozed: snoozed,
          snoozeEndTime
        });
        break;
      }

      case 'setSnooze': {
        const setSnoozeResponse = await setSnooze(request.duration);
        sendResponse(setSnoozeResponse);
        break;
      }

      case 'clearSnooze': {
        Logger.info('clearSnooze action received, clearing snooze...');
        const clearResponse = await clearSnooze();
        Logger.info('clearSnooze completed, isSnoozed:', await isSnoozed());
        sendResponse(clearResponse);
        break;
      }

      case 'getSnoozeStatus': {
        const snoozed = await isSnoozed();
        const remainingTime = await getRemainingSnoozeTime();
        const snoozeEndTime = await rehydrateSnoozeEndTime();
        Logger.info('getSnoozeStatus: isSnoozed=', snoozed, 'snoozeEndTime=', snoozeEndTime, 'remainingTime=', remainingTime);
        sendResponse({
          isSnoozed: snoozed,
          snoozeEndTime,
          remainingTime
        });
        break;
      }

      default:
        sendResponse({ error: 'Unknown action' });
    }
  })();

  return true; // Keep message channel open for async response
});

// ─── Notification Click ───────────────────────────────────────────────────────

// Handle notification clicks
chrome.notifications.onClicked.addListener(async (notificationId) => {
  Logger.info('Notification clicked:', notificationId);

  const notifMap = await getNotificationMap();
  const endpointUrl = notifMap.get(notificationId);

  if (endpointUrl) {
    chrome.tabs.create({ url: endpointUrl });
    notifMap.delete(notificationId);
    await saveNotificationMap(notifMap);
  } else {
    chrome.tabs.create({
      url: 'https://cpanel.zendesk.com/agent/dashboard'
    });
  }
  chrome.notifications.clear(notificationId);
});

// ─── Storage Change Listener ──────────────────────────────────────────────────

// Handle changes to settings (like Debug Mode)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    const newSettings = changes.settings.newValue;
    if (newSettings && 'debugMode' in newSettings) {
      Logger.setDebugMode(newSettings.debugMode);
      Logger.info('Debug mode updated:', newSettings.debugMode);
    }
  }
});

Logger.info('Zendesk Ticket Monitor background script loaded');
