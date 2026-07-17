(function initialiseConfigurationStore(namespace) {
  "use strict";

  const { LOG_PREFIX } = namespace.constants;
  const configurationModel = globalThis.GCalGroupsShared.configurationModel;
  const { STORAGE_KEY, METADATA_STORAGE_KEY, CURRENT_SCHEMA_VERSION } = configurationModel;

  const createDefaultConfiguration = configurationModel.createDefaultConfiguration;
  const migrateConfiguration = configurationModel.normaliseConfiguration;

  function serialise(value) {
    return JSON.stringify(value);
  }

  function createConfigurationStore(onChange) {
    let configuration = createDefaultConfiguration();
    let lastSaved = "";
    let operationQueue = Promise.resolve();
    let storageWriteDepth = 0;

    function enqueue(operation) {
      const queued = operationQueue.then(operation, operation);
      operationQueue = queued.catch(() => {});
      return queued;
    }

    function getConfiguration() {
      // Callers receive a snapshot so rendering code cannot mutate stored state.
      return structuredClone(configuration);
    }

    async function save(nextConfiguration, reason) {
      const normalised = migrateConfiguration(nextConfiguration);
      const signature = serialise(normalised);
      configuration = normalised;
      if (signature === lastSaved) return false;

      lastSaved = signature;
      // chrome.storage.sync limits each item to roughly 8 KB. Calendar metadata
      // contains long Google identifiers, so keep only portable user choices in
      // sync and store rediscoverable metadata locally.
      storageWriteDepth += 1;
      try {
        const payloads = configurationModel.createStoragePayloads(normalised);
        await chrome.storage.local.set({
          [METADATA_STORAGE_KEY]: payloads.local
        });
        await chrome.storage.sync.set({
          [STORAGE_KEY]: payloads.sync
        });
      } finally {
        // Storage change events are delivered at the end of the current task.
        // Release suppression on the next task so our own two writes are ignored.
        window.setTimeout(() => { storageWriteDepth = Math.max(0, storageWriteDepth - 1); }, 0);
      }
      console.info(`${LOG_PREFIX} Saved configuration`, {
        reason,
        groupCount: normalised.groups.length,
        assignmentCount: Object.keys(normalised.assignments).length,
        calendarMetadataCount: Object.keys(normalised.calendars).length
      });
      onChange(reason);
      return true;
    }

    async function hydrate() {
      const [storedSync, storedLocal] = await Promise.all([
        chrome.storage.sync.get(STORAGE_KEY),
        chrome.storage.local.get(METADATA_STORAGE_KEY)
      ]);
      const hadStoredConfiguration = Boolean(storedSync[STORAGE_KEY]);
      const oldCombinedItem = storedSync[STORAGE_KEY] || {};
      configuration = configurationModel.mergeStoredConfiguration(
        oldCombinedItem,
        storedLocal[METADATA_STORAGE_KEY]
      );
      lastSaved = serialise(configuration);

      // Save a new or migrated value immediately so every later read uses the
      // current schema, even if the options page is opened before Calendar.
      const needsStorageSplit = Boolean(
        oldCombinedItem.calendars
        || oldCombinedItem.migrationState
      );
      if (!hadStoredConfiguration || oldCombinedItem.version !== CURRENT_SCHEMA_VERSION || needsStorageSplit) {
        lastSaved = "";
        await save(configuration, hadStoredConfiguration ? "storage migration" : "initial configuration");
      }

      console.info(`${LOG_PREFIX} Loaded configuration`, {
        version: configuration.version,
        groupCount: configuration.groups.length,
        assignmentCount: Object.keys(configuration.assignments).length
      });
      onChange("configuration loaded");
    }

    async function reconcileCalendarsNow(calendars) {
      const next = getConfiguration();
      let changed = false;

      calendars.forEach((calendar) => {
        // Runtime fallback IDs can change after a rerender, so persisting them
        // would create incorrect assignments. They remain usable as Ungrouped.
        if (!calendar.identifierStable) return;

        const metadata = {
          displayName: calendar.displayName,
          nativeSection: calendar.nativeSection,
          identifierSource: calendar.identifierSource
        };
        if (serialise(next.calendars[calendar.calendarId]) !== serialise(metadata)) {
          next.calendars[calendar.calendarId] = metadata;
          changed = true;
        }

        // Assignments are only created through the management interface.
        // Existing saved assignments remain untouched during reconciliation.
      });

      // Remove references to deleted groups while retaining metadata for a
      // temporarily missing or renamed Google calendar.
      const validGroupIds = new Set(next.groups.map((group) => group.id));
      Object.entries(next.assignments).forEach(([calendarId, groupId]) => {
        if (!validGroupIds.has(groupId)) {
          delete next.assignments[calendarId];
          changed = true;
        }
      });

      if (changed) await save(next, "calendar metadata reconciliation");
    }

    function reconcileCalendars(calendars) {
      // Google can request several reconciliations during one DOM rerender.
      // Serialising their storage work prevents older snapshots overwriting a
      // newer metadata or producing a loop of cross-tab change messages.
      const metadataSnapshot = calendars.map((calendar) => ({
        calendarId: calendar.calendarId,
        displayName: calendar.displayName,
        nativeSection: calendar.nativeSection,
        identifierSource: calendar.identifierSource,
        identifierStable: calendar.identifierStable
      }));
      return enqueue(() => reconcileCalendarsNow(metadataSnapshot));
    }

    async function setGroupCollapsedNow(groupId, collapsed) {
      const next = getConfiguration();
      const group = next.groups.find((candidate) => candidate.id === groupId);
      if (!group || group.collapsed === collapsed) return;
      group.collapsed = collapsed;
      await save(next, "group collapsed state");
    }

    function setGroupCollapsed(groupId, collapsed) {
      return enqueue(() => setGroupCollapsedNow(groupId, collapsed));
    }

    async function applyExternalStorageChange() {
      const [storedSync, storedLocal] = await Promise.all([
        chrome.storage.sync.get(STORAGE_KEY),
        chrome.storage.local.get(METADATA_STORAGE_KEY)
      ]);
      const incoming = configurationModel.mergeStoredConfiguration(
        storedSync[STORAGE_KEY],
        storedLocal[METADATA_STORAGE_KEY]
      );
      const signature = serialise(incoming);
      if (signature === serialise(configuration)) return;
      configuration = incoming;
      lastSaved = signature;
      console.info(`${LOG_PREFIX} Applied configuration changed in another extension page or tab.`);
      onChange("stored configuration changed");
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
      const syncChanged = areaName === "sync" && Boolean(changes[STORAGE_KEY]);
      const metadataChanged = areaName === "local" && Boolean(changes[METADATA_STORAGE_KEY]);
      if (!syncChanged && !metadataChanged) return;
      if (storageWriteDepth > 0) return;
      applyExternalStorageChange().catch((error) => {
        console.error(`${LOG_PREFIX} Could not apply an external storage change`, error);
      });
    });

    return { getConfiguration, hydrate, reconcileCalendars, setGroupCollapsed };
  }

  namespace.configurationStore = { createConfigurationStore };
})(window.GCalGroups = window.GCalGroups || {});
