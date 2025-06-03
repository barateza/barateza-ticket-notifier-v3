// Zendesk Ticket Monitor - Background Service Worker
// Handles periodic monitoring, notifications, and cookie authentication

let endpointCounts = new Map(); // Store previous counts for each endpoint
let isEnabled = true;

// Initialize extension
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Extension event:', details.reason);

  // Get existing data
  const { endpoints, settings } = await chrome.storage.local.get(['endpoints', 'settings']);

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
    console.log('Setting default endpoints');
  } else {
    console.log(`Preserving ${endpoints.length} existing endpoints`);
  }

  if (!settings) {
    updates.settings = {
      checkInterval: 1,
      soundEnabled: true,
      notificationEnabled: true
    };
    console.log('Setting default settings');
  } else {
    console.log('Preserving existing settings');
  }

  // Only update storage if we have new data to set
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }

  startMonitoring();
});

// Start the monitoring process
async function startMonitoring() {
  console.log('Starting Zendesk monitoring');

  // Create periodic alarm (minimum 1 minute)
  await chrome.alarms.create('ticketCheck', { 
    periodInMinutes: 1 
  });

  // Initial check
  checkAllEndpoints();
}

// Handle alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'ticketCheck' && isEnabled) {
    checkAllEndpoints();
  }
});

// Main function to check all configured endpoints
async function checkAllEndpoints() {
  console.log('Checking all endpoints...');

  try {
    const { endpoints, settings } = await chrome.storage.local.get(['endpoints', 'settings']);

    if (!endpoints || !Array.isArray(endpoints)) {
      console.log('No endpoints configured');
      return;
    }

    for (const endpoint of endpoints) {
      if (endpoint.enabled) {
        await checkEndpoint(endpoint, settings);
      }
    }
  } catch (error) {
    console.error('Error checking endpoints:', error);
  }
}

// Check a single endpoint
async function checkEndpoint(endpoint, settings) {
  try {
    console.log(`Checking endpoint: ${endpoint.name}`);

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
      }
    });

    if (!response.ok) {
      console.error(`HTTP ${response.status} for ${endpoint.name}`);
      return;
    }

    const data = await response.json();
    const newCount = data.count || 0;
    const previousCount = endpointCounts.get(endpoint.id) || 0;

    console.log(`${endpoint.name}: ${newCount} tickets (was ${previousCount})`);

    // Check if count increased
    if (newCount > previousCount && previousCount >= 0) {
      const newTickets = newCount - previousCount;
      await notifyNewTickets(endpoint.name, newTickets, newCount, settings);
    }

    // Update stored count
    endpointCounts.set(endpoint.id, newCount);

    // Update badge with total count across all endpoints
    updateBadge();

  } catch (error) {
    console.error(`Error checking ${endpoint.name}:`, error);
  }
}

// Get Zendesk authentication cookies
async function getZendeskCookies(domain) {
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

    console.log(`Found ${authCookies.length} authentication cookies for ${domain}`);
    return cookieString;

  } catch (error) {
    console.error('Error getting cookies:', error);
    return '';
  }
}

// Send notifications when new tickets are found
async function notifyNewTickets(endpointName, newTickets, totalCount, settings) {
  console.log(`New tickets detected: ${newTickets} new tickets in ${endpointName}`);

  // Play sound notification
  if (settings && settings.soundEnabled) {
    playNotificationSound();
  }

  // Show browser notification  
  if (settings && settings.notificationEnabled) {
    const notificationOptions = {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'New Zendesk Tickets!',
      message: `${newTickets} new ticket(s) in ${endpointName}\nTotal: ${totalCount} tickets`
    };

    await chrome.notifications.create(
      `ticket-notification-${Date.now()}`, 
      notificationOptions
    );
  }
}

// Play notification sound
// Play notification sound using offscreen document
async function playNotificationSound() {
  try {
    await createOffscreen();
    await chrome.runtime.sendMessage({ 
      play: { 
        type: 'beep', 
        volume: 0.3 
      } 
    });
    console.log('Played notification sound');
  } catch (error) {
    console.error('Error playing sound:', error);
  }
}

// Create offscreen document for audio playback
async function createOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play notification sounds for new Zendesk tickets'
  });
}

// Update extension badge with total ticket count
async function updateBadge() {
  const totalCount = Array.from(endpointCounts.values()).reduce((sum, count) => sum + count, 0);

  await chrome.action.setBadgeText({
    text: totalCount > 0 ? totalCount.toString() : ''
  });

  await chrome.action.setBadgeBackgroundColor({
    color: totalCount > 0 ? '#FF6B6B' : '#4ECDC4'
  });
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'refreshNow':
      console.log('Manual refresh requested');
      checkAllEndpoints();
      sendResponse({ success: true });
      break;

    case 'toggleEnabled':
      isEnabled = request.enabled;
      console.log(`Monitoring ${isEnabled ? 'enabled' : 'disabled'}`);
      sendResponse({ success: true });
      break;

    case 'getStatus':
      sendResponse({ 
        enabled: isEnabled,
        counts: Array.from(endpointCounts.entries())
      });
      break;

    default:
      sendResponse({ error: 'Unknown action' });
  }

  return true; // Keep message channel open for async response
});

// Handle notification clicks
chrome.notifications.onClicked.addListener((notificationId) => {
  console.log('Notification clicked:', notificationId);

  // Open Zendesk in new tab
  chrome.tabs.create({
    url: 'https://cpanel.zendesk.com/agent/dashboard'
  });

  // Clear the notification
  chrome.notifications.clear(notificationId);
});

console.log('Zendesk Ticket Monitor background script loaded');
