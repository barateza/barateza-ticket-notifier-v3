// Handles extension lifecycle events, alarm dispatch, message routing,
// and storage change propagation. All monitoring logic lives in
// utils/monitor.js — this file is pure event wiring.
import Logger from './utils/logger.js';
import * as snoozeService from './utils/snooze-service.js';
import * as notificationManager from './utils/notification-manager.js';
import * as rateLimitService from './utils/rate-limit-service.js';
import { MessageRouter } from './utils/message-router.js';
import { getSession, setSession, getLocal } from './utils/storage-service.js';
import { migrate, needsMigration } from './utils/settings.js';
import { playAudio } from './utils/offscreen-document.js';
import { resolveSoundSource, SOUND_PAGE_PREFIX } from './utils/sound-source.js';
import {
  startMonitoring,
  handleAlarmTick,
  updateBadge
} from './utils/monitor.js';
import {
  checkAllEndpoints,
  checkEndpoint
} from './utils/poller.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_REFRESH_INTERVAL = 30000; // 30 seconds minimum between manual refreshes

// ─── Extension Install / Init ─────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  Logger.info('Extension event:', details.reason);

  const { endpoints, settings: storedSettings } = await getLocal(['endpoints', 'settings']);
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

  // Defaults and migration are owned by utils/settings.js — this handler only
  // decides whether a write is needed.
  if (needsMigration(storedSettings)) {
    updates.settings = migrate(storedSettings);
    Logger.info(storedSettings ? 'Migrating settings to current defaults' : 'Setting default settings');
  } else {
    Logger.info('Preserving existing settings');
  }

  const currentSettings = updates.settings || storedSettings;
  if (currentSettings) {
    Logger.setDebugMode(currentSettings.debugMode);
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }

  await setSession({ isEnabled: true, lastCheckTime: 0 });
  await snoozeService.restoreSnooze();
  notificationManager.init();

  startMonitoring();
});

// ─── Alarm Handler ────────────────────────────────────────────────────────────

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

    case 'ticketCheck':
      await handleAlarmTick();
      break;

    default:
      Logger.warn('Unknown alarm received:', alarm.name);
  }
});

// ─── Message Router ───────────────────────────────────────────────────────────

const router = new MessageRouter();

router.register('refreshNow', async (request, sendResponse) => {
  const { lastCheckTime = 0 } = await getSession(['lastCheckTime']);
  const now = Date.now();
  if (now - lastCheckTime < MIN_REFRESH_INTERVAL) {
    sendResponse({ success: false, error: 'Please wait 30 seconds before refreshing again' });
    return;
  }
  await setSession({ lastCheckTime: now });
  Logger.info('Manual refresh requested');
  await checkAllEndpoints();
  sendResponse({ success: true });
});

router.register('toggleEnabled', async (request, sendResponse) => {
  await setSession({ isEnabled: request.enabled });
  Logger.info(`Monitoring ${request.enabled ? 'enabled' : 'disabled'}`);
  sendResponse({ success: true });
});

router.register('getStatus', async (request, sendResponse) => {
  const { isEnabled = true, lastCheckTime = 0 } = await getSession(['isEnabled', 'lastCheckTime']);
  const { endpointCounts = [] } = await getSession(['endpointCounts']);
  const counts = Array.isArray(endpointCounts) ? endpointCounts : [];
  const snoozed = await snoozeService.isSnoozed();
  sendResponse({ enabled: isEnabled, counts, lastCheck: lastCheckTime, isSnoozed: snoozed });
});

router.register('setSnooze', async (request, sendResponse) => {
  const result = await snoozeService.setSnooze(request.duration);
  await updateBadge();
  sendResponse(result);
});

router.register('clearSnooze', async (request, sendResponse) => {
  const result = await snoozeService.clearSnooze();
  await updateBadge();
  sendResponse(result);
});

router.register('getSnoozeStatus', async (request, sendResponse) => {
  const snoozed = await snoozeService.isSnoozed();
  const remainingTime = await snoozeService.getRemainingTime();
  sendResponse({ isSnoozed: snoozed, remainingTime });
});

router.register('updateInterval', async (request, sendResponse) => {
  const interval = Math.max(1, request.interval);
  await chrome.alarms.clear('ticketCheck');
  await chrome.alarms.create('ticketCheck', { periodInMinutes: interval });
  Logger.info(`Alarm interval updated to ${interval} minutes`);
  sendResponse({ success: true });
});

// ─── Notification Queue Handlers ──────────────────────────────────────────────

router.register('getNotifications', async (request, sendResponse) => {
  const pending = await notificationManager.getPendingNotifications();
  sendResponse({ notifications: pending });
});

router.register('acknowledgeNotification', async (request, sendResponse) => {
  await notificationManager.acknowledgeNotification(request.notificationId);
  sendResponse({ success: true });
});

router.register('acknowledgeAllNotifications', async (request, sendResponse) => {
  await notificationManager.acknowledgeAllNotifications();
  sendResponse({ success: true });
});

// ─── Custom Sound Handlers ─────────────────────────────────────────────────────

router.register('resolveSoundUrl', async (request, sendResponse) => {
  try {
    const myinstantsUrl = request.myinstantsUrl;
    if (!myinstantsUrl || !myinstantsUrl.startsWith(SOUND_PAGE_PREFIX)) {
      sendResponse({ success: false, error: 'Please enter a valid myinstants.com URL' });
      return;
    }

    Logger.info('Fetching myinstants URL:', myinstantsUrl);
    const { mp3Url, soundName } = await resolveSoundSource(myinstantsUrl);

    Logger.info(`Resolved myinstants sound: ${soundName} -> ${mp3Url}`);
    sendResponse({ success: true, mp3Url, soundName });
  } catch (error) {
    Logger.error('Error resolving myinstants URL:', error);
    sendResponse({ success: false, error: error.message || 'Failed to resolve sound URL' });
  }
});

router.register('playTestSound', async (request, sendResponse) => {
  try {
    await playAudio({ type: 'mp3', url: request.mp3Url, volume: 0.3 });
    Logger.info('Played test sound:', request.mp3Url);
    sendResponse({ success: true });
  } catch (error) {
    Logger.error('Error playing test sound:', error);
    sendResponse({ success: false, error: error.message || 'Failed to play test sound' });
  }
});

chrome.runtime.onMessage.addListener(router.createListener());

// ─── Storage Change Listener ──────────────────────────────────────────────────

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

// ─── Re-exports for backward compatibility (tests) ────────────────────────────
export { startMonitoring, handleAlarmTick, checkAllEndpoints, checkEndpoint, updateBadge };
