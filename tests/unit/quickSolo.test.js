"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// This small runtime mock stores the same temporary state that Chrome keeps in
// chrome.storage.session, without needing to launch a browser for the test.
let storedState = null;
const chrome = {
  runtime: {
    lastError: null,
    sendMessage(message, callback) {
      if (message.type === "GCAL_GROUPS_SOLO_GET") callback({ ok: true, state: storedState });
      else if (message.type === "GCAL_GROUPS_SOLO_SET") {
        storedState = JSON.parse(JSON.stringify(message.state));
        callback({ ok: true });
      } else if (message.type === "GCAL_GROUPS_SOLO_CLEAR") {
        storedState = null;
        callback({ ok: true });
      }
    }
  }
};

const window = {
  GCalGroups: { constants: { LOG_PREFIX: "[test]" } }
};
const source = fs.readFileSync(
  path.join(__dirname, "..", "..", "src", "content", "soloController.js"),
  "utf8"
);
vm.runInNewContext(source, { window, chrome, console });

const calendars = [
  { calendarId: "a", visible: true },
  { calendarId: "b", visible: false },
  { calendarId: "c", visible: true }
];
const appliedTargets = [];

const controller = window.GCalGroups.soloController.createSoloController({
  getCalendars: () => calendars,
  getConfiguration: () => ({
    groups: [{ id: "group-1" }],
    assignments: {},
    settings: { restorePreviousStateAfterSolo: true, includeUngroupedInAll: true }
  }),
  getScope: () => "account:0",
  setCalendarStates: async (targets) => {
    appliedTargets.push({ ...targets });
    calendars.forEach((calendar) => {
      if (Object.prototype.hasOwnProperty.call(targets, calendar.calendarId)) {
        calendar.visible = targets[calendar.calendarId];
      }
    });
    return true;
  },
  requestReconcile: () => {}
});

(async () => {
  // Entering Quick Solo and selecting rows are both non-destructive.
  assert.strictEqual(await controller.toggleQuickSolo(), true);
  assert.strictEqual(appliedTargets.length, 0);
  assert.strictEqual(controller.getState().mode, "quick");
  assert.deepStrictEqual(Array.from(controller.getState().selectedCalendarIds), []);

  // Normal group Solo cannot interrupt an active Quick Solo selection session.
  assert.strictEqual(await controller.toggleSolo("group-1", ["a"]), false);
  assert.strictEqual(appliedTargets.length, 0);

  await controller.toggleQuickCalendar("b");
  assert.strictEqual(appliedTargets.length, 0);
  assert.deepStrictEqual(Array.from(controller.getState().selectedCalendarIds), ["b"]);
  assert.strictEqual(controller.getState().quickApplied, false);

  // The second Quick Solo action applies the complete selection in one bulk operation.
  await controller.toggleQuickCalendar("a");
  assert.strictEqual(appliedTargets.length, 0);
  await controller.toggleQuickSolo();
  assert.deepStrictEqual(appliedTargets.at(-1), { a: true, b: true, c: false });
  assert.strictEqual(controller.getState().quickApplied, true);
  assert.strictEqual(controller.getState().active, true);
  assert.strictEqual(controller.getState().mode, "quick");

  // Editing an applied selection is deferred until Apply selected is used again.
  await controller.toggleQuickCalendar("c");
  assert.strictEqual(appliedTargets.length, 1);
  assert.strictEqual(controller.getState().quickApplied, false);
  await controller.toggleQuickSolo();
  assert.deepStrictEqual(appliedTargets.at(-1), { a: true, b: true, c: true });

  // The header's Restore action exits and returns to the exact pre-Quick snapshot.
  await controller.showAll();
  assert.deepStrictEqual(appliedTargets.at(-1), { a: true, b: false, c: true });
  assert.strictEqual(controller.getState().active, false);
  assert.strictEqual(storedState, null);

  // A recovered Quick Solo session must not be mistaken for a deleted group.
  await controller.toggleQuickSolo();
  await controller.toggleQuickCalendar("b");
  const recoveredController = window.GCalGroups.soloController.createSoloController({
    getCalendars: () => calendars,
    getConfiguration: () => ({ groups: [], assignments: {}, settings: {} }),
    getScope: () => "account:0",
    setCalendarStates: async () => true,
    requestReconcile: () => {}
  });
  await recoveredController.hydrate();
  assert.strictEqual(recoveredController.getState().mode, "quick");
  assert.deepStrictEqual(Array.from(recoveredController.getState().selectedCalendarIds), ["b"]);

  console.log("Version 1.0 Quick Solo tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
