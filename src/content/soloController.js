(function initialiseSoloController(namespace) {
  "use strict";

  const { LOG_PREFIX } = namespace.constants;
  const EMPTY_STATE = Object.freeze({
    active: false,
    activeGroupId: null,
    mode: null,
    quickApplied: false,
    selectedCalendarIds: Object.freeze([]),
    previousVisibility: Object.freeze({})
  });

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error((response && response.error) || "Unknown service worker response"));
          return;
        }
        resolve(response);
      });
    });
  }

  function createSoloController({ getCalendars, getConfiguration, getScope, setCalendarStates, requestReconcile }) {
    let state = { ...EMPTY_STATE, selectedCalendarIds: [], previousVisibility: {} };
    let operationInProgress = false;
    let currentScope = getScope();

    function isBusy() {
      return operationInProgress;
    }

    async function runExclusive(operationName, operation) {
      if (operationInProgress) {
        console.warn(`${LOG_PREFIX} Ignored ${operationName} because another Solo/All operation is still running.`);
        return false;
      }
      operationInProgress = true;
      requestReconcile("solo operation started");
      try {
        return await operation();
      } finally {
        operationInProgress = false;
        requestReconcile("solo operation finished");
      }
    }

    function getState() {
      return {
        active: state.active,
        activeGroupId: state.activeGroupId,
        mode: state.mode,
        quickApplied: Boolean(state.quickApplied),
        selectedCalendarIds: [...state.selectedCalendarIds],
        previousVisibility: { ...state.previousVisibility }
      };
    }

    async function persist(nextState) {
      state = nextState;
      await sendRuntimeMessage({ type: "GCAL_GROUPS_SOLO_SET", state, scope: currentScope });
    }

    async function clear() {
      state = { ...EMPTY_STATE, selectedCalendarIds: [], previousVisibility: {} };
      await sendRuntimeMessage({ type: "GCAL_GROUPS_SOLO_CLEAR", scope: currentScope });
    }

    function buildSoloTargets(groupCalendarIds, allCalendars) {
      const included = new Set(groupCalendarIds);
      return Object.fromEntries(
        allCalendars.map((calendar) => [calendar.calendarId, included.has(calendar.calendarId)])
      );
    }

    async function toggleSoloNow(groupId, groupCalendarIds) {
      // Quick Solo owns row selection until the user restores or exits it.
      if (state.active && state.mode === "quick") return false;

      const calendars = getCalendars();
      if (calendars.length === 0 || groupCalendarIds.length === 0) return false;

      if (state.active && state.activeGroupId === groupId) {
        const snapshot = { ...state.previousVisibility };
        const shouldRestore = getConfiguration().settings.restorePreviousStateAfterSolo;
        console.info(`${LOG_PREFIX} Exiting Solo${shouldRestore ? " and restoring the original visibility snapshot" : " without restoration"}.`, snapshot);
        const restored = shouldRestore ? await setCalendarStates(snapshot) : true;
        if (!restored) {
          console.error(`${LOG_PREFIX} Solo restoration was incomplete; preserving the snapshot so it can be retried.`);
          return false;
        }
        await clear();
        requestReconcile("solo session exited");
        requestReconcile("solo restoration complete");
        return true;
      }

      const switchingGroups = state.active && state.activeGroupId !== groupId;
      const previousVisibility = state.active
        ? state.previousVisibility
        : Object.fromEntries(calendars.map((calendar) => [calendar.calendarId, calendar.visible]));

      await persist({
        active: true,
        activeGroupId: groupId,
        mode: "group",
        quickApplied: false,
        selectedCalendarIds: [],
        previousVisibility
      });

      console.info(`${LOG_PREFIX} ${switchingGroups ? "Switching" : "Entering"} Solo`, {
        activeGroupId: groupId,
        snapshotCalendarCount: Object.keys(previousVisibility).length
      });
      requestReconcile("solo session changed");
      const converged = await setCalendarStates(buildSoloTargets(groupCalendarIds, calendars));
      requestReconcile("solo visibility converged");
      return converged;
    }

    function toggleSolo(groupId, groupCalendarIds) {
      return runExclusive("Solo", () => toggleSoloNow(groupId, groupCalendarIds));
    }

    async function restoreAndExit(label) {
      const snapshot = { ...state.previousVisibility };
      const restored = await setCalendarStates(snapshot);
      if (!restored) {
        console.error(`${LOG_PREFIX} ${label} restoration was incomplete; preserving the snapshot for retry.`);
        return false;
      }
      await clear();
      requestReconcile(`${label.toLocaleLowerCase()} restored`);
      return true;
    }

    async function toggleQuickSoloNow() {
      if (state.active && state.mode === "quick") {
        if (state.selectedCalendarIds.length === 0 || state.quickApplied) return false;
        const calendars = getCalendars();
        const selected = new Set(state.selectedCalendarIds);
        const targets = Object.fromEntries(
          calendars.map((calendar) => [calendar.calendarId, selected.has(calendar.calendarId)])
        );
        const converged = await setCalendarStates(targets);
        if (!converged) return false;
        await persist({ ...state, quickApplied: true });
        requestReconcile("quick solo selection applied");
        return true;
      }

      const calendars = getCalendars();
      if (calendars.length === 0) return false;
      const switchingFromGroupSolo = state.active && state.mode === "group";
      const previousVisibility = state.active
        ? state.previousVisibility
        : Object.fromEntries(calendars.map((calendar) => [calendar.calendarId, calendar.visible]));
      const selectedCalendarIds = switchingFromGroupSolo
        ? calendars.filter((calendar) => calendar.visible).map((calendar) => calendar.calendarId)
        : [];

      await persist({
        active: true,
        activeGroupId: null,
        mode: "quick",
        quickApplied: switchingFromGroupSolo,
        selectedCalendarIds,
        previousVisibility
      });
      console.info(`${LOG_PREFIX} ${switchingFromGroupSolo ? "Switched to" : "Entered"} Quick Solo selection mode.`, {
        selectedCalendarCount: selectedCalendarIds.length,
        snapshotCalendarCount: Object.keys(previousVisibility).length
      });
      requestReconcile("quick solo mode changed");
      return true;
    }

    function toggleQuickSolo() {
      return runExclusive("Quick Solo", toggleQuickSoloNow);
    }

    async function toggleQuickCalendarNow(calendarId) {
      if (!state.active || state.mode !== "quick") return false;
      const calendars = getCalendars();
      if (!calendars.some((calendar) => calendar.calendarId === calendarId)) return false;

      const selected = new Set(state.selectedCalendarIds);
      if (selected.has(calendarId)) selected.delete(calendarId);
      else selected.add(calendarId);
      const selectedCalendarIds = Array.from(selected);
      // Selection is deliberately cheap. Native checkboxes are only changed
      // after the user confirms the complete set with Apply selected.
      await persist({ ...state, quickApplied: false, selectedCalendarIds });
      requestReconcile("quick solo selection changed");
      return true;
    }

    function toggleQuickCalendar(calendarId) {
      return runExclusive("Quick Solo selection", () => toggleQuickCalendarNow(calendarId));
    }

    async function showAllNow() {
      if (state.active && state.mode === "quick") return restoreAndExit("Quick Solo");

      const configuration = getConfiguration();
      const representedCalendars = getCalendars().filter((calendar) => (
        configuration.settings.includeUngroupedInAll || Boolean(configuration.assignments[calendar.calendarId])
      ));
      const targets = Object.fromEntries(representedCalendars.map((calendar) => [calendar.calendarId, true]));
      await clear();
      console.info(`${LOG_PREFIX} All command: clearing Solo state and showing every represented calendar.`);
      requestReconcile("show all command");
      const converged = await setCalendarStates(targets);
      requestReconcile("show all converged");
      return converged;
    }

    function showAll() {
      return runExclusive("All", showAllNow);
    }

    async function hydrate() {
      try {
        const response = await sendRuntimeMessage({ type: "GCAL_GROUPS_SOLO_GET", scope: currentScope });
        if (response.state && response.state.active && response.state.previousVisibility) {
          state = {
            ...response.state,
            mode: response.state.mode || "group",
            quickApplied: Boolean(response.state.quickApplied),
            selectedCalendarIds: Array.isArray(response.state.selectedCalendarIds)
              ? response.state.selectedCalendarIds
              : []
          };
          const validGroupIds = new Set(getConfiguration().groups.map((group) => group.id));
          validGroupIds.add("ungrouped");

          // Phase 4 replaces the old test IDs with generated persistent IDs. If
          // Chrome retained an active Phase 3 session, restore its exact snapshot
          // instead of leaving the interface in an un-exitable stale Solo state.
          if (state.mode !== "quick" && !validGroupIds.has(state.activeGroupId)) {
            const staleSnapshot = { ...state.previousVisibility };
            console.warn(`${LOG_PREFIX} Restoring a Solo session that referenced an obsolete group ID.`);
            const restored = await setCalendarStates(staleSnapshot);
            if (restored) await clear();
            requestReconcile("obsolete solo session restored");
            return;
          }
          console.info(`${LOG_PREFIX} Recovered active Solo session`, {
            activeGroupId: state.activeGroupId,
            snapshotCalendarCount: Object.keys(state.previousVisibility).length
          });
        }
      } catch (error) {
        console.error(`${LOG_PREFIX} Could not recover Solo runtime state`, error);
      }
      requestReconcile("solo runtime state loaded");
    }

    function switchScope(nextScope) {
      if (!nextScope || nextScope === currentScope) return;
      currentScope = nextScope;
      state = { ...EMPTY_STATE, selectedCalendarIds: [], previousVisibility: {} };
      requestReconcile("account scope changed");
      hydrate();
    }

    async function validateConfigurationNow() {
      if (!state.active) return true;
      if (state.mode === "quick") return true;
      const validGroupIds = new Set(getConfiguration().groups.map((group) => group.id));
      validGroupIds.add("ungrouped");
      if (validGroupIds.has(state.activeGroupId)) return true;

      const staleSnapshot = { ...state.previousVisibility };
      console.warn(`${LOG_PREFIX} The active Solo group was deleted; restoring its original snapshot.`);
      const restored = await setCalendarStates(staleSnapshot);
      if (!restored) return false;
      await clear();
      requestReconcile("deleted solo group cleared");
      requestReconcile("deleted solo group restored");
      return true;
    }

    function validateConfiguration() {
      if (!state.active) return Promise.resolve(true);
      if (state.mode === "quick") return Promise.resolve(true);
      const validGroupIds = new Set(getConfiguration().groups.map((group) => group.id));
      validGroupIds.add("ungrouped");
      if (validGroupIds.has(state.activeGroupId)) return Promise.resolve(true);
      return runExclusive("configuration recovery", validateConfigurationNow);
    }

    return {
      getState,
      toggleSolo,
      toggleQuickSolo,
      toggleQuickCalendar,
      showAll,
      hydrate,
      validateConfiguration,
      isBusy,
      switchScope
    };
  }

  namespace.soloController = { createSoloController };
})(window.GCalGroups = window.GCalGroups || {});
