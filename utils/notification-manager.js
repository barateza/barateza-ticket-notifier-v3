// ─── NotificationManager ─────────────────────────────────────────────────────────
//
// Encapsulates notification creation, sound playback, notification-to-URL
// mapping, and click handling. Background calls one function: notify().
//
// Interface (1 public method):
//   notify({ endpointName, newTickets, totalCount, endpointUrl, settings })
//
// Internal:
//   playSound()         — creates offscreen document, sends beep message
//   createNotification() — chrome.notifications.create + URL map persistence
//   click handler        — chrome.notifications.onClicked lookup + navigate

import Logger from './logger.js';
import { getSession, setSession } from './storage-service.js';

let creatingOffscreenPromise = null;

// ─── Notification History (session storage) ────────────────────────────────────

const HISTORY_KEY = 'notificationHistory';

async function getHistory() {
  const { [HISTORY_KEY]: history } = await getSession([HISTORY_KEY]);
  return Array.isArray(history) ? history : [];
}

async function saveHistory(history) {
  await setSession({ [HISTORY_KEY]: history });
}

/**
 * Return unacknowledged notifications, newest first.
 */
export async function getPendingNotifications() {
  const history = await getHistory();
  return history.filter(n => !n.acknowledged).reverse();
}

/**
 * Mark a notification as acknowledged and clear its Chrome notification.
 * If the notification has already been cleared (chrome.notifications.clear
 * is safe to call on non-existent IDs) this still removes it from the queue.
 */
export async function acknowledgeNotification(notificationId) {
  const history = await getHistory();
  const idx = history.findIndex(n => n.id === notificationId);
  if (idx !== -1) {
    history[idx].acknowledged = true;
    await saveHistory(history);
  }
  // Clear the Chrome notification regardless
  chrome.notifications.clear(notificationId);
}

/**
 * Acknowledge all pending notifications at once.
 */
export async function acknowledgeAllNotifications() {
  const history = await getHistory();
  const pendingIds = [];
  for (const n of history) {
    if (!n.acknowledged) {
      n.acknowledged = true;
      pendingIds.push(n.id);
    }
  }
  await saveHistory(history);
  for (const id of pendingIds) {
    chrome.notifications.clear(id);
  }
}

// ─── Notification Map (session storage) ────────────────────────────────────────

async function getNotificationMap() {
  const { notificationEndpointMap } = await getSession(['notificationEndpointMap']);
  return new Map(Array.isArray(notificationEndpointMap) ? notificationEndpointMap : []);
}

async function saveNotificationMap(map) {
  await setSession({ notificationEndpointMap: Array.from(map.entries()) });
}

// ─── Offscreen / Sound ─────────────────────────────────────────────────────────

async function createOffscreen() {
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

async function playSound(settings) {
  try {
    await createOffscreen();

    const playOptions = { volume: 0.3 };

    if (settings?.customSoundEnabled && settings?.customSoundMp3) {
      playOptions.type = 'mp3';
      playOptions.url = settings.customSoundMp3;
      Logger.info('Playing custom sound:', settings.customSoundMp3);
    } else {
      playOptions.type = 'beep';
    }

    await chrome.runtime.sendMessage({ play: playOptions });
    Logger.info('Played notification sound');
  } catch (error) {
    Logger.error('Error playing sound:', error);
  }
}

// ─── Notification Click Handler ────────────────────────────────────────────────

function handleNotificationClick(notificationId) {
  // Use an IIFE so the listener doesn't need to be async
  (async () => {
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
  })();
}

// ─── Exported API ──────────────────────────────────────────────────────────────

/**
 * Initialise the notification manager — registers the click handler.
 * Call once on background startup.
 */
export function init() {
  chrome.notifications.onClicked.addListener(handleNotificationClick);
}

/**
 * Send a notification for new ticket events.
 * Handles sound playback, notification creation,
 * and URL mapping persistence.
 *
 * @param {object} opts
 * @param {number|string} opts.endpointId
 * @param {string} opts.endpointName
 * @param {number} opts.newTickets
 * @param {number} opts.totalCount
 * @param {string} opts.endpointUrl
 * @param {object} opts.settings
 */
export async function notify({ endpointId, endpointName, newTickets, totalCount, endpointUrl, settings }) {
  Logger.info(`New tickets detected: ${newTickets} new tickets in ${endpointName}`);

  // Play sound notification
  if (settings && settings.soundEnabled) {
    await playSound(settings);
  }

  // Show browser notification
  if (settings && settings.notificationEnabled) {
    const notificationId = `ticket-notification-${endpointId}-${Date.now()}`;
    const notificationOptions = {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: `New Zendesk Tickets: ${endpointName}`,
      message: `${newTickets} new ticket(s)\nTotal: ${totalCount} tickets`,
      priority: 2
    };

    // Persist notification → URL mapping in session storage
    const notifMap = await getNotificationMap();
    notifMap.set(notificationId, endpointUrl);
    await saveNotificationMap(notifMap);

    // Persist notification in history for the popup queue
    const history = await getHistory();
    history.push({
      id: notificationId,
      endpointName,
      newTickets,
      totalCount,
      endpointUrl,
      timestamp: Date.now(),
      acknowledged: false
    });
    // Keep max 50 entries to avoid quota issues
    if (history.length > 50) history.splice(0, history.length - 50);
    await saveHistory(history);

    await chrome.notifications.create(notificationId, notificationOptions);
  }
}
