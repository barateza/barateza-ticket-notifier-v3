# Zendesk Ticket Monitor Chrome Extension

A Chrome extension that monitors Zendesk ticket endpoints and notifies you with sound and/or popup notifications when new tickets are found. Compatible with Manifest V3 and uses existing browser cookies for authentication.

[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/barateza/barateza-ticket-notifier-v3?style=flat-square)](https://github.com/barateza/barateza-ticket-notifier-v3/releases/latest)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square)
[![Tests Passing](https://img.shields.io/badge/tests-92%20passing-brightgreen?style=flat-square&logo=jest)](https://github.com/barateza/barateza-ticket-notifier-v3/tree/main/__tests__)
[![Code Coverage](https://github.com/barateza/barateza-ticket-notifier-v3/actions/workflows/coverage.yml/badge.svg)](https://github.com/barateza/barateza-ticket-notifier-v3/actions/workflows/coverage.yml)
[![CodeQL](https://github.com/barateza/barateza-ticket-notifier-v3/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/barateza/barateza-ticket-notifier-v3/actions/workflows/github-code-scanning/codeql)
[![Dependabot](https://img.shields.io/badge/dependabot-enabled-brightgreen?style=flat-square&logo=dependabot)](https://github.com/barateza/barateza-ticket-notifier-v3/security/dependabot)
![Node Support](https://img.shields.io/badge/node-%E2%89%A518.0-brightgreen?style=flat-square)
![Works on My Machine](https://img.shields.io/badge/works%20on%20my%20machine-✓-brightgreen?style=flat-square)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/K3K81TDYEL)

## Quick Start

### Download & Install (2 minutes)

1. **[Download v3.3.0](https://github.com/barateza/barateza-ticket-notifier-v3/releases/download/v3.3.0/barateza-ticket-notifier-3.3.0.zip)** - Extract the ZIP file to your computer
2. **Open Chrome** and go to `chrome://extensions/`
3. **Enable "Developer mode"** (toggle in the top right)
4. **Click "Load unpacked"** and select the extracted folder
5. **Login to Zendesk** in your browser
6. **Click the extension icon** to configure your first endpoint

👉 See [full setup guide](#installation) below for detailed instructions and alternative methods.

## Features

- ✅ **Manifest V3 Compatible** - Uses service workers for background functionality
- 🔔 **Sound & Visual Notifications** - Get alerted when new tickets arrive
- 🍪 **Cookie Authentication** - Uses your existing Zendesk login, no API tokens needed
- ⚙️ **Multiple Endpoints** - Monitor multiple Zendesk search queries simultaneously
- 📥 **Import/Export** - Backup and restore your endpoint configurations via JSON
- ⏱️ **Configurable Intervals** - Check every 1-15 minutes (minimum 60 seconds)
- 🔄 **Manual Refresh** - Force refresh all endpoints instantly
- 🌙 **Dark Mode Support** - Sleek dark theme optimized for low-light environments
- ⏸️ **Snooze Notifications** - Pause notifications for a configurable duration (or indefinitely)
- 📊 **Live Badge Counter** - Shows total ticket count on extension icon
- 🛠️ **Persistent State** - Maintains monitoring state across service worker restarts
- 📝 **Logger Utility** - Centralized logging with configurable debug mode
- 🎛️ **Easy Management** - Simple popup interface for adding/removing endpoints
## Installation

### Method 1: Load Unpacked Extension (Development)

1. **Download the extension files** to a folder on your computer
2. **Load the extension**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the folder containing the extension files
3. **Verify installation** - You should see the Zendesk Monitor icon in your toolbar

### Method 2: Pack Extension (Advanced)

1. In `chrome://extensions/`, click "Pack extension"
2. Select the extension directory
3. Install the generated `.crx` file

## Setup & Configuration

### Initial Setup

1. **Login to Zendesk** in your browser first (this creates the necessary cookies)
2. **Click the extension icon** to open the popup
3. **Configure your first endpoint**:
   - The extension comes with a default example endpoint
   - Click "Add Endpoint" to add your own
   - Enter a descriptive name and your Zendesk search URL

### Adding Zendesk Endpoints

The extension monitors Zendesk Search API endpoints. Here are some examples:

``` text
# New unassigned tickets in AMER group
https://your-domain.zendesk.com/api/v2/search.json?query=type:ticket+group:amer+assignee:none+status:new

# High priority tickets
https://your-domain.zendesk.com/api/v2/search.json?query=type:ticket+priority:high+status:open

# Tickets assigned to you
https://your-domain.zendesk.com/api/v2/search.json?query=type:ticket+assignee:me+status:open

# Recent tickets (last 24 hours)
https://your-domain.zendesk.com/api/v2/search.json?query=type:ticket+created>2024-01-01
```

**Important**: Replace `your-domain` with your actual Zendesk subdomain (e.g., `company.zendesk.com`).

### Importing & Exporting
You can backup or share your configured endpoints:
1. Click the **Export** (📥) button to download your current endpoints as a `.json` file.
2. Click the **Import** (📤) button to load endpoints from a previously exported `.json` file. The extension will automatically merge them and skip any duplicates.

### Settings

- **Sound Notifications**: Enable/disable notification sounds
- **Browser Notifications**: Enable/disable popup notifications
- **Check Interval**: Set how often to check for new tickets (1-15 minutes)
- **Dark Mode**: Toggle between light and dark theme

### Snooze Notifications

Temporarily pause all notifications for a configurable duration:

- **Duration Options**: 15, 30, 60 minutes, or indefinitely ("until I turn back on")
- **Countdown Display**: Shows remaining snooze time in the popup
- **Manual Cancel**: Clear snooze at any time to resume notifications immediately
- **Use Case**: Perfect for meetings, focus time, or when you'll handle tickets manually

## How It Works

### Authentication

The extension uses your existing Zendesk session cookies for authentication. This means:

- ✅ No API tokens required
- ✅ No additional login needed
- ✅ Works with SSO and 2FA
- ⚠️ Requires you to be logged into Zendesk in the same browser

### Monitoring Process

1. **Background Service Worker** runs periodic checks using Chrome Alarms API
2. **Offscreen Document** (Manifest V3 requirement) handles audio playback via Web Audio API
3. **Cookie Retrieval** gets your Zendesk authentication cookies
4. **API Requests** are made to your configured endpoints with cookies
5. **Count Tracking** compares new results with previous counts
6. **Notifications** are triggered when counts increase (unless snoozed)

### Notification System

- **Badge**: Extension icon shows total ticket count across all endpoints
- **Sound**: Configurable audio notification using Web Audio API (offscreen document)
- **Popup**: Browser notification with ticket details
- **Click Action**: Notifications open your Zendesk dashboard
- **Snooze**: Temporarily pause all notifications

### Manifest V3 Architecture

- **Service Worker** runs in background for monitoring and notification management
- **Offscreen Document** required for audio playback (Manifest V3 constraint)
- **Chrome Storage API** for persistent settings and endpoint configuration
- **Chrome Alarms API** for reliable periodic checks (survives extension reload)

## Troubleshooting

### No Tickets Detected

- Ensure you're logged into Zendesk in the same browser
- Check that your search URL returns results when opened directly
- Verify the endpoint URL is correct and accessible
- Check browser console for error messages

### Authentication Issues

- Make sure you're logged into your Zendesk instance
- Try refreshing your Zendesk session
- Check if your Zendesk session has expired
- Verify the domain in your endpoint URL matches your Zendesk instance

### Notifications Not Working

- Check that browser notifications are enabled for Chrome
- Verify notification permissions in Chrome settings
- Ensure sound is enabled in extension settings
- Check that the extension is not paused

### Performance Issues

- Increase check interval if monitoring many endpoints
- Limit the number of active endpoints
- Check Zendesk API rate limits

## API Reference

### Zendesk Search API Format

``` text
https://your-domain.zendesk.com/api/v2/search.json?query=SEARCH_QUERY
```

### Common Search Parameters

- `type:ticket` - Only tickets
- `status:new|open|pending|solved|closed` - Ticket status
- `priority:low|normal|high|urgent` - Priority level
- `assignee:none|me|user@email.com` - Assignment
- `group:group_name` - Group assignment
- `created>YYYY-MM-DD` - Creation date
- `updated>YYYY-MM-DD` - Last update date
- `has_incidents:true` - Tickets with related incidents

### URL Encoding

When adding endpoints manually:

- Spaces in query parameters become `+` (automatically handled by most tools)
- Special characters should be URL-encoded (e.g., `&` → `%26`)
- Group/assignee names with spaces use quotes: `group:"support team"`

### Expected Response Format

```json
{
  "results": [...],
  "count": 5,
  "next_page": null,
  "previous_page": null
}
```

The extension monitors the `count` field for changes.

## Privacy & Security

- **No Data Collection**: The extension doesn't collect or transmit your data
- **Local Storage Only**: All settings stored locally in your browser
- **Cookie Access**: Only accesses cookies for configured Zendesk domains
- **Minimal Permissions**: Requests only necessary Chrome extension permissions

## File Structure

``` text
zendesk-ticket-monitor/
├── manifest.json          # Extension configuration
├── background.js          # Service worker for monitoring
├── offscreen.html         # Offscreen document for audio (Manifest V3)
├── offscreen.js           # Audio playback via Web Audio API
├── popup.html             # Extension popup interface
├── popup.css              # Popup styling
├── popup.js               # Popup functionality
├── icons/
│   ├── icon16.png         # 16x16 icon
│   ├── icon48.png         # 48x48 icon
│   └── icon128.png        # 128x128 icon
└── README.md              # This file
```

## Contributing

Feel free to submit issues, feature requests, or pull requests to improve this extension.

## License

This project is provided as-is for educational and development purposes.

## Changelog

### Version 3.3.0

- 📥 **Import/Export**: Added JSON Import/Export capability for endpoint configurations.
- 🎨 **URL Display**: Endpoint URLs are now fully displayed with text wrapping instead of being truncated.

### Version 3.2.3

- 🐛 **Update Link Fixed**: Made the update available notification properly clickable.

### Version 3.2.2

- 🎨 **Dark Mode**: Fixed contrast ratios and accessibility for dark theme (WCAG AA)
- 🔧 **Offscreen Fix**: Resolved "Unexpected token 'export'" error in offscreen document
- 📱 **Dynamic UI**: Version number in popup now automatically retrieves from manifest
- ✅ **Tests**: Expanded test suite to 92 passing tests

### Version 3.2.0

- 🔄 **Session Persistence**: State now survives service worker termination via `chrome.storage.session`
- 📋 **Privacy Policy**: Added official privacy documentation for store compliance
- 🛠️ **Diagnostics**: New Logger utility and user-configurable Debug Mode
- 🚀 **Automation**: Added release packaging script for consistent deployments

### Version 3.1.1

- 🔒 **Security**: Fixed CodeQL "Incomplete URL substring sanitization" warnings
- 🔒 **Security**: Implemented explicit URL validation following OWASP recommendations
- ✅ Improved hostname validation to prevent domain spoofing
- ✅ Replaced regex patterns with explicit component checking
- ✅ Enhanced URL parsing for API endpoint validation
- ✅ All 69 tests passing with improved security coverage

### Version 3.0.0

- Snooze notification feature (configurable duration or indefinite)
- Dark mode theme support
- Enhanced error handling and recovery
- Comprehensive test coverage (68+ passing tests)
- Improved UI with better status indicators
- Bug fixes and performance optimizations

### Version 1.0

- Initial release
- Manifest V3 compatibility
- Cookie-based authentication
- Multiple endpoint support
- Sound and visual notifications
- Configurable check intervals
- Manual refresh functionality
