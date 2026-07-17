# Version 1.0.1 security and permissions review

Review date: 17 July 2026

## Manifest scope

- Manifest V3
- One permission: `storage`
- One host: `https://calendar.google.com/*`
- No tabs, browsing-history, identity, cookies, scripting, downloads, notifications, or broad website access

## Code and network behaviour

- All executable JavaScript is packaged with the extension
- No remote script, dynamic code loading, `eval`, or `new Function`
- No fetch, XMLHttpRequest, WebSocket, beacon, analytics, advertising, or telemetry integration
- No event-content API or Google account API
- Runtime messages are limited to temporary Solo state managed by the packaged service worker

## Stored information

- Sync: group definitions, settings, and normal-sized assignments
- Local: calendar display metadata and oversized assignment fallback
- Session: account-scoped reversible Solo snapshots
- Runtime-only fallback identifiers are not persisted

## Remaining release responsibilities

- Host the privacy policy at a stable public URL before store submission
- Add a developer support contact
- Capture screenshots using non-sensitive demonstration calendars
- Re-run this review whenever permissions, hosts, storage, or network behaviour changes
