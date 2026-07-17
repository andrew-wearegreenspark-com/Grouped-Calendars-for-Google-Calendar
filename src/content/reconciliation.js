(function initialiseReconciliation(namespace) {
  "use strict";

  const { LOG_PREFIX } = namespace.constants;

  function createReconciler() {
    let bridge;
    let solo;
    let configurationStore;
    let lastSignature = "";
    let lastOtherHeading = null;
    let currentAccountScope = null;
    const calendarCache = new Map();
    let running = false;
    let rerunRequested = false;

    function accountScope() {
      const match = window.location.pathname.match(/\/calendar\/u\/([^/]+)/i);
      return match ? `account:${match[1]}` : "account:default";
    }

    function signatureFor(calendars, configuration) {
      const calendarSignature = calendars
        .map((calendar) => [
          calendar.calendarId,
          calendar.displayName,
          calendar.nativeSection,
          calendar.visible,
          calendar.colour
        ].join("|"))
        .join(";");
      return `${calendarSignature}::${JSON.stringify(configuration)}`;
    }

    function mergeWithCache(discoveredCalendars) {
      // Google virtualizes native rows while the sidebar scrolls. Retaining rows
      // that are temporarily absent keeps our section height and ordering stable,
      // which prevents a feedback loop between scrolling and rediscovery.
      // Runtime fallback IDs cannot be trusted after their element disappears;
      // pruning them also removes any transient Google overlay control captured
      // by an older extension version.
      calendarCache.forEach((calendar, calendarId) => {
        if (!calendar.identifierStable && (!calendar.nativeControl || !calendar.nativeControl.isConnected)) {
          calendarCache.delete(calendarId);
        }
      });
      discoveredCalendars.forEach((calendar) => calendarCache.set(calendar.calendarId, calendar));
      return Array.from(calendarCache.values());
    }

    function forgetUnavailableCalendars(calendarIds) {
      calendarIds.forEach((calendarId) => calendarCache.delete(calendarId));
      lastSignature = "";
      console.warn(`${LOG_PREFIX} Removed calendars absent from every verified sidebar sweep.`, calendarIds);
      reconcile("unavailable calendars pruned");
    }

    function reconcile(reason = "unspecified") {
      if (running) {
        rerunRequested = true;
        return;
      }

      running = true;
      try {
        const nextAccountScope = accountScope();
        if (currentAccountScope && currentAccountScope !== nextAccountScope) {
          calendarCache.clear();
          lastSignature = "";
          lastOtherHeading = null;
          solo.switchScope(nextAccountScope);
          console.info(`${LOG_PREFIX} Google account route changed; cleared the native calendar cache.`, {
            previousScope: currentAccountScope,
            nextScope: nextAccountScope
          });
        }
        currentAccountScope = nextAccountScope;

        const result = namespace.calendarDiscovery.discoverCalendars();
        if (!result.ready) return;

        const calendars = mergeWithCache(result.calendars);
        const configuration = configurationStore.getConfiguration();
        const signature = signatureFor(calendars, configuration);
        const rootMissing = !document.getElementById(namespace.constants.ROOT_ID);
        const changed = signature !== lastSignature;
        const sectionReplaced = Boolean(lastOtherHeading && lastOtherHeading !== result.headings["other-calendars"]);

        const forceUiRender = reason.includes("solo") || reason.includes("show all") || reason.includes("bulk command");

        if (changed || rootMissing || sectionReplaced || forceUiRender || reason.includes("initial")) {
          console.debug(`${LOG_PREFIX} Reconciliation`, {
            reason,
            rerenderDetected: sectionReplaced || rootMissing,
            visibleNativeRowCount: result.calendars.length,
            cachedCalendarCount: calendars.length,
            stateChanged: changed
          });
          namespace.calendarDiscovery.logDiscovery(calendars);
        }

        // Always refresh the bridge because Google may replace native elements
        // without changing their calendar IDs or checked state.
        bridge.updateCalendars(calendars);

        if (reason.includes("configuration")) {
          solo.validateConfiguration().catch((error) => {
            console.error(`${LOG_PREFIX} Could not reconcile Solo with the new configuration`, error);
          });
        }

        // Metadata and Phase 2 test assignments are reconciled asynchronously.
        // A resulting storage change schedules a second render with the updated
        // assignments without blocking Google Calendar's own rerender.
        configurationStore.reconcileCalendars(calendars).catch((error) => {
          console.error(`${LOG_PREFIX} Configuration reconciliation failed`, error);
        });

        // Rebuilding identical controls during every scroll mutation caused the
        // sidebar to change height and jump. Render only for meaningful changes.
        if (changed || rootMissing || sectionReplaced || forceUiRender) {
          namespace.groupedSectionRenderer.render({
            calendars,
            headings: result.headings,
            onToggle: bridge.toggleCalendar,
            onSetCalendarsVisible: bridge.setCalendarsVisible,
            soloState: solo.getState(),
            onToggleSolo: solo.toggleSolo,
            onToggleQuickSolo: solo.toggleQuickSolo,
            onToggleQuickCalendar: solo.toggleQuickCalendar,
            onShowAll: solo.showAll,
            onManage: () => chrome.runtime.openOptionsPage(),
            configuration,
            onGroupCollapsed: configurationStore.setGroupCollapsed,
            busy: bridge.isBusy() || solo.isBusy(),
            commandStatus: bridge.getCommandStatus()
          });
        }

        lastSignature = signature;
        lastOtherHeading = result.headings["other-calendars"];
      } catch (error) {
        console.error(`${LOG_PREFIX} Reconciliation failed`, error);
      } finally {
        running = false;
        if (rerunRequested) {
          rerunRequested = false;
          window.queueMicrotask(() => reconcile("queued rerender"));
        }
      }
    }

    configurationStore = namespace.configurationStore.createConfigurationStore(reconcile);
    bridge = namespace.nativeCalendarBridge.createNativeCalendarBridge(reconcile, forgetUnavailableCalendars);
    solo = namespace.soloController.createSoloController({
      getCalendars: () => Array.from(calendarCache.values()),
      getConfiguration: configurationStore.getConfiguration,
      getScope: () => currentAccountScope || accountScope(),
      setCalendarStates: bridge.setCalendarStates,
      requestReconcile: reconcile
    });
    return {
      reconcile,
      hydrateConfiguration: configurationStore.hydrate,
      hydrateSolo: solo.hydrate
    };
  }

  namespace.reconciliation = { createReconciler };
})(window.GCalGroups = window.GCalGroups || {});
