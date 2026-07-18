# TV Alert Webhook Forwarder

A Manifest V3 Chrome extension that captures TradingView alert popups (free tier) and forwards them instantly to your webhook with retries, deduplication, and local logging.

## Features
- MutationObserver + fallback polling to catch TradingView alert toasts in real time.
- Local-only login with hashed 6-digit PIN; no servers or OAuth.
- Store webhook URL securely in `chrome.storage.local` (HTTPS enforced).
- Background service worker performs POST with 3 retries (1s / 2s / 4s backoff).
- Deduplicates identical alerts within 30 seconds.
- Dashboard, Settings, Logs popup with test webhook + manual send.
- Logs kept locally (max 100) with timestamp, status, response snippet, attempts.

## Installation (Load unpacked)
1. Open Chrome → `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `texttv-alert-webhook-forwarder` folder.
4. Pin the extension if you want quick access.

## Usage
1. Open the popup → set a 6-digit PIN (first run) → unlock.
2. Go to **Settings** → paste your HTTPS webhook → Save.
3. Ensure **Status** is Enabled on the Dashboard.
4. Click **Test Webhook** to verify connectivity (sends sample JSON).
5. Keep TradingView open; when an alert toast appears, it’s POSTed immediately.

### Payload format
The extension now posts the alert **verbatim** as plain text (no JSON wrapper). Whatever text the content script captures is sent as the raw request body with `Content-Type: text/plain`.

## Permissions
- `storage` — store webhook, PIN hash, logs, enabled flag.
- Host permissions: `https://*.tradingview.com/*` — inject content script only on TradingView.

## Files
- `manifest.json` — MV3 configuration.
- `background.js` — service worker: messaging, retries, dedup, logging.
- `content.js` — TradingView DOM watcher.
- `popup/` — UI (HTML, CSS, JS).
- `icons/` — extension icons.
- `_docs/` — place screenshots if needed (optional).

## Notes
- Works with TradingView free tier; no DOM class-name dependencies.
- No fetch from content script; all network calls happen in background.
- Logs avoid sensitive data; webhook URL never exposed to content scripts.
- If TradingView’s React structure changes, the fallback scanner keeps running (1.5s cadence).
- Only forwards alerts whose text starts with `[{` (JSON array payloads) to avoid unrelated popups.

## Testing
- Use the **Test Webhook** button in the popup to ensure your endpoint responds with 2xx.
- Review the **Logs** tab for success/fail statuses and responses.

## Uninstall
Remove the extension from `chrome://extensions` — all stored data lives only in Chrome storage and is removed with the extension.

## Notes on trading
Trading automation is infrastructure, not financial advice. No profit guarantees. Test your webhook flow in a dry-run/paper setup before wiring it to anything live.

## Author
Built by [Jayadev Rana](https://jayadevrana.in) — @bluealgocapital · [YouTube](https://www.youtube.com/@jayadevrana3657) · [GitHub](https://github.com/jayadevrana)
