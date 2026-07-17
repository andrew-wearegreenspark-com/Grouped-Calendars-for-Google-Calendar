(function initialiseConfigurationModel(shared) {
  "use strict";

  const STORAGE_KEY = "groupedCalendarsConfiguration";
  const METADATA_STORAGE_KEY = "groupedCalendarsCalendarMetadata";
  const SYNC_ITEM_SOFT_LIMIT_BYTES = 7600;
  const CURRENT_SCHEMA_VERSION = 2;
  const GROUP_COLOURS = Object.freeze([
    "#1a73e8",
    "#a142f4",
    "#188038",
    "#d93025",
    "#f9ab00",
    "#00897b",
    "#e8710a",
    "#5f6368"
  ]);
  const DEFAULT_SETTINGS = Object.freeze({
    showUngrouped: true,
    includeUngroupedInAll: true,
    restorePreviousStateAfterSolo: true,
    includeSpecialCalendars: false
  });

  function createId() {
    return crypto.randomUUID();
  }

  function createDefaultConfiguration() {
    return {
      version: CURRENT_SCHEMA_VERSION,
      groups: [
        { id: createId(), name: "Production", order: 10, collapsed: false, colour: GROUP_COLOURS[0] },
        { id: createId(), name: "Personal", order: 20, collapsed: false, colour: GROUP_COLOURS[1] }
      ],
      assignments: {},
      calendars: {},
      migrationState: { phase2AssignmentImportSeen: {} },
      settings: { ...DEFAULT_SETTINGS }
    };
  }

  function normaliseConfiguration(value) {
    if (!value || typeof value !== "object") return createDefaultConfiguration();

    const defaults = createDefaultConfiguration();
    const seenGroupIds = new Set();
    const groups = (Array.isArray(value.groups) ? value.groups : defaults.groups)
      .filter((group) => group && typeof group.name === "string")
      .map((group, index) => {
        let id = typeof group.id === "string" && group.id ? group.id : createId();
        if (seenGroupIds.has(id)) id = createId();
        seenGroupIds.add(id);
        return {
          id,
          name: group.name.trim() || `Group ${index + 1}`,
          order: Number.isFinite(group.order) ? group.order : (index + 1) * 10,
          collapsed: Boolean(group.collapsed),
          colour: /^#[0-9a-f]{6}$/i.test(group.colour || "")
            ? group.colour.toLocaleLowerCase()
            : GROUP_COLOURS[index % GROUP_COLOURS.length]
        };
      })
      .sort((first, second) => first.order - second.order)
      .map((group, index) => ({ ...group, order: (index + 1) * 10 }));

    const assignments = value.assignments && typeof value.assignments === "object"
      ? { ...value.assignments }
      : {};
    const validGroupIds = new Set(groups.map((group) => group.id));
    Object.entries(assignments).forEach(([calendarId, groupId]) => {
      if (!validGroupIds.has(groupId)) delete assignments[calendarId];
    });

    const importSeen = value.migrationState
      && value.migrationState.phase2AssignmentImportSeen
      && typeof value.migrationState.phase2AssignmentImportSeen === "object"
      ? value.migrationState.phase2AssignmentImportSeen
      : {};

    const settings = {};
    Object.entries(DEFAULT_SETTINGS).forEach(([name, defaultValue]) => {
      settings[name] = typeof value.settings?.[name] === "boolean" ? value.settings[name] : defaultValue;
    });

    return {
      version: CURRENT_SCHEMA_VERSION,
      groups,
      assignments,
      calendars: value.calendars && typeof value.calendars === "object" ? { ...value.calendars } : {},
      migrationState: { phase2AssignmentImportSeen: { ...importSeen } },
      settings
    };
  }

  function copy(configuration) {
    return normaliseConfiguration(structuredClone(configuration));
  }

  function createGroup(configuration, name) {
    const next = copy(configuration);
    const cleanName = String(name || "").replace(/\s+/g, " ").trim();
    if (!cleanName) throw new Error("Enter a group name.");
    if (next.groups.some((group) => group.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) {
      throw new Error("A group with that name already exists.");
    }
    next.groups.push({
      id: createId(),
      name: cleanName,
      order: (next.groups.length + 1) * 10,
      collapsed: false,
      colour: GROUP_COLOURS[next.groups.length % GROUP_COLOURS.length]
    });
    return normaliseConfiguration(next);
  }

  function renameGroup(configuration, groupId, name) {
    const next = copy(configuration);
    const group = next.groups.find((candidate) => candidate.id === groupId);
    if (!group) throw new Error("That group no longer exists.");
    const cleanName = String(name || "").replace(/\s+/g, " ").trim();
    if (!cleanName) throw new Error("Enter a group name.");
    if (next.groups.some((candidate) => (
      candidate.id !== groupId && candidate.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase()
    ))) throw new Error("A group with that name already exists.");
    group.name = cleanName;
    return normaliseConfiguration(next);
  }

  function deleteGroup(configuration, groupId) {
    const next = copy(configuration);
    if (!next.groups.some((group) => group.id === groupId)) return next;
    next.groups = next.groups.filter((group) => group.id !== groupId);
    Object.entries(next.assignments).forEach(([calendarId, assignedGroupId]) => {
      if (assignedGroupId === groupId) delete next.assignments[calendarId];
    });
    return normaliseConfiguration(next);
  }

  function moveGroup(configuration, groupId, direction) {
    const next = copy(configuration);
    const index = next.groups.findIndex((group) => group.id === groupId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= next.groups.length) return next;
    const [group] = next.groups.splice(index, 1);
    next.groups.splice(destination, 0, group);
    next.groups.forEach((candidate, groupIndex) => {
      candidate.order = (groupIndex + 1) * 10;
    });
    return normaliseConfiguration(next);
  }

  function assignCalendar(configuration, calendarId, groupId) {
    const next = copy(configuration);
    if (!next.calendars[calendarId]) throw new Error("That calendar is not available in stored metadata.");
    if (!groupId) delete next.assignments[calendarId];
    else {
      if (!next.groups.some((group) => group.id === groupId)) throw new Error("That group no longer exists.");
      next.assignments[calendarId] = groupId;
    }
    // Recording the import as seen prevents the original Phase 2 name rule from
    // automatically undoing an explicit Ungrouped selection later.
    next.migrationState.phase2AssignmentImportSeen[calendarId] = true;
    return normaliseConfiguration(next);
  }

  function setSetting(configuration, settingName, value) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, settingName)) {
      throw new Error("Unknown setting.");
    }
    const next = copy(configuration);
    next.settings[settingName] = Boolean(value);
    return normaliseConfiguration(next);
  }

  function setGroupColour(configuration, groupId, colour) {
    const next = copy(configuration);
    const group = next.groups.find((candidate) => candidate.id === groupId);
    if (!group) throw new Error("That group no longer exists.");
    if (!/^#[0-9a-f]{6}$/i.test(colour || "")) throw new Error("Choose a valid group colour.");
    group.colour = colour.toLocaleLowerCase();
    return normaliseConfiguration(next);
  }

  function validateImportedConfiguration(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The file is not a configuration object.");
    if (!Array.isArray(value.groups)) throw new Error("The configuration does not contain a groups list.");
    if (!value.assignments || typeof value.assignments !== "object") throw new Error("The configuration does not contain assignments.");
    if (Number(value.version || 0) > CURRENT_SCHEMA_VERSION) {
      throw new Error(`This configuration uses unsupported schema version ${value.version}.`);
    }
    return normaliseConfiguration(value);
  }

  function toSyncStorage(configuration) {
    const normalised = normaliseConfiguration(configuration);
    return {
      version: normalised.version,
      groups: normalised.groups,
      assignments: normalised.assignments,
      settings: normalised.settings
    };
  }

  function toLocalMetadataStorage(configuration) {
    const normalised = normaliseConfiguration(configuration);
    return {
      calendars: normalised.calendars,
      phase2AssignmentImportSeen: normalised.migrationState.phase2AssignmentImportSeen
    };
  }

  function createStoragePayloads(configuration) {
    const normalised = normaliseConfiguration(configuration);
    const sync = toSyncStorage(normalised);
    const local = toLocalMetadataStorage(normalised);

    // Chrome caps one sync item at 8 KB. For unusually large accounts, retain
    // full functionality by keeping assignments locally rather than allowing a
    // save to fail. Ordinary-sized assignment maps continue to sync.
    if (JSON.stringify(sync).length > SYNC_ITEM_SOFT_LIMIT_BYTES) {
      local.assignments = normalised.assignments;
      sync.assignments = {};
      sync.assignmentsStoredLocally = true;
    }
    return { sync, local };
  }

  function mergeStoredConfiguration(syncValue, localValue) {
    const syncConfiguration = syncValue && typeof syncValue === "object" ? syncValue : {};
    const metadata = localValue && typeof localValue === "object" ? localValue : {};
    const assignments = syncConfiguration.assignmentsStoredLocally
      ? (metadata.assignments || {})
      : (syncConfiguration.assignments || {});
    return normaliseConfiguration({
      ...syncConfiguration,
      assignments,
      // During the v0.5.1 migration, fall back to metadata still present in the
      // old sync item until the new local item has been written successfully.
      calendars: metadata.calendars || syncConfiguration.calendars || {},
      migrationState: {
        phase2AssignmentImportSeen: metadata.phase2AssignmentImportSeen
          || syncConfiguration.migrationState?.phase2AssignmentImportSeen
          || {}
      }
    });
  }

  shared.configurationModel = Object.freeze({
    STORAGE_KEY,
    METADATA_STORAGE_KEY,
    CURRENT_SCHEMA_VERSION,
    DEFAULT_SETTINGS,
    createDefaultConfiguration,
    normaliseConfiguration,
    createGroup,
    renameGroup,
    deleteGroup,
    moveGroup,
    assignCalendar,
    setSetting,
    setGroupColour,
    validateImportedConfiguration,
    toSyncStorage,
    toLocalMetadataStorage,
    createStoragePayloads,
    mergeStoredConfiguration
  });
})(globalThis.GCalGroupsShared = globalThis.GCalGroupsShared || {});
