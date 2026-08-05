# Privacy Policy

**Last Updated:** February 26, 2026

This Privacy Policy explains how the Barateza Ticket Notifier Chrome Extension ("the Extension") collects, uses, and protects your information.

## 1. Information We Collect and Use

The Extension is designed to be privacy-first. **All data processing happens locally within your browser.** 

### Zendesk Ticket Data
The Extension reads your ticket counts and related ticket metadata from your Zendesk instance to provide you with notifications.

### Jira (JSM) Ticket Data
The Extension also reads ticket counts from your Jira Service Management (JSM) Cloud sites (`*.atlassian.net`) when you add Jira monitors. Counts are fetched via the Jira Cloud REST API (`search/approximate-count`).

### Authentication Data Requirements
To function, the Extension requests **Host Permissions** for `*://*.zendesk.com/*` and `*://*.atlassian.net/*`.

**Why we need these permissions:**
The Extension requires access to your Zendesk domain to fetch ticket counts via the Zendesk API (`search.json`) and authenticate securely using your existing, active session cookies. Jira sites are accessed using an **Atlassian API token** that you provide: the Extension sends it as HTTP Basic authentication to your Jira site only, and never to any other server.

## 2. Information Storage

*   **Local Storage:** The Extension stores its configuration (such as your specific Zendesk sub-domain, Jira sites, and notification preferences) locally on your device using Chrome's local storage API (`chrome.storage.local`).
*   **Jira API tokens:** Your Atlassian email and API token are stored locally on your machine using `chrome.storage.local`. Chrome extension storage is not encrypted — anyone with access to your device and browser profile could read them, so treat the token as a credential. Tokens are **never** transmitted to us or to any server other than the Jira site you configured, and are sent only over HTTPS.
*   **No Remote Servers:** We do **not** transmit, store, or process any of your Zendesk data, Jira data, personal information, or authentication cookies on any external or third-party servers. All operations are strictly local between your browser and the Zendesk/Jira APIs.

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
