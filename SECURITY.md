# Security Policy

## Supported Versions

Security updates and patches are provided for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 3.2.x   | :white_check_mark: |
| 3.1.x   | :white_check_mark: |
| 3.0.x   | :x:                |
| 2.x     | :x:                |
| < 2.0   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in the Barateza Ticket Notifier Chrome Extension, please report it responsibly.

### How to Report

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Report privately via GitHub Security Advisories: <https://github.com/barateza/barateza-ticket-notifier-v3/security/advisories>
3. Include the following information:
   - Description of the vulnerability
   - Steps to reproduce (if applicable)
   - Potential impact
   - Suggested fix (optional)

### Response Timeline

- **Initial Response**: Within 48 hours of report submission.
- **Status Updates**: At least every 7 days during investigation.
- **Fix Release**: Critical issues patched in next minor/patch release.

## Security Practices

### Content Security Policy (CSP)
The extension adheres to a strict Content Security Policy as per Manifest V3 requirements. We have recently improved our CSP by removing inline event handlers and using external, module-based scripts to mitigate XSS risks.

### Data Privacy & Storage
The extension is designed to be privacy-first.
- All ticket monitoring and data processing occur locally within your browser.
- Authentication relies on your active Zendesk session cookies.
- No personal authentication details (usernames/passwords) are handled or stored by the extension.
- For more details, see our [Privacy Policy](PRIVACY_POLICY.md).

## Vulnerability Types of Interest

We're particularly concerned with vulnerabilities related to:

- **Authentication & Authorization**: Cookie handling, session management, credential exposure.
- **Data Privacy**: Unintended data transmission, cookie access violations, storage security.
- **Cross-Site Scripting (XSS)**: DOM-based or reflected XSS in popup or offscreen documents.
- **Manifest V3 Sandbox Escapes**: Any bypass of extension isolation or offscreen document boundaries.
- **Third-Party Dependencies**: Security issues in imported libraries or build tools.

## Disclosure Policy

- We will acknowledge receipt of your report.
- We will provide status updates throughout our investigation.
- We will credit security researchers (with permission) in the release notes.
- We request a reasonable disclosure period before public announcement.
- Once a fix is released and users have time to update, we will publicly acknowledge the issue.

## Security Best Practices for Users

- Keep the extension updated to the latest version.
- Only add Zendesk endpoints you trust.
- Use strong Zendesk account passwords and 2FA where available.
- Review your active sessions in Zendesk regularly.
- Report any suspicious or unexpected extension behavior immediately.
