// ─── Monitor ──────────────────────────────────────────────────────────────────
//
// Orchestrates the Zendesk ticket monitoring cycle: alarm management,
// polling dispatch, and badge updates.
// Delegates the fetch/parse/compare loop to utils/poller.js.
//
// Exported API (3 functions):
//   startMonitoring()   — creates the periodic alarm and runs an initial check
//   handleAlarmTick()   — called by background.js when ticketCheck alarm fires
//   updateBadge()       — updates the extension icon badge
// ───────────────────────────────────────────────────────────────────────────────

import Logger from './logger.js';
import * as snoozeService from './snooze-service.js';
import * as rateLimitService from './rate-limit-service.js';
import { getSession, getLocal } from './storage-service.js';
import { checkAllEndpoints, getAllCounts } from './poller.js';

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

  // Initial check + badge update
  await checkAllEndpoints();
  await updateBadge();
}

// ─── Alarm Tick ───────────────────────────────────────────────────────────────

export async function handleAlarmTick() {
  if (rateLimitService.isLimited()) {
    Logger.info('Skipping ticket check due to active Zendesk rate limiting');
    return;
  }
  const { isEnabled } = await getSession(['isEnabled']);
  if (isEnabled !== false) {
    await checkAllEndpoints();
    await updateBadge();
  }
}

// ─── Badge ────────────────────────────────────────────────────────────────────

export async function updateBadge() {
  const counts = await getAllCounts();
  const totalCount = counts.reduce((sum, [, count]) => sum + count, 0);

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
