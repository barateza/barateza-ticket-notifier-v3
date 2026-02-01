# Zendesk Ticket Monitor Chrome Extension - AI Instructions

## Project Overview
This is a Manifest V3 Chrome extension that monitors Zendesk ticket API endpoints and notifies users via sound and browser notifications when new tickets arrive. It uses cookie-based authentication (no API tokens) and manages multiple monitored endpoints with configurable check intervals.

## Architecture

### Core Components

**Background Service Worker** (`background.js`)
- Runs periodic checks using Chrome Alarms API (minimum 1-minute interval, user-configurable)
- Maintains `endpointCounts` Map to track previous ticket counts per endpoint
- Calls `checkAllEndpoints()` on each alarm tick
- For each endpoint: fetches cookies → makes Zendesk API call → compares counts → triggers notifications
- Manages `notificationEndpointMap` to associate notification IDs with endpoint URLs for click handling

**Popup UI** (`popup.js` + `popup.html`)
- Displays monitored endpoints, settings, and control buttons
- Syncs UI state with `chrome.storage.local`: endpoints array and settings object
- Event handlers use global `window` scope for functions (e.g., `window.toggleEndpoint()`)
- Settings changes trigger alarm recreation if interval changed

**Offscreen Document** (`offscreen.html` + `offscreen.js`)
- Required by Manifest V3 for audio playback via Web Audio API
- Receives `chrome.runtime.sendMessage()` with `{play: {type, volume}}` payload
- Creates oscillator beep (800→600 Hz, 300ms duration)

### Data Flow
1. User adds endpoint (stored in `chrome.storage.local.endpoints`)
2. Background worker creates alarm, calls `checkAllEndpoints()` every N minutes
3. For each enabled endpoint: retrieve Zendesk cookies → fetch count → if count increased:
   - Play sound (via offscreen document)
   - Show notification with endpoint name and new ticket count
   - Store notification ID → endpoint URL mapping
4. Notification click opens Zendesk dashboard or specific endpoint

## Key Developer Patterns

### Authentication (No API Tokens)
- Extension has `"cookies"` permission scoped to `*://*.zendesk.com/*`
- `getZendeskCookies(domain)` filters for session/auth/CSRF cookies by name
- API requests include cookies in `Cookie` header AND `credentials: 'include'`
- **Pattern**: Always extract domain from endpoint URL before requesting cookies

### Storage & State Management
- All persistent data in `chrome.storage.local`: `endpoints` array and `settings` object
- Each endpoint has: `{id (timestamp), name, url, enabled}`
- Settings object: `{checkInterval (1-15 min), soundEnabled, notificationEnabled}`
- In-memory `endpointCounts` Map restored only on startup; survives page refreshes but not service worker termination

### Message Passing (Background ↔ Popup)
- Popup sends messages with `chrome.runtime.sendMessage({action, ...})`
- Background handler: `chrome.runtime.onMessage.addListener()` with switch on `action` field
- Main actions: `'refreshNow'`, `'toggleEnabled'`, `'getStatus'`
- **Pattern**: Always return `true` at end of message listener to keep channel open for async operations

### Error Handling
- All fetch/storage/message operations wrapped in try-catch
- Errors logged to console; UI shows user-friendly error messages via `showError()` and `showSuccess()`
- Missing or invalid data gracefully defaults (e.g., no endpoints shows "No endpoints configured")

### Endpoint Validation
- URLs must be full Zendesk API search endpoints (e.g., `https://domain.zendesk.com/api/v2/search.json?query=...`)
- **Extracting domain**: `new URL(endpoint.url).hostname`
- **Response parsing**: Expected JSON response has `count` property (integer)

## Zendesk API Search Syntax

The extension monitors Zendesk Search API (`/api/v2/search.json`). Common query parameters:

**Ticket Type & Status**
```
type:ticket+status:new                    # New tickets
type:ticket+status:open                   # Open tickets
type:ticket+status:pending                # Awaiting response
type:ticket+status:on-hold+status:new     # New OR on-hold
```

**Assignment & Group**
```
assignee:none                             # Unassigned
assignee:me                               # Assigned to current user
group:amer                                # Specific group
group:"support team"                      # Group with spaces
```

**Priority & SLA**
```
priority:high+priority:urgent             # High or urgent
priority:low                              # Low priority
is:unsolved+has_incidents:true            # Has related incidents
```

**Time-based**
```
created>2024-01-01                        # Created after date
updated<2024-01-15                        # Updated before date
created:[2024-01-01 TO 2024-01-31]       # Date range
```

**Combined Example** (from default endpoint):
```
https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+group:amer+assignee:none+status:new
```

**Important**: Query parameters must be URL-encoded. Spaces become `+`, special chars use `%XX`.

## Critical Implementation Details

