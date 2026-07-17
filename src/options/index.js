(function startOptionsPage() {
  "use strict";

  const model = globalThis.GCalGroupsShared.configurationModel;
  const elements = {
    status: document.getElementById("status"),
    groups: document.getElementById("groups-list"),
    calendars: document.getElementById("calendars-list"),
    createForm: document.getElementById("create-group-form"),
    newGroupName: document.getElementById("new-group-name"),
    search: document.getElementById("calendar-search"),
    showUngrouped: document.getElementById("show-ungrouped"),
    includeUngroupedAll: document.getElementById("include-ungrouped-all"),
    restoreAfterSolo: document.getElementById("restore-after-solo"),
    exportButton: document.getElementById("export-configuration"),
    chooseImport: document.getElementById("choose-import"),
    importFile: document.getElementById("import-file"),
    resetButton: document.getElementById("reset-configuration"),
    openCalendar: document.getElementById("open-calendar")
  };
  let configuration = model.createDefaultConfiguration();
  let storageWriteDepth = 0;

  function showStatus(message, kind = "success") {
    elements.status.textContent = message;
    elements.status.dataset.kind = kind;
  }

  function calendarCount(groupId) {
    return Object.values(configuration.assignments).filter((assignedId) => assignedId === groupId).length;
  }

  function renderGroups() {
    elements.groups.replaceChildren();
    if (configuration.groups.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No custom groups yet. Create one above, then assign calendars to it.";
      elements.groups.append(empty);
      return;
    }

    configuration.groups.forEach((group, index) => {
      const card = document.createElement("article");
      card.className = "group-card";

      const renameForm = document.createElement("form");
      renameForm.className = "group-name-form";
      const input = document.createElement("input");
      input.value = group.name;
      input.maxLength = 80;
      input.setAttribute("aria-label", `Name for ${group.name}`);
      const saveName = document.createElement("button");
      saveName.type = "submit";
      saveName.textContent = "Save name";
      renameForm.append(input, saveName);
      renameForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          await save(model.renameGroup(configuration, group.id, input.value), `Renamed group to ${input.value.trim()}.`);
        } catch (error) {
          showStatus(error.message, "error");
        }
      });

      const count = document.createElement("span");
      count.className = "group-count";
      count.textContent = `${calendarCount(group.id)} calendar${calendarCount(group.id) === 1 ? "" : "s"}`;

      const controls = document.createElement("div");
      controls.className = "group-controls";
      const colourLabel = document.createElement("label");
      colourLabel.className = "group-colour-label";
      const colourText = document.createElement("span");
      colourText.textContent = "Colour";
      const colour = document.createElement("input");
      colour.type = "color";
      colour.value = group.colour;
      colour.setAttribute("aria-label", `Colour for ${group.name}`);
      colour.addEventListener("change", async () => {
        try {
          await save(model.setGroupColour(configuration, group.id, colour.value), `Updated the colour for ${group.name}.`);
        } catch (error) {
          showStatus(error.message, "error");
        }
      });
      colourLabel.append(colourText, colour);
      const up = document.createElement("button");
      up.type = "button";
      up.className = "secondary";
      up.textContent = "Up";
      up.disabled = index === 0;
      up.setAttribute("aria-label", `Move ${group.name} up`);
      up.addEventListener("click", () => save(model.moveGroup(configuration, group.id, -1), `Moved ${group.name} up.`));
      const down = document.createElement("button");
      down.type = "button";
      down.className = "secondary";
      down.textContent = "Down";
      down.disabled = index === configuration.groups.length - 1;
      down.setAttribute("aria-label", `Move ${group.name} down`);
      down.addEventListener("click", () => save(model.moveGroup(configuration, group.id, 1), `Moved ${group.name} down.`));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = "Delete";
      remove.addEventListener("click", async () => {
        const assignedCount = calendarCount(group.id);
        const detail = assignedCount ? ` Its ${assignedCount} calendar assignment(s) will move to Ungrouped.` : "";
        if (!confirm(`Delete the extension group “${group.name}”?${detail}\n\nNo Google calendars will be deleted.`)) return;
        await save(model.deleteGroup(configuration, group.id), `Deleted ${group.name}.`);
      });
      controls.append(colourLabel, up, down, remove);
      card.append(renameForm, count, controls);
      elements.groups.append(card);
    });
  }

  function renderCalendars() {
    elements.calendars.replaceChildren();
    const query = elements.search.value.trim().toLocaleLowerCase();
    const calendars = Object.entries(configuration.calendars)
      .map(([calendarId, metadata]) => ({ calendarId, ...metadata }))
      .filter((calendar) => !query || calendar.displayName.toLocaleLowerCase().includes(query))
      .sort((first, second) => first.displayName.localeCompare(second.displayName));

    if (calendars.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = Object.keys(configuration.calendars).length
        ? "No calendars match this search."
        : "No calendar metadata has been discovered yet. Open Google Calendar once, then return here.";
      elements.calendars.append(empty);
      return;
    }

    calendars.forEach((calendar) => {
      const row = document.createElement("div");
      row.className = "calendar-row";
      const identity = document.createElement("div");
      const name = document.createElement("span");
      name.className = "calendar-name";
      name.textContent = calendar.displayName;
      const source = document.createElement("span");
      source.className = "calendar-source";
      source.textContent = calendar.nativeSection === "my-calendars" ? "My calendars" : "Other calendars";
      identity.append(name, source);

      const select = document.createElement("select");
      select.setAttribute("aria-label", `Group for ${calendar.displayName}`);
      const ungrouped = document.createElement("option");
      ungrouped.value = "";
      ungrouped.textContent = "Ungrouped";
      select.append(ungrouped);
      configuration.groups.forEach((group) => {
        const option = document.createElement("option");
        option.value = group.id;
        option.textContent = group.name;
        select.append(option);
      });
      select.value = configuration.assignments[calendar.calendarId] || "";
      select.addEventListener("change", async () => {
        try {
          const targetName = configuration.groups.find((group) => group.id === select.value)?.name || "Ungrouped";
          await save(model.assignCalendar(configuration, calendar.calendarId, select.value), `Moved ${calendar.displayName} to ${targetName}.`);
        } catch (error) {
          showStatus(error.message, "error");
        }
      });
      row.append(identity, select);
      elements.calendars.append(row);
    });
  }

  function render() {
    renderGroups();
    renderCalendars();
    elements.showUngrouped.checked = configuration.settings.showUngrouped;
    elements.includeUngroupedAll.checked = configuration.settings.includeUngroupedInAll;
    elements.restoreAfterSolo.checked = configuration.settings.restorePreviousStateAfterSolo;
  }

  async function save(nextConfiguration, successMessage) {
    configuration = model.normaliseConfiguration(nextConfiguration);
    storageWriteDepth += 1;
    try {
      const payloads = model.createStoragePayloads(configuration);
      await chrome.storage.local.set({
        [model.METADATA_STORAGE_KEY]: payloads.local
      });
      await chrome.storage.sync.set({
        [model.STORAGE_KEY]: payloads.sync
      });
    } finally {
      window.setTimeout(() => { storageWriteDepth = Math.max(0, storageWriteDepth - 1); }, 0);
    }
    render();
    showStatus(successMessage);
  }

  async function readStoredConfiguration() {
    const [storedSync, storedLocal] = await Promise.all([
      chrome.storage.sync.get(model.STORAGE_KEY),
      chrome.storage.local.get(model.METADATA_STORAGE_KEY)
    ]);
    return {
      configuration: model.mergeStoredConfiguration(
        storedSync[model.STORAGE_KEY],
        storedLocal[model.METADATA_STORAGE_KEY]
      ),
      hasSyncConfiguration: Boolean(storedSync[model.STORAGE_KEY])
    };
  }

  async function load() {
    const stored = await readStoredConfiguration();
    configuration = stored.configuration;
    if (!stored.hasSyncConfiguration) await save(configuration, "Initial configuration created.");
    render();
    showStatus("Configuration loaded.");
  }

  elements.createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const name = elements.newGroupName.value;
      await save(model.createGroup(configuration, name), `Created ${name.trim()}.`);
      elements.newGroupName.value = "";
      elements.newGroupName.focus();
    } catch (error) {
      showStatus(error.message, "error");
    }
  });

  elements.search.addEventListener("input", renderCalendars);
  elements.showUngrouped.addEventListener("change", () => save(
    model.setSetting(configuration, "showUngrouped", elements.showUngrouped.checked),
    "Ungrouped display setting saved."
  ));
  elements.includeUngroupedAll.addEventListener("change", () => save(
    model.setSetting(configuration, "includeUngroupedInAll", elements.includeUngroupedAll.checked),
    "All button setting saved."
  ));
  elements.restoreAfterSolo.addEventListener("change", () => save(
    model.setSetting(configuration, "restorePreviousStateAfterSolo", elements.restoreAfterSolo.checked),
    "Solo restoration setting saved."
  ));

  elements.exportButton.addEventListener("click", () => {
    const data = JSON.stringify(configuration, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `grouped-calendar-configuration-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showStatus("Configuration exported.");
  });

  elements.chooseImport.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", async () => {
    const [file] = elements.importFile.files;
    if (!file) return;
    try {
      const imported = model.validateImportedConfiguration(JSON.parse(await file.text()));
      if (!confirm(`Replace the current configuration with “${file.name}”?`)) return;
      await save(imported, "Configuration imported.");
    } catch (error) {
      showStatus(`Import failed: ${error.message}`, "error");
    } finally {
      elements.importFile.value = "";
    }
  });

  elements.resetButton.addEventListener("click", async () => {
    if (!confirm("Reset all extension groups, assignments, settings, and discovered metadata?\n\nGoogle calendars and events will not be changed.")) return;
    // Keep any active Solo snapshot until a Calendar tab sees the new group IDs.
    // Its content controller will then restore the exact pre-Solo visibility.
    await save(model.createDefaultConfiguration(), "Configuration reset. Open Calendar to rediscover calendars.");
  });

  elements.openCalendar.addEventListener("click", () => chrome.tabs.create({ url: "https://calendar.google.com/" }));

  chrome.storage.onChanged.addListener((changes, areaName) => {
    const syncChanged = areaName === "sync" && Boolean(changes[model.STORAGE_KEY]);
    const metadataChanged = areaName === "local" && Boolean(changes[model.METADATA_STORAGE_KEY]);
    if ((!syncChanged && !metadataChanged) || storageWriteDepth > 0) return;
    readStoredConfiguration().then((stored) => {
      if (JSON.stringify(stored.configuration) === JSON.stringify(configuration)) return;
      configuration = stored.configuration;
      render();
      showStatus("Updated from another Calendar tab.");
    }).catch((error) => showStatus(`Could not apply a storage update: ${error.message}`, "error"));
  });

  load().catch((error) => showStatus(`Could not load configuration: ${error.message}`, "error"));
})();
