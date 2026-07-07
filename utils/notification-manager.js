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

    await chrome.notifications.create(notificationId, notificationOptions);
  }
}
