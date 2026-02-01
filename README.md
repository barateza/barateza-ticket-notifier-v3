# Zendesk Ticket Monitor Chrome Extension

A Chrome extension that monitors Zendesk ticket endpoints and notifies you with sound and/or popup notifications when new tickets are found. Compatible with Manifest V3 and uses existing browser cookies for authentication.

[![🧪 Tests Passing](https://img.shields.io/badge/tests-69%20passing-brightgreen?style=flat-square&logo=jest)](https://github.com/gilsonsiqueira/barateza-ticket-notifier-v3/__tests__/)
[![✅ Build Status](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square&logo=github)](https://github.com/gilsonsiqueira/barateza-ticket-notifier-v3/actions/workflows/coverage.yml)
[![📦 Node Support](https://img.shields.io/badge/node-%E2%89%A518.0-brightgreen?style=flat-square)](#)
[![🔷 Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square)](#)

## Features

- ✅ **Manifest V3 Compatible** - Uses service workers for background functionality
- 🔔 **Sound & Visual Notifications** - Get alerted when new tickets arrive
- 🍪 **Cookie Authentication** - Uses your existing Zendesk login, no API tokens needed
- ⚙️ **Multiple Endpoints** - Monitor multiple Zendesk search queries simultaneously
- ⏱️ **Configurable Intervals** - Check every 1-15 minutes (minimum 60 seconds)
- 🔄 **Manual Refresh** - Force refresh all endpoints instantly
- 📊 **Live Badge Counter** - Shows total ticket count on extension icon
- 🎛️ **Easy Management** - Simple popup interface for adding/removing endpoints

## Installation

### Method 1: Load Unpacked Extension (Development)

1. **Download the extension files** to a folder on your computer
2. **Generate the icons**:
   - Open `icons/icon-generator.html` in your browser
   - Right-click each canvas and save as PNG:
     - 16x16 canvas → `icon16.png`
     - 48x48 canvas → `icon48.png`
     - 128x128 canvas → `icon128.png`
   - Save all PNG files in the `icons/` directory
3. **Load the extension**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the folder containing the extension files
4. **Verify installation** - You should see the Zendesk Monitor icon in your toolbar

### Method 2: Pack Extension (Advanced)

1. Follow steps 1-2 above to prepare files
2. In `chrome://extensions/`, click "Pack extension"
3. Select the extension directory
4. Install the generated `.crx` file

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

```
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

### Settings

- **Sound Notifications**: Enable/disable notification sounds
- **Browser Notifications**: Enable/disable popup notifications
- **Check Interval**: Set how often to check for new tickets (1-15 minutes)

## How It Works

### Authentication
The extension uses your existing Zendesk session cookies for authentication. This means:
- ✅ No API tokens required
- ✅ No additional login needed
- ✅ Works with SSO and 2FA
- ⚠️ Requires you to be logged into Zendesk in the same browser

### Monitoring Process
1. **Background Service Worker** runs periodic checks using Chrome Alarms API
2. **Cookie Retrieval** gets your Zendesk authentication cookies
3. **API Requests** are made to your configured endpoints with cookies
4. **Count Tracking** compares new results with previous counts
5. **Notifications** are triggered when counts increase

### Notification System
- **Badge**: Extension icon shows total ticket count across all endpoints
- **Sound**: Configurable audio notification using Web Audio API
- **Popup**: Browser notification with ticket details
- **Click Action**: Notifications open your Zendesk dashboard

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
```
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

```
zendesk-ticket-monitor/
├── manifest.json          # Extension configuration
├── background.js           # Service worker for monitoring
├── popup.html             # Extension popup interface
├── popup.css              # Popup styling
├── popup.js               # Popup functionality
├── icons/
│   ├── icon16.png         # 16x16 icon
│   ├── icon48.png         # 48x48 icon
│   ├── icon128.png        # 128x128 icon
│   ├── icon.svg           # Source SVG icon
│   └── icon-generator.html # Tool to generate PNG icons
└── README.md              # This file
```

## Contributing

Feel free to submit issues, feature requests, or pull requests to improve this extension.

## License

This project is provided as-is for educational and development purposes.

## Changelog

### Version 1.0
- Initial release
- Manifest V3 compatibility
- Cookie-based authentication
- Multiple endpoint support
- Sound and visual notifications
- Configurable check intervals
- Manual refresh functionality