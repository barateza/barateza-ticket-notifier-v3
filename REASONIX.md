# Zendesk Ticket Monitor Chrome Extension — AI Instructions

Manifest V3 Chrome extension that monitors Zendesk ticket API endpoints and notifies
via sound (beep or custom MP3 from myinstants.com) and browser notifications when
new tickets arrive. Uses cookie-based authentication (no API tokens).

## Quick Start

### For end users (non-developers)

1. **[Download v3.5.0](https://github.com/barateza/barateza-ticket-notifier-v3/archive/refs/tags/v3.5.0.zip)** — Extract the ZIP file
2. Open Chrome → `chrome://extensions/`
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked" and select the extracted folder
5. Login to Zendesk in your browser
6. Click the extension icon to configure endpoints

### For developers

```bash
git clone <repo>
pnpm install       # or npm install
pnpm test          # 182+ tests across 14 suites
pnpm test:coverage # coverage report
pnpm run build     # package extension into dist/
pnpm run lint      # eslint
pnpm run lint:fix  # auto-fix
```

**Load unpacked**: `chrome://extensions/` → Developer mode → Load unpacked → select repo root.

## Architecture

### Entry Points

| File | Role |
|------|------|
| `background.js` | Service worker — event wiring only (lifecycle, alarms, messages, storage). All logic delegated to `utils/`. |
| `offscreen.html` + `offscreen.js` | Audio playback (required by MV3 for Web Audio API). Supports `beep` (oscillator) and `mp3` (fetched URL via `decodeAudioData`). |
| `popup.html` + `popup.js` | Extension popup UI. Sub-modules handle settings, endpoints, snooze, updates, and I/O. |

### Utils Layer (`utils/`)

| Module | Responsibility |
|--------|---------------|
| `monitor.js` | Alarm creation, badge updates, orchestration of polling cycle |
| `poller.js` | Iterates enabled endpoints, fetches Zendesk API, compares counts, dispatches notifications |
| `notification-manager.js` | Sound playback (beep/MP3), browser notifications, click-to-navigate URL mapping |
| `cookie-service.js` | Zendesk cookie retrieval with 5-min in-memory cache |
| `message-router.js` | Handler registry replacing switch statements — each action string maps to a testable handler |
| `storage-service.js` | Centralised `chrome.storage.session` and `chrome.storage.local` wrappers |
| `snooze-service.js` | Persistent snooze with alarm-based wake, remaining-time tracking |
| `rate-limit-service.js` | 429 Retry-After parsing, exponential backoff, reschedule |
| `logger.js` | Configurable logging (console + debug mode toggle) |
| `endpoint-io.js` | Import/export endpoints as JSON files |
| `endpoint-schema.js` | Validation/sanitisation for endpoint objects |
| `validators.js` | URL format, settings bounds, import validation |
| `endpoint-export.js` | Serialisation helpers for endpoint export |
| `endpoint-import.js` | Deserialisation + merge logic for endpoint import |

### Data Flow

1. User adds endpoint (stored in `chrome.storage.local.endpoints`)
2. Background worker creates alarm, calls `checkAllEndpoints()` every N minutes
3. For each enabled endpoint: retrieve Zendesk cookies → fetch count → if count increased:
   - Play sound (via offscreen document)
   - Show notification with endpoint name and new ticket count
   - Store notification ID → endpoint URL mapping
4. Notification click opens Zendesk dashboard or specific endpoint

### Data Model

**`chrome.storage.local`** persists two keys:
- `endpoints` — array of `{id (timestamp), name, url, enabled}`
- `settings` — object:
  ```js
  {
    checkInterval: 1,           // 1-15 minutes
    soundEnabled: true,
    notificationEnabled: true,
    darkMode: false,
    debugMode: false,
    customSoundEnabled: false,  // use myinstants MP3 instead of beep
    customSoundUrl: '',         // myinstants.com page URL
    customSoundMp3: ''          // resolved MP3 URL
  }
  ```

**`chrome.storage.session`** persists runtime state:
- `isEnabled`, `lastCheckTime`, `endpointCounts`, `notificationEndpointMap`, snooze state

## Conventions & Patterns

### Code Style
- **Modules**: ES modules (`type: "module"` in service worker, `import`/`export` everywhere)
- **Async**: All storage/API operations are `async`/`await` — no callbacks
- **Error handling**: Every `fetch`/`storage`/`message` operation wrapped in try-catch; errors logged via `Logger`; user-facing errors via `showError()`/`showSuccess()` in popup
- **Naming**: `camelCase` for functions/variables, `PascalCase` for classes, `UPPER_SNAKE` for constants
- **File structure**: UI split into `popup-{subdomain}.js` files (settings, snooze, endpoints, updates, utils); background logic split into `utils/{service}.js` modules
- **Testing**: Jest with jsdom environment. Tests live in `__tests__/` alongside component files. E2E via Playwright.

### Message Passing
- Popup ↔ Background via `chrome.runtime.sendMessage({action, ...})`
- Background dispatches through `MessageRouter` (utils/message-router.js) — register handlers with `router.register(action, handler)`
- The `onMessage` listener returns `true` (keep channel open for async responses)
- Popup uses `sendToSW()` (popup-utils.js) which safely handles SW-terminated errors

### Authentication
- No API tokens. Extension has `"cookies"` permission scoped to `*://*.zendesk.com/*`
- `cookieService.getCookies(domain)` filters Zendesk auth cookies from the domain
- Cookies are sent as `Cookie` header in API requests + `credentials: 'include'`

### Adding Features
1. **New settings**: Add field to defaults in `background.js`, UI control in `popup.html`, load/save in `popup-settings.js`
2. **New message actions**: Register handler via `router.register()` in `background.js`; call from popup via `sendToSW()`
3. **Notification changes**: Edit `notification-manager.js` — notification format, sound type, click action
4. **Audio changes**: Edit `offscreen.js` — supports `beep` (oscillator) and `mp3` (fetched + decoded). New types need a branch in `playAudio()`

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

## Implementation Details

### Alarm & Check Interval
- Alarms created with `{periodInMinutes: 1}` minimum (actual interval based on user settings)
- `checkInterval` setting controls how often the alarm fires (1-15 minutes)

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
| `background.js` | Monitoring loop & notifications | `checkAllEndpoints()`, `checkEndpoint()`, `updateBadge()` |
| `popup.js` | UI state & event binding | `loadSettings()`, `loadEndpoints()`, `handleSaveEndpoint()` |
| `popup.html` | Layout & form elements | Modal for adding endpoints, settings checkboxes |
| `offscreen.js` | Audio playback | `playAudio()` using Web Audio API |
| `manifest.json` | Extension metadata | Permissions, service worker registration, icons |

## Testing & Debugging
- Enable debug logging by toggling debug mode in extension settings
- Console logs include: endpoint names, cookie count, API response status, notification events
- Test endpoints: Use public Zendesk demo or configure valid search queries
- To test notifications: Manually trigger alarm or call `chrome.alarms.get('ticketCheck')` in DevTools

## Common Extension Challenges (Manifest V3)

- No DOM in service worker; audio requires offscreen document
- Cookies permission scoped to specific domains
- Service worker terminates when idle; persistent data must use storage API
- Popup and background worker are separate execution contexts — use `chrome.runtime.sendMessage()` to communicate
- Storage reads may be async; always await `chrome.storage.local.get()`
- `chrome.cookies.getAll()` requires domain parameter; combine all cookies into single Cookie header

## Code Examples

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

**Step 4**: Load/save in `popup.js`:
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

```javascript
async function notifyNewTickets(endpointName, newTickets, totalCount, settings, endpoint) {
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
  else if (type === 'alert') {  // Two-tone alert
    const audioContext = new AudioContext();
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    osc1.frequency.setValueAtTime(900, audioContext.currentTime);
    osc1.stop(audioContext.currentTime + 0.1);
    
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
        type: 'alert',
        volume: 0.4 
      } 
    });
  } catch (error) {
    console.error('Error playing sound:', error);
  }
}
```

### Example 5: Filter Endpoints by Group Before Checking

```javascript
async function checkAllEndpoints() {
  console.log('Checking all endpoints...');
  try {
    const { endpoints, settings } = await chrome.storage.local.get(['endpoints', 'settings']);
    
    if (!endpoints || !Array.isArray(endpoints)) {
      console.log('No endpoints configured');
      return;
    }

    const priorityGroups = {
      critical: endpoints.filter(e => e.enabled && e.group === 'critical'),
      normal: endpoints.filter(e => e.enabled && e.group !== 'critical')
    };

    for (const endpoint of priorityGroups.critical) {
      await checkEndpoint(endpoint, settings);
    }
    for (const endpoint of priorityGroups.normal) {
      await checkEndpoint(endpoint, settings);
    }
  } catch (error) {
    console.error('Error checking endpoints:', error);
  }
}
```

## Commands Reference

```bash
pnpm test              # Jest unit tests (182+ passing)
pnpm test:watch        # Watch mode
pnpm test:coverage     # With coverage report
pnpm test:e2e          # Playwright E2E tests
pnpm run build         # Package into dist/barateza-ticket-notifier-*.zip
pnpm run lint          # ESLint check
pnpm run lint:fix      # ESLint auto-fix
```

## Documentation & Maintenance Strategy

### Core Documentation Structure

| File | Purpose | Audience |
|------|---------|----------|
| README.md | Features, Installation, Setup, API Reference, Troubleshooting | End Users & Developers |
| TESTING.md | Test Commands, Phase History, Coverage Reports, CI/CD Integration | Developers & QA |
| RELEASE.md | Versioning Strategy, Release Process, GitHub Actions Integration | Release Engineers |
| install-guide.html | Visual Installation Guide (HTML with styling) | Visual Learners |
| PRIVACY_POLICY.md | Privacy policy for Chrome Web Store | End Users |

### Test Badge Updates

The test count badge (`🧪 Tests Passing`) in README.md needs manual updates:

1. Run tests: `pnpm test`
2. Note the total passing test count
3. Update `README.md` badge URL: Change the count in the badge URL

**Timing**: On every new version release or after significant test additions.

### Pre-Release Checklist

1. **Update download links** in README.md
2. **Run tests**: `pnpm test`
3. **Update test badge** if count changed
4. **Verify install-guide.html** matches README.md
5. **Validate documentation links**
6. **Review RELEASE.md** for outdated version references

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues on `barateza/barateza-ticket-notifier-v3`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` at the root, one `docs/adr/` directory. See `docs/agents/domain.md`.