### Alarm & Check Interval
- Alarms created with `{periodInMinutes: 1}` minimum (actual interval based on user settings)
- `checkInterval` setting ignored during alarm creation—always runs on 1-min cycles
- **Issue**: This is hardcoded; actual interval should use `periodInMinutes: settings.checkInterval`
- All intervals are 1-minute regardless of user setting (settings only appear in UI)

### Notification Click Handler
- `chrome.notifications.onClicked.addListener()` receives `notificationId`
- Looks up endpoint URL from `notificationEndpointMap`; if found, opens tab with that URL
- Falls back to Zendesk dashboard if mapping missing

### Badge Counter
- `updateBadge()` sums all endpoint counts and displays on extension icon
- Badge color: red (#FF6B6B) if count > 0, teal (#4ECDC4) if count = 0

### Endpoint Enable/Disable
- `endpoint.enabled` boolean; disabled endpoints skipped in `checkAllEndpoints()` loop
- UI buttons: toggle/delete operations reload endpoint list via `loadEndpoints()`

## File-Specific Patterns

| File | Primary Purpose | Key Functions |
|------|-----------------|----------------|
| `background.js` | Monitoring loop & notifications | `checkAllEndpoints()`, `checkEndpoint()`, `getZendeskCookies()` |
| `popup.js` | UI state & event binding | `loadSettings()`, `loadEndpoints()`, `handleSaveEndpoint()` |
| `popup.html` | Layout & form elements | Modal for adding endpoints, settings checkboxes |
| `offscreen.js` | Audio playback | `playAudio()` using Web Audio API |
| `manifest.json` | Extension metadata | Permissions, service worker registration, icons |

## Testing & Debugging

- Enable debug logging: Open Chrome DevTools → Service Workers tab → Inspect background worker
- Console logs include: endpoint names, cookie count, API response status, notification events
- Test endpoints: Use public Zendesk demo or configure valid search queries
- To test notifications: Manually trigger alarm or call `chrome.alarms.get('ticketCheck')` in DevTools

## Common Extension Challenges

**Manifest V3 Constraints**
- No DOM in service worker; audio requires offscreen document
- Cookies permission scoped to specific domains
- Service worker terminates when idle; persistent data must use storage API

**Cross-Context Communication**
- Popup and background worker are separate execution contexts
- Use `chrome.runtime.sendMessage()` to communicate; not direct function calls
- Storage reads may be async; always await `chrome.storage.local.get()`

**Cookie Retrieval**
- `chrome.cookies.getAll()` requires domain parameter
- Returns all cookies for domain; filter by name to find auth cookies
- Zendesk uses multiple session/CSRF cookies; combine all into single Cookie header

## When Adding Features

1. **New Settings**: Add property to `settings` object, UI control in `popup.html`, listener in `popup.js`, usage in background checks
2. **New Endpoint Actions**: Add case to `chrome.runtime.onMessage` switch in `background.js`
3. **Notification Customization**: Modify `notificationOptions` object in `notifyNewTickets()`
4. **Audio Changes**: Update `playAudio()` in `offscreen.js` (oscillator frequency, duration, volume)
5. **Icon Update**: Regenerate PNG files from `icons/icon-generator.html` and update manifest paths if needed

## Badge Maintenance

The README contains status badges that require periodic updates:

### Dynamic Badges (Auto-updated by GitHub Actions)
- **Build Status Badge**: Uses GitHub native workflow badge—automatically reflects current CI/CD status. No manual updates needed.

### Static Badges (Manual Update Required)
- **Test Count Badge**: Currently shows "69 passing". **Update this badge on every version bump or when test count changes:**
  1. Run tests: `npm test`
  2. Note the total passing test count from the output
  3. Update `README.md` badge URL: Change `69%20passing` to `[NEW_COUNT]%20passing` in the tests badge URL
  4. Recommended timing: Do this when releasing a new version (tag push) or after merging significant test additions

**Timing Strategy**:
- **Per-push**: If you want real-time accuracy, update test badge on every push to main/master after running tests
- **Per-release**: If you prefer less frequent updates, update only when creating a new version tag (recommended for stability)

**Example update**:
```markdown
# Before
[![🧪 Tests Passing](https://img.shields.io/badge/tests-69%20passing-brightgreen?style=flat-square&logo=jest)]

# After (if 75 tests pass)
[![🧪 Tests Passing](https://img.shields.io/badge/tests-75%20passing-brightgreen?style=flat-square&logo=jest)]
```

## Code Examples for Common Modifications

### Example 1: Add a New Setting (e.g., Desktop Notifications)

**Step 1**: Update `background.js` initialization:
```javascript
if (!settings) {
  updates.settings = {
    checkInterval: 1,
    soundEnabled: true,
    notificationEnabled: true,
    desktopNotifications: true  // NEW
  };
}
```

**Step 2**: Add UI control in `popup.html`:
```html
<div class="setting">
  <label>
    <input type="checkbox" id="desktopNotifications"> 
    Desktop notifications
  </label>
</div>
```

**Step 3**: Bind event listener in `popup.js`:
```javascript
function setupEventListeners() {
  // ... existing listeners ...
  document.getElementById('desktopNotifications').addEventListener('change', saveSettings);
}
```

**Step 4**: Load/save in `popup.js` `loadSettings()` and `saveSettings()`:
```javascript
async function loadSettings() {
  if (settings) {
    document.getElementById('desktopNotifications').checked = settings.desktopNotifications !== false;
  }
}

async function saveSettings() {
  const settings = {
    // ... existing ...
    desktopNotifications: document.getElementById('desktopNotifications').checked
  };
  await chrome.storage.local.set({ settings });
}
```

### Example 2: Add a New Endpoint Action (e.g., Clear All Counts)

**In `background.js` message listener**:
```javascript
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'refreshNow':
      checkAllEndpoints();
      sendResponse({ success: true });
      break;

    case 'clearAllCounts':  // NEW
      endpointCounts.clear();
      updateBadge();
      console.log('Cleared all endpoint counts');
      sendResponse({ success: true });
      break;

    // ... other cases ...
  }
  return true;
});
```

**In `popup.js` to trigger it**:
```javascript
document.getElementById('clearCountsBtn').addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ action: 'clearAllCounts' });
    showSuccess('Counts cleared');
  } catch (error) {
    showError('Failed to clear counts');
  }
});
```

### Example 3: Customize Notification Format

**In `background.js` `notifyNewTickets()`**:
```javascript
async function notifyNewTickets(endpointName, newTickets, totalCount, settings, endpoint) {
  // BEFORE:
  // const notificationOptions = {
  //   type: 'basic',
  //   iconUrl: 'icons/icon48.png',
  //   title: `New Zendesk Tickets: ${endpointName}`,
  //   message: `${newTickets} new ticket(s)\nTotal: ${totalCount} tickets`,
  //   priority: 2
  // };

  // MODIFIED: Show endpoint URL and priority badge
  const notificationOptions = {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: `🎫 ${endpointName}`,
    message: `+${newTickets} ticket(s) | Total: ${totalCount}\n${new URL(endpoint.url).hostname}`,
    priority: 2,
    requireInteraction: true  // Keep notification until user dismisses
  };

  const notificationId = `ticket-notification-${endpoint.id}-${Date.now()}`;
  notificationEndpointMap.set(notificationId, endpoint.url);
  await chrome.notifications.create(notificationId, notificationOptions);
}
```

### Example 4: Add Different Audio Tones

**In `offscreen.js` `playAudio()`**:
```javascript
function playAudio({ type, volume = 0.3 }) {
  if (type === 'beep') {
    // Original beep (800→600 Hz)
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
    gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  } 
  else if (type === 'alert') {  // NEW: Two-tone alert
    const audioContext = new AudioContext();
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // First tone: 900 Hz for 100ms
    osc1.frequency.setValueAtTime(900, audioContext.currentTime);
    osc1.frequency.setValueAtTime(900, audioContext.currentTime + 0.1);
    osc1.stop(audioContext.currentTime + 0.1);
    
    // Second tone: 600 Hz for 100ms (after 50ms delay)
    osc2.frequency.setValueAtTime(600, audioContext.currentTime + 0.15);
    osc2.stop(audioContext.currentTime + 0.25);
    
    gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    
    osc1.start(audioContext.currentTime);
    osc2.start(audioContext.currentTime + 0.15);
  }
}
```

**Then call in `background.js`**:
```javascript
async function playNotificationSound() {
  try {
    await createOffscreen();
    await chrome.runtime.sendMessage({ 
      play: { 
        type: 'alert',  // Use new alert tone
        volume: 0.4 
      } 
    });
  } catch (error) {
    console.error('Error playing sound:', error);
  }
}
```

### Example 5: Filter Endpoints by Group Before Checking

**In `background.js` `checkAllEndpoints()`**:
```javascript
async function checkAllEndpoints() {
  console.log('Checking all endpoints...');
  try {
    const { endpoints, settings } = await chrome.storage.local.get(['endpoints', 'settings']);
    
    if (!endpoints || !Array.isArray(endpoints)) {
      console.log('No endpoints configured');
      return;
    }

    // NEW: Group endpoints by category and check high-priority first
    const priorityGroups = {
      critical: endpoints.filter(e => e.enabled && e.group === 'critical'),
      normal: endpoints.filter(e => e.enabled && e.group !== 'critical')
    };

    // Check critical group first
    for (const endpoint of priorityGroups.critical) {
      await checkEndpoint(endpoint, settings);
    }
    // Then check normal endpoints
    for (const endpoint of priorityGroups.normal) {
      await checkEndpoint(endpoint, settings);
    }
  } catch (error) {
    console.error('Error checking endpoints:', error);
  }
}
```

**Requires adding `group` field to endpoint objects in storage (defaults to 'normal')**.

