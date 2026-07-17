# Grouped Calendars for Google Calendar

Version 1.0.1 adds coloured calendar groups, reliable visibility controls, and reversible Solo views directly to the Google Calendar sidebar.

The extension has no external server, analytics, advertising, or tracking. Calendar names and group settings are stored by Chrome. Event details are not read or stored.

## Features

- Create, rename, colour, reorder, collapse, and delete groups
- Assign calendars from both My calendars and Other calendars
- Toggle individual calendars or an entire group
- Solo one group and later restore the exact previous visibility state
- Select calendars across groups with Quick Solo, then apply them together
- Restore the exact state from before Quick Solo
- Preserve groups and normal-sized assignments through Chrome sync
- Keep unusually large assignment maps locally to avoid Chrome sync quota errors
- Isolate temporary Solo sessions by Google account route
- Support light mode, dark mode, narrow sidebars, and virtualised calendar lists
- Export and import configuration backups

## Install manually

1. Extract the release ZIP.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted `grouped-calendars` folder.
6. Open or hard-refresh Google Calendar with `Ctrl+Shift+R`.

For an update, replace the extracted folder, select **Reload** on the extensions page, then hard-refresh Google Calendar.

## Basic use

1. Open the extension menu and select **Manage groups**.
2. Create groups, choose their colours, and assign calendars.
3. Return to Google Calendar. The Grouped section appears below the native calendar sections.

### Quick Solo

1. Select **Quick solo**.
2. Select calendars from any groups. These selections do not immediately change Google Calendar.
3. Select **Apply selected** to update the full set once.
4. Adjust the selection and apply again when needed.
5. Select **Restore** to return to the exact pre-Quick state and exit.

## Backup and recovery

The management page can export the extension configuration as JSON. Keep that file somewhere safe if the group layout is important. Import restores groups, colours, assignments, ordering, and behaviour settings; it never creates or deletes Google calendars.

## Troubleshooting

- **Grouped is missing:** hard-refresh Google Calendar and confirm the extension is enabled.
- **A calendar is missing:** expand and scroll through My calendars and Other calendars once so Google renders its native row.
- **A bulk command takes several seconds:** Google Calendar has no supported bulk visibility API, so the extension must operate native controls progressively.
- **A warning appears:** leave the sidebar still and retry the command. Restoration snapshots are retained after an incomplete operation.
- **The wrong account is shown:** confirm the `/u/0`, `/u/1`, or similar account route in Google Calendar.
- **Settings appear stale:** open the management page, export a backup, then reload the extension and Calendar.

## Privacy and permissions

- `storage` saves configuration and temporary restoration snapshots in Chrome.
- Access to `https://calendar.google.com/*` is required to add the Grouped interface and operate native calendar visibility controls.
- No calendar or event data is sent to the developer or any third party.

See [docs/PRIVACY.md](docs/PRIVACY.md) for the complete privacy statement.

## Development checks

Run from this folder with Node.js:

```powershell
node tests/unit/configurationStore.test.js
node tests/unit/serviceWorker.test.js
node tests/unit/quickSolo.test.js
```

## Known limitation

Google Calendar does not provide a supported command for changing an arbitrary set of calendar visibility states. Group, Solo, All, Restore, and Quick Solo apply actions must therefore operate native controls progressively and may take several seconds on large accounts.
