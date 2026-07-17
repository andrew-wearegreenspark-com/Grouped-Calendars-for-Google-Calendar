(function initialiseNativeCalendarBridge(namespace) {
  "use strict";

  const { LOG_PREFIX, POST_CLICK_CHECKS_MS } = namespace.constants;

  function createNativeCalendarBridge(requestReconcile, reportUnavailableCalendars = () => {}) {
    let calendarsById = new Map();
    let visibilityCommandId = 0;
    let commandStatus = "idle";
    let errorClearTimer = null;

    function isBusy() {
      return commandStatus === "busy";
    }

    function getCommandStatus() {
      return commandStatus;
    }

    function updateCommandStatus(nextStatus) {
      commandStatus = nextStatus;
      window.clearTimeout(errorClearTimer);
      requestReconcile(`bulk command status: ${nextStatus}`);
      if (nextStatus === "error") {
        errorClearTimer = window.setTimeout(() => {
          commandStatus = "idle";
          requestReconcile("bulk command error cleared");
        }, 8000);
      }
    }

    function updateCalendars(calendars) {
      calendarsById = new Map(calendars.map((calendar) => [calendar.calendarId, calendar]));
    }

    function delay(milliseconds) {
      return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    }

    function clickConnectedCalendar(calendar, scheduleChecks = true) {
      const control = calendar.nativeControl;
      const before = namespace.calendarDiscovery.readVisibility(control);
      console.debug(`${LOG_PREFIX} Triggering native control`, {
        calendarId: calendar.calendarId,
        displayName: calendar.displayName,
        before,
        matchingNativeControl: control
      });

      control.click();

      if (scheduleChecks) {
        POST_CLICK_CHECKS_MS.forEach((checkDelay) => {
          window.setTimeout(() => requestReconcile(`post-click confirmation (${checkDelay}ms)`), checkDelay);
        });
      }
      return true;
    }

    function discoverConnectedCalendars() {
      const discovery = namespace.calendarDiscovery.discoverCalendars();
      discovery.calendars.forEach((calendar) => calendarsById.set(calendar.calendarId, calendar));
      return new Map(discovery.calendars.map((calendar) => [calendar.calendarId, calendar]));
    }

    function normaliseText(value) {
      return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
    }

    function findNativeSectionButtons() {
      const sectionNames = new Set(["my calendars", "other calendars"]);
      return Array.from(document.querySelectorAll("button[aria-expanded]")).filter((button) => {
        const text = normaliseText(button.textContent);
        return Array.from(sectionNames).some((name) => text.startsWith(name));
      });
    }

    function findScrollContainer(element) {
      let candidate = element;
      while (candidate && candidate !== document.body) {
        const overflowY = window.getComputedStyle(candidate).overflowY;
        if (["auto", "scroll"].includes(overflowY) && candidate.scrollHeight > candidate.clientHeight) {
          return candidate;
        }
        candidate = candidate.parentElement;
      }
      return null;
    }

    async function materialiseNativeControls() {
      const sectionButtons = findNativeSectionButtons();
      const originallyCollapsed = sectionButtons
        .filter((button) => button.getAttribute("aria-expanded") !== "true")
        .map((button) => normaliseText(button.textContent).startsWith("my calendars") ? "my calendars" : "other calendars");
      const scrollContainer = findScrollContainer(sectionButtons[0]);
      const previousScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

      sectionButtons.forEach((button) => {
        if (button.getAttribute("aria-expanded") !== "true") button.click();
      });

      if (originallyCollapsed.length) {
        console.debug(`${LOG_PREFIX} Temporarily expanded native sections for a verified visibility command.`, originallyCollapsed);
        await delay(250);
      }

      async function restoreNativeSections() {
        if (originallyCollapsed.length) {
          const currentButtons = findNativeSectionButtons();
          currentButtons.forEach((button) => {
            const sectionName = normaliseText(button.textContent).startsWith("my calendars")
              ? "my calendars"
              : "other calendars";
            if (originallyCollapsed.includes(sectionName) && button.getAttribute("aria-expanded") === "true") {
              button.click();
            }
          });
          await delay(100);
        }
        if (scrollContainer && scrollContainer.isConnected) scrollContainer.scrollTop = previousScrollTop;
      }

      return { restoreNativeSections, scrollContainer };
    }

    function buildScrollPositions(scrollContainer) {
      if (!scrollContainer || !scrollContainer.isConnected) return [null];

      const maximum = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      const step = Math.max(240, Math.floor(scrollContainer.clientHeight * 0.7));
      const positions = [scrollContainer.scrollTop, 0];
      for (let position = step; position < maximum; position += step) positions.push(position);
      positions.push(maximum);

      // Avoid repeating the same virtualised viewport when the current position
      // is already close to one of the generated sweep positions.
      return positions.filter((position, index) => (
        positions.findIndex((candidate) => Math.abs(candidate - position) < 8) === index
      ));
    }

    function lockManualSidebarScrolling(scrollContainer) {
      if (!scrollContainer || !scrollContainer.isConnected) return () => {};

      const preventScrollInput = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      const preventScrollKeys = (event) => {
        const scrollKeys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
        if (scrollKeys.has(event.key) && scrollContainer.contains(event.target)) preventScrollInput(event);
      };
      const preventScrollbarDrag = (event) => {
        const bounds = scrollContainer.getBoundingClientRect();
        const scrollbarWidth = Math.max(16, scrollContainer.offsetWidth - scrollContainer.clientWidth);
        if (event.clientX >= bounds.right - scrollbarWidth) preventScrollInput(event);
      };

      // The verified bulk routine temporarily owns this one scroll container.
      // Blocking manual input prevents a wheel, touch, keyboard, or scrollbar
      // action from changing which virtualised native rows are being processed.
      scrollContainer.addEventListener("wheel", preventScrollInput, { capture: true, passive: false });
      scrollContainer.addEventListener("touchmove", preventScrollInput, { capture: true, passive: false });
      scrollContainer.addEventListener("pointerdown", preventScrollbarDrag, true);
      document.addEventListener("keydown", preventScrollKeys, true);

      return () => {
        scrollContainer.removeEventListener("wheel", preventScrollInput, true);
        scrollContainer.removeEventListener("touchmove", preventScrollInput, true);
        scrollContainer.removeEventListener("pointerdown", preventScrollbarDrag, true);
        document.removeEventListener("keydown", preventScrollKeys, true);
      };
    }

    async function setCalendarStates(targetVisibility) {
      if (isBusy()) {
        console.warn(`${LOG_PREFIX} Ignored a bulk visibility command because another command is still running.`);
        return false;
      }

      updateCommandStatus("busy");
      const commandId = ++visibilityCommandId;
      let materialisation;
      try {
        materialisation = await materialiseNativeControls();
      } catch (error) {
        console.error(`${LOG_PREFIX} Could not prepare native calendars for a bulk command`, error);
        updateCommandStatus("error");
        return false;
      }
      const { restoreNativeSections, scrollContainer } = materialisation;
      const unlockManualSidebarScrolling = lockManualSidebarScrolling(scrollContainer);
      let result = { mismatches: [], missingIds: [] };
      const confirmedIds = new Set();
      const lastObserved = new Map();
      const targetEntries = Object.entries(targetVisibility);

      try {
        // Google virtualises a long sidebar: while Grouped is visible, many
        // native calendar rows do not exist in the DOM. Sweep the scrollable
        // sidebar and confirm each calendar when its native row is materialised.
        for (let pass = 1; pass <= 4 && commandId === visibilityCommandId; pass += 1) {
          const positions = buildScrollPositions(scrollContainer);

          for (const position of positions) {
            if (commandId !== visibilityCommandId) break;
            if (position !== null && scrollContainer && scrollContainer.isConnected) {
              scrollContainer.scrollTop = position;
              await delay(140);
            }

            let connectedById = discoverConnectedCalendars();
            for (const [calendarId, targetVisible] of targetEntries) {
              if (commandId !== visibilityCommandId) break;
              let calendar = connectedById.get(calendarId);
              if (!calendar || !calendar.nativeControl || !calendar.nativeControl.isConnected) continue;

              const actualVisible = namespace.calendarDiscovery.readVisibility(calendar.nativeControl);
              lastObserved.set(calendarId, {
                calendarId,
                displayName: calendar.displayName,
                targetVisible,
                actualVisible
              });

              if (actualVisible === targetVisible) {
                confirmedIds.add(calendarId);
                continue;
              }

              confirmedIds.delete(calendarId);
              const clickedControl = calendar.nativeControl;
              clickConnectedCalendar(calendar, false);
              await delay(140);

              // Rediscover after every click because Google may replace the row.
              connectedById = discoverConnectedCalendars();
              calendar = connectedById.get(calendarId);
              const verificationControl = calendar && calendar.nativeControl
                ? calendar.nativeControl
                : clickedControl;
              const verifiedVisible = namespace.calendarDiscovery.readVisibility(verificationControl);
              lastObserved.set(calendarId, {
                calendarId,
                displayName: calendar ? calendar.displayName : lastObserved.get(calendarId).displayName,
                targetVisible,
                actualVisible: verifiedVisible
              });
              if (verifiedVisible === targetVisible) confirmedIds.add(calendarId);
            }

            if (confirmedIds.size === targetEntries.length) break;
          }

          const remainingIds = targetEntries
            .map(([calendarId]) => calendarId)
            .filter((calendarId) => !confirmedIds.has(calendarId));
          console.info(`${LOG_PREFIX} Visibility verification pass ${pass}`, {
            requestedCalendars: targetEntries.length,
            confirmedCalendars: confirmedIds.size,
            remainingCalendars: remainingIds.length,
            virtualisedScrollPositions: positions.length
          });

          if (remainingIds.length === 0) break;
          await delay(300);
        }

        // A virtualised control may not be connected at the end of the sweep.
        // Report only calendars that were never individually confirmed.
        if (commandId === visibilityCommandId) {
          const remainingIds = targetEntries
            .map(([calendarId]) => calendarId)
            .filter((calendarId) => !confirmedIds.has(calendarId));
          result = {
            mismatches: remainingIds.map((calendarId) => lastObserved.get(calendarId)).filter(Boolean),
            missingIds: remainingIds.filter((calendarId) => !lastObserved.has(calendarId))
          };
        }
      } catch (error) {
        console.error(`${LOG_PREFIX} Bulk visibility command failed unexpectedly`, error);
        updateCommandStatus("error");
        return false;
      } finally {
        try {
          if (commandId === visibilityCommandId) await restoreNativeSections();
        } catch (error) {
          console.error(`${LOG_PREFIX} Could not fully restore the native sidebar after a bulk command`, error);
        }
        unlockManualSidebarScrolling();
        requestReconcile("verified visibility command complete");
      }

      if (commandId === visibilityCommandId && (result.mismatches.length || result.missingIds.length)) {
        console.error(`${LOG_PREFIX} Visibility command did not fully converge`, {
          mismatches: result.mismatches,
          missingCalendarIds: result.missingIds
        });
        if (result.missingIds.length) reportUnavailableCalendars(result.missingIds);
        updateCommandStatus("error");
        return false;
      }

      console.info(`${LOG_PREFIX} Visibility command converged successfully.`);
      updateCommandStatus("idle");
      return true;
    }

    function toggleCalendar(calendarId) {
      const calendar = calendarsById.get(calendarId);
      if (calendar && calendar.nativeControl && calendar.nativeControl.isConnected) {
        return clickConnectedCalendar(calendar);
      }

      if (!calendar) {
        console.error(`${LOG_PREFIX} Failed mapping: unknown calendar`, calendarId);
        requestReconcile("failed mapping");
        return false;
      }

      // A collapsed native section detaches its checkbox. Use the same verified
      // command path as Solo so the section is expanded and restored safely.
      console.warn(`${LOG_PREFIX} Native control is detached; materialising it before toggling`, calendarId);
      return setCalendarStates({ [calendarId]: !calendar.visible });
    }

    function setCalendarsVisible(calendarIds, targetVisible) {
      const targets = Object.fromEntries(calendarIds.map((calendarId) => [calendarId, targetVisible]));
      return setCalendarStates(targets);
    }

    return {
      updateCalendars,
      toggleCalendar,
      setCalendarsVisible,
      setCalendarStates,
      isBusy,
      getCommandStatus
    };
  }

  namespace.nativeCalendarBridge = { createNativeCalendarBridge };
})(window.GCalGroups = window.GCalGroups || {});
