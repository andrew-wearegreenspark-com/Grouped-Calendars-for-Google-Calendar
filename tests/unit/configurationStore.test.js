"use strict";

// This test runs the browser-style scripts in a small mocked Chrome environment.
// It verifies persistence without needing to open or alter a real Calendar tab.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const projectRoot = path.resolve(__dirname, "../..");
const storedValues = { sync: {}, local: {} };
const storageListeners = [];
let nextUuid = 1;

const context = vm.createContext({
  console,
  structuredClone,
  setTimeout,
  crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(nextUuid++).padStart(12, "0")}` },
  chrome: {
    storage: {
      ...Object.fromEntries(["sync", "local"].map((areaName) => [areaName, {
        async get(key) {
          return { [key]: storedValues[areaName][key] };
        },
        async set(values) {
          Object.entries(values).forEach(([key, newValue]) => {
            const oldValue = storedValues[areaName][key];
            storedValues[areaName][key] = structuredClone(newValue);
            storageListeners.forEach((listener) => listener({ [key]: { oldValue, newValue } }, areaName));
          });
        }
      }])),
      onChanged: { addListener: (listener) => storageListeners.push(listener) }
    }
  },
  window: {
    setTimeout,
    GCalGroups: { constants: { LOG_PREFIX: "[Grouped Calendars test]" } }
  }
});

function loadScript(relativePath) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

loadScript("src/shared/configurationModel.js");
loadScript("src/content/configurationStore.js");
loadScript("src/content/grouping.js");

async function run() {
  const changes = [];
  const firstStore = context.window.GCalGroups.configurationStore.createConfigurationStore((reason) => {
    changes.push(reason);
  });
  await firstStore.hydrate();

  const initial = firstStore.getConfiguration();
  assert.strictEqual(initial.version, 2);
  assert.deepStrictEqual(Array.from(initial.groups, (group) => group.name), ["Production", "Personal"]);
  assert.ok(initial.groups.every((group) => /^[0-9a-f-]{36}$/.test(group.id)));
  assert.ok(initial.groups.every((group) => /^#[0-9a-f]{6}$/.test(group.colour)));

  const calendars = [
    {
      calendarId: "data-id:calendar-alpha",
      displayName: "Calendar Alpha",
      nativeSection: "other-calendars",
      identifierSource: "data-id",
      identifierStable: true
    },
    {
      calendarId: "data-id:calendar-beta",
      displayName: "Calendar Beta",
      nativeSection: "my-calendars",
      identifierSource: "data-id",
      identifierStable: true
    },
    {
      calendarId: "runtime:temporary",
      displayName: "Temporary",
      nativeSection: "other-calendars",
      identifierSource: "fallback",
      identifierStable: false
    }
  ];
  // These operations deliberately overlap, matching the burst of DOM updates
  // seen on Calendar. The store must serialize them without losing either one.
  await Promise.all([
    firstStore.reconcileCalendars(calendars),
    firstStore.setGroupCollapsed(initial.groups[0].id, true)
  ]);

  const reconciled = firstStore.getConfiguration();
  const production = reconciled.groups.find((group) => group.name === "Production");
  assert.ok(!reconciled.assignments[calendars[0].calendarId]);
  assert.ok(!reconciled.assignments[calendars[1].calendarId]);
  assert.ok(!reconciled.assignments[calendars[2].calendarId]);
  assert.ok(reconciled.calendars[calendars[0].calendarId]);
  assert.ok(!reconciled.calendars[calendars[2].calendarId]);
  assert.ok(!reconciled.migrationState.phase2AssignmentImportSeen[calendars[0].calendarId]);
  const syncItem = storedValues.sync.groupedCalendarsConfiguration;
  const localItem = storedValues.local.groupedCalendarsCalendarMetadata;
  assert.ok(!Object.prototype.hasOwnProperty.call(syncItem, "calendars"));
  assert.ok(!Object.prototype.hasOwnProperty.call(syncItem, "migrationState"));
  assert.ok(localItem.calendars[calendars[0].calendarId]);

  // A second store represents a browser restart or another open Calendar tab.
  const secondStore = context.window.GCalGroups.configurationStore.createConfigurationStore(() => {});
  await secondStore.hydrate();
  const reloaded = secondStore.getConfiguration();
  assert.strictEqual(reloaded.groups.find((group) => group.id === production.id).collapsed, true);
  assert.ok(!reloaded.assignments[calendars[0].calendarId]);

  const renderedGroups = context.window.GCalGroups.grouping.buildStoredGroups(calendars, reloaded);
  assert.deepStrictEqual(Array.from(renderedGroups, (group) => group.name), ["Production", "Personal", "Ungrouped"]);
  assert.strictEqual(renderedGroups[2].calendars[0].displayName, "Calendar Alpha");
  assert.strictEqual(renderedGroups[2].calendars[2].displayName, "Temporary");
  assert.ok(changes.includes("calendar metadata reconciliation"));

  const model = context.GCalGroupsShared.configurationModel;
  let managed = model.createGroup(reloaded, "Research");
  const research = managed.groups.find((group) => group.name === "Research");
  managed = model.renameGroup(managed, research.id, "Research and Development");
  managed = model.moveGroup(managed, research.id, -1);
  managed = model.assignCalendar(managed, calendars[0].calendarId, research.id);
  assert.strictEqual(managed.assignments[calendars[0].calendarId], research.id);
  assert.strictEqual(managed.groups[1].name, "Research and Development");
  managed = model.assignCalendar(managed, calendars[0].calendarId, "");
  assert.ok(!managed.assignments[calendars[0].calendarId]);
  managed = model.deleteGroup(managed, research.id);
  assert.ok(!managed.groups.some((group) => group.id === research.id));
  managed = model.setSetting(managed, "showUngrouped", false);
  assert.strictEqual(managed.settings.showUngrouped, false);
  managed = model.setGroupColour(managed, managed.groups[0].id, "#123abc");
  assert.strictEqual(managed.groups[0].colour, "#123abc");
  assert.throws(() => model.createGroup(managed, "Personal"), /already exists/);
  assert.throws(() => model.validateImportedConfiguration({ groups: [] }), /assignments/);

  // Stress an account with enough long calendar IDs to exceed one sync item.
  // Assignments must fall back to local storage and merge back losslessly.
  const large = model.createDefaultConfiguration();
  for (let index = 0; index < 120; index += 1) {
    const calendarId = `data-id:${"calendar-identifier-".repeat(6)}${index}`;
    large.calendars[calendarId] = {
      displayName: `Stress calendar ${index}`,
      nativeSection: index % 2 ? "my-calendars" : "other-calendars",
      identifierSource: "data-id"
    };
    large.assignments[calendarId] = large.groups[index % large.groups.length].id;
  }
  const largePayloads = model.createStoragePayloads(large);
  assert.strictEqual(largePayloads.sync.assignmentsStoredLocally, true);
  assert.strictEqual(Object.keys(largePayloads.sync.assignments).length, 0);
  assert.strictEqual(Object.keys(largePayloads.local.assignments).length, 120);
  const mergedLarge = model.mergeStoredConfiguration(largePayloads.sync, largePayloads.local);
  assert.strictEqual(Object.keys(mergedLarge.assignments).length, 120);

  console.log("Version 1.0 configuration, management, and large-account tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
