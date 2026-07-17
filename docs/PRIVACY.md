# Privacy policy

**Grouped Calendars for Google Calendar** is designed to work locally in the user's browser.

Last updated: 17 July 2026

## Data handled

The extension handles calendar display names, stable calendar identifiers, colours, group assignments, group settings, and temporary visibility snapshots needed for Solo restoration. It does not read, collect, or store event titles, descriptions, attendees, locations, attachments, or event contents.

## Storage

- Chrome sync storage holds groups, settings, and normal-sized assignment maps so Chrome may synchronise them through the user's signed-in Chrome profile.
- Chrome local storage holds rediscoverable calendar metadata and unusually large assignment maps that exceed sync limits.
- Chrome session storage holds temporary Solo and Quick Solo restoration snapshots, separated by Google Calendar account route.

Users can export, import, or reset configuration from the management page. Removing the extension removes its locally stored data according to Chrome's extension-storage behaviour.

## Data sharing

The extension has no developer-operated server, analytics service, advertising, tracking, telemetry, or external data transfer. It does not sell or share user data. Chrome sync may process synchronised configuration under the user's Google and Chrome settings; that service is provided by Google, not the extension developer.

## Permissions

- The `storage` permission is used only for extension configuration and reversible visibility snapshots.
- Access to `https://calendar.google.com/*` is used only to add the grouped-calendar interface and interact with Google Calendar's native visibility controls.

## Security

The extension contains all executable code in its package. It does not download or execute remote code and does not use `eval`.

## Changes

Material changes to this policy will be included with a new extension release and reflected by the date above.

## Contact

For support or privacy questions, contact `andrew@wearegreenspark.com`.
