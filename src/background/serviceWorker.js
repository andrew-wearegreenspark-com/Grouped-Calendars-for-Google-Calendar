"use strict";

const SOLO_STATES_KEY = "groupedCalendarsSoloStates";
const LEGACY_SOLO_STATE_KEY = "groupedCalendarsSoloState";

function scopeFor(message) {
  return typeof message.scope === "string" && message.scope ? message.scope : "default";
}

async function readStates() {
  const result = await chrome.storage.session.get([SOLO_STATES_KEY, LEGACY_SOLO_STATE_KEY]);
  return {
    states: result[SOLO_STATES_KEY] && typeof result[SOLO_STATES_KEY] === "object"
      ? { ...result[SOLO_STATES_KEY] }
      : {},
    legacyState: result[LEGACY_SOLO_STATE_KEY] || null
  };
}

// Solo snapshots are separated by Google Calendar's /u/{account} route. This
// prevents a session in one signed-in account from replacing another account's
// snapshot when both are open in the same Chrome profile.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type || !message.type.startsWith("GCAL_GROUPS_SOLO_")) return false;

  const handle = async () => {
    const scope = scopeFor(message);
    const stored = await readStates();

    if (message.type === "GCAL_GROUPS_SOLO_GET") {
      const state = stored.states[scope] || stored.legacyState || null;
      if (!stored.states[scope] && stored.legacyState) {
        stored.states[scope] = stored.legacyState;
        await chrome.storage.session.set({ [SOLO_STATES_KEY]: stored.states });
        await chrome.storage.session.remove(LEGACY_SOLO_STATE_KEY);
      }
      return { ok: true, state };
    }

    if (message.type === "GCAL_GROUPS_SOLO_SET") {
      stored.states[scope] = message.state;
      await chrome.storage.session.set({ [SOLO_STATES_KEY]: stored.states });
      return { ok: true };
    }

    if (message.type === "GCAL_GROUPS_SOLO_CLEAR") {
      delete stored.states[scope];
      await chrome.storage.session.set({ [SOLO_STATES_KEY]: stored.states });
      return { ok: true };
    }

    return { ok: false, error: "Unknown Solo message" };
  };

  handle().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
