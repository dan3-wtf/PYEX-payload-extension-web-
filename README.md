# PYEX Payload Extension

Payload management extension for security testing, penetration testing, and web application assessment.

Developed by Peon Team.

## Features

* Fast payload search
* One-click copy to clipboard
* Custom payload management
* Favorites support
* Payload synchronization
* Local storage support
* Dark and light themes
* Responsive popup sizes
* Cache-first performance

## Installation

### Chromium Browsers

Supported browsers:

* Google Chrome
* Microsoft Edge
* Brave
* Chromium

Steps:

1. Download or clone this repository:

```bash
git clone https://github.com/dan3-wtf/PYEX-payload-extension-web-.git
```

2. Open:

```
chrome://extensions
```

3. Enable **Developer Mode**.

4. Click **Load unpacked**.

5. Select the project folder.

6. The extension is ready to use.

---

### Firefox

For development and testing:

1. Open:

```
about:debugging#/runtime/this-firefox
```

2. Click **Load Temporary Add-on**.

3. Select `manifest.json`.

Note: Temporary add-ons are removed when Firefox is restarted.

## Usage

1. Open the extension popup.
2. Search for a payload by keyword or category.
3. Copy payloads with a single click.
4. Save frequently used payloads to Favorites.
5. Synchronize payload collections when updates are available.

## Categories

Current payload collections include:

* Cross-Site Scripting (XSS)
* SQL Injection (SQLi)
* Server-Side Request Forgery (SSRF)
* Local File Inclusion (LFI)
* Remote File Inclusion (RFI)
* Command Injection
* Server-Side Template Injection (SSTI)
* Open Redirect
* CSRF
* WAF Bypass

Additional categories may be added in future releases.

## Permissions

The extension may request permissions required for:

* Local storage
* Clipboard operations
* Active tab interaction
* Browser tab access
* Payload synchronization

Permissions are only used for extension functionality.

## License

GPL-3.0 License

See the LICENSE file for details.

## Disclaimer

This project is intended for authorized security testing, research, and educational purposes only.

Users are responsible for ensuring they have proper authorization before performing any security assessment activities.

The authors assume no responsibility for misuse of this software.

## Author

Peon Team

GitHub:
https://github.com/dan3-wtf
