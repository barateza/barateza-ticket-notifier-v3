// Handles extension lifecycle events, alarm dispatch, message routing,
// and storage change propagation. All monitoring logic lives in
// utils/monitor.js — this file is pure event wiring.
import Logger from './utils/logger.js';
import * as snoozeService from './utils/snooze-service.js';
import * as notificationManager from './utils/notification-manager.js';
import * as rateLimitService from './utils/rate-limit-service.js';
import { MessageRouter } from './utils/message-router.js';
import { getSession, setSession, getLocal } from './utils/storage-service.js';
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

  const { endpoints, settings } = await getLocal(['endpoints', 'settings']);
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
      debugMode: false,
      customSoundEnabled: false,
      customSoundUrl: '',
      customSoundMp3: ''
    };
    Logger.info('Setting default settings');
  } else {
    let changed = false;
    if (!('darkMode' in settings)) { settings.darkMode = false; changed = true; }
    if (!('debugMode' in settings)) { settings.debugMode = false; changed = true; }
    if (!('customSoundEnabled' in settings)) { settings.customSoundEnabled = false; changed = true; }
    if (!('customSoundUrl' in settings)) { settings.customSoundUrl = ''; changed = true; }
    if (!('customSoundMp3' in settings)) { settings.customSoundMp3 = ''; changed = true; }
    if (changed) { updates.settings = settings; }
    Logger.info('Preserving existing settings');
  }

  const currentSettings = updates.settings || settings;
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

// ─── Custom Sound Handlers ─────────────────────────────────────────────────────

router.register('resolveSoundUrl', async (request, sendResponse) => {
  try {
    const myinstantsUrl = request.myinstantsUrl;
    if (!myinstantsUrl || !myinstantsUrl.startsWith('https://www.myinstants.com/')) {
      sendResponse({ success: false, error: 'Please enter a valid myinstants.com URL' });
      return;
    }

    Logger.info('Fetching myinstants URL:', myinstantsUrl);
    const response = await fetch(myinstantsUrl, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) {
      sendResponse({ success: false, error: `Failed to fetch sound page (HTTP ${response.status})` });
      return;
    }

    const html = await response.text();

    // Find the "Download MP3" link: href="/media/sounds/...mp3"
    const match = html.match(/\/media\/sounds\/[^"']+\.mp3/);
    if (!match) {
      sendResponse({ success: false, error: 'Could not find a downloadable MP3 on that page' });
      return;
    }

    const mp3Path = match[0];
    const mp3Url = `https://www.myinstants.com${mp3Path}`;
    const soundName = mp3Path.split('/').pop().replace('.mp3', '');

    Logger.info(`Resolved myinstants sound: ${soundName} -> ${mp3Url}`);
    sendResponse({ success: true, mp3Url, soundName });
  } catch (error) {
    Logger.error('Error resolving myinstants URL:', error);
    sendResponse({ success: false, error: error.message || 'Failed to resolve sound URL' });
  }
});

router.register('playTestSound', async (request, sendResponse) => {
  try {
    await createOffscreenForSound();
    await chrome.runtime.sendMessage({
      play: { type: 'mp3', url: request.mp3Url, volume: 0.3 }
    });
    Logger.info('Played test sound:', request.mp3Url);
    sendResponse({ success: true });
  } catch (error) {
    Logger.error('Error playing test sound:', error);
    sendResponse({ success: false, error: error.message || 'Failed to play test sound' });
  }
});

// Helper: create offscreen doc for audio playback
let creatingOffscreenPromise = null;

async function createOffscreenForSound() {
  if (await chrome.offscreen.hasDocument()) return;
  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }
  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play notification sounds for new Zendesk tickets'
  });
  try {
    await creatingOffscreenPromise;
  } finally {
    creatingOffscreenPromise = null;
  }
}

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
