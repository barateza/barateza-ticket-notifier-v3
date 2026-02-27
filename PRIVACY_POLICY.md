# Privacy Policy

**Last Updated:** February 26, 2026

This Privacy Policy explains how the Barateza Ticket Notifier Chrome Extension ("the Extension") collects, uses, and protects your information.

## 1. Information We Collect and Use

The Extension is designed to be privacy-first. **All data processing happens locally within your browser.** 

### Zendesk Ticket Data
The Extension reads your ticket counts and related ticket metadata from your Zendesk instance to provide you with notifications.

### Authentication Data Requirements
To function, the Extension requests **Host Permissions** for `*://*.zendesk.com/*`.

**Why we need this permission:**
The Extension requires access to your Zendesk domain to fetch ticket counts via the Zendesk API (`search.json`) and authenticate securely using your existing, active session cookies.

## 2. Information Storage

*   **Local Storage:** The Extension stores its configuration (such as your specific Zendesk sub-domain and notification preferences) locally on your device using Chrome's local storage API (`chrome.storage.local`).
*   **No Remote Servers:** We do **not** transmit, store, or process any of your Zendesk data, personal information, or authentication cookies on any external or third-party servers. All operations are strictly local between your browser and the Zendesk API.

## 3. Disclosing Information

We **do not** sell, trade, rent, or otherwise disclose your personal information, ticket data, or authentication details to any third parties. 

## 4. User Access and Control

Because all data is stored locally within your Chrome browser:
*   You have full control over your data.
*   You can delete all stored configuration and data at any time by uninstalling the Extension or clearing the Extension's local storage.
*   The Extension will only access your Zendesk data for as long as it is installed and enabled.

## 5. Security

We are committed to securing your data. The Extension communicates with the Zendesk API exclusively over secure, encrypted connections (HTTPS). Furthermore, by relying on your browser's native session cookies for authentication, the Extension avoids handling or storing your actual login credentials (such as your username or password).

## 6. Changes to This Policy

We may update this Privacy Policy from time to time to reflect changes in our practices or for operational, legal, or regulatory reasons. The latest version will always be available in the public repository and included with the Extension.

## 7. Contact Us

If you have any questions or concerns about this Privacy Policy or how the Extension handles your data, please open an issue in the public GitHub repository.
