(function initialiseGroupedSectionRenderer(namespace) {
  "use strict";

  const { ROOT_ID, LOG_PREFIX } = namespace.constants;
  const collapsedGroupIds = new Set();

  function findStableMountAnchor(otherHeading) {
    let candidate = otherHeading;

    // Mount beside Google's Calendar list wrapper, not inside the virtualized
    // native list. This preserves the Phase 1 scrolling stability fix.
    for (let depth = 0; candidate && depth < 10; depth += 1) {
      const ownsCalendarListHeading = Array.from(candidate.children).some((child) => {
        const isHeading = /^H[1-6]$/.test(child.tagName) || child.getAttribute("role") === "heading";
        return isHeading && child.textContent.replace(/\s+/g, " ").trim().toLocaleLowerCase() === "calendar list";
      });

      if (ownsCalendarListHeading && candidate.parentElement) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  }

  function findSectionContainer(otherHeading, calendars) {
    const otherRows = calendars
      .filter((calendar) => calendar.nativeSection === "other-calendars")
      .map((calendar) => calendar.nativeRow);

    let candidate = otherHeading;
    for (let depth = 0; candidate && depth < 8; depth += 1) {
      if (otherRows.every((row) => candidate.contains(row))) return candidate;
      candidate = candidate.parentElement;
    }
    return otherHeading.parentElement;
  }

  function ensureRoot(headings, calendars) {
    let root = document.getElementById(ROOT_ID);
    const otherHeading = headings["other-calendars"];
    if (!otherHeading) return null;

    const mountAnchor = findStableMountAnchor(otherHeading) || findSectionContainer(otherHeading, calendars);
    if (!mountAnchor || !mountAnchor.parentElement) return null;

    if (!root) {
      root = document.createElement("section");
      root.id = ROOT_ID;
      root.className = "gcal-groups-root";
      root.dataset.extensionOwned = "true";
      mountAnchor.insertAdjacentElement("afterend", root);
      console.info(`${LOG_PREFIX} Appended Grouped section.`, root);
    } else if (root.previousElementSibling !== mountAnchor) {
      mountAnchor.insertAdjacentElement("afterend", root);
    }
    return root;
  }

  function createMaterialIcon(name, className) {
    const icon = document.createElement("i");
    icon.className = `${className} google-material-icons notranslate`;
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = name;
    return icon;
  }

  function createTopHeader(
    root,
    onToggleCollapsed,
    onToggleQuickSolo,
    onShowAll,
    onManage,
    busy,
    commandStatus,
    soloState
  ) {
    const header = document.createElement("div");
    header.className = "gcal-groups-header";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "gcal-groups-collapse";
    button.setAttribute("aria-label", "Collapse Grouped");
    button.setAttribute("aria-expanded", "true");
    button.disabled = busy;
    button.addEventListener("click", onToggleCollapsed);

    const title = document.createElement("span");
    title.className = "gcal-groups-title";
    title.textContent = "Grouped";

    button.append(title, createMaterialIcon("keyboard_arrow_up", "gcal-groups-collapse-icon"));

    const quickActive = soloState.active && soloState.mode === "quick";
    const quickApplied = quickActive && soloState.quickApplied;
    const selectedCount = (soloState.selectedCalendarIds || []).length;
    const quickButton = document.createElement("button");
    quickButton.type = "button";
    quickButton.className = "gcal-groups-quick";
    quickButton.dataset.quickStatus = quickApplied ? "applied" : quickActive ? "selecting" : "idle";
    quickButton.textContent = !quickActive
      ? "Quick solo"
      : quickApplied
        ? "Applied"
        : selectedCount > 0
          ? `Apply selected (${selectedCount})`
          : "Select calendars";
    quickButton.setAttribute("aria-pressed", String(quickActive));
    quickButton.setAttribute(
      "aria-label",
      quickActive ? "Apply the selected calendars for Quick Solo" : "Start selecting calendars for Quick Solo"
    );
    quickButton.title = quickApplied
      ? "The current Quick Solo selection is active"
      : quickActive
        ? "Apply the complete selection"
        : "Choose calendars before applying Quick Solo";
    quickButton.disabled = busy || (quickActive && (selectedCount === 0 || quickApplied));
    quickButton.addEventListener("click", () => onToggleQuickSolo());

    const allButton = document.createElement("button");
    allButton.type = "button";
    allButton.className = "gcal-groups-all";
    allButton.textContent = quickActive ? "Restore" : "All";
    allButton.setAttribute(
      "aria-label",
      quickActive ? "Restore calendars from before Quick Solo" : "Show all grouped calendars and end Solo"
    );
    allButton.disabled = busy;
    allButton.addEventListener("click", () => onShowAll());

    const manageButton = document.createElement("button");
    manageButton.type = "button";
    manageButton.className = "gcal-groups-manage";
    manageButton.setAttribute("aria-label", "Manage grouped calendars");
    manageButton.title = "Manage grouped calendars";
    manageButton.disabled = busy;
    manageButton.append(createMaterialIcon("more_vert", "gcal-groups-manage-icon"));
    manageButton.addEventListener("click", () => onManage());

    const actions = document.createElement("div");
    actions.className = "gcal-groups-actions";
    actions.append(quickButton, allButton);

    header.append(button, manageButton);
    root.append(header, actions);
    if (commandStatus === "busy" || commandStatus === "error") {
      const status = document.createElement("span");
      status.className = `gcal-groups-command-status gcal-groups-command-status--${commandStatus}`;
      status.setAttribute("role", "status");
      status.textContent = commandStatus === "busy" ? "Updating…" : "Some calendars were not updated";
      root.append(status);
    }
  }

  function visibilityState(calendars) {
    if (calendars.length === 0) return "false";
    const visibleCount = calendars.filter((calendar) => calendar.visible).length;
    if (visibleCount === 0) return "false";
    if (visibleCount === calendars.length) return "true";
    return "mixed";
  }

  function createGroupVisibilityButton(group, onSetCalendarsVisible, busy, quickActive) {
    const state = visibilityState(group.calendars);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gcal-groups-group-visibility";
    button.setAttribute("role", "checkbox");
    button.setAttribute("aria-checked", state);
    button.setAttribute("aria-label", `${state === "true" ? "Hide" : "Show"} all calendars in ${group.name}`);
    button.disabled = group.calendars.length === 0 || busy || quickActive;

    const checkbox = document.createElement("span");
    checkbox.className = "gcal-groups-group-checkbox";
    checkbox.setAttribute("aria-hidden", "true");
    checkbox.textContent = state === "true" ? "✓" : state === "mixed" ? "−" : "";
    button.append(checkbox);

    button.addEventListener("click", () => {
      const calendarIds = group.calendars.map((calendar) => calendar.calendarId);
      onSetCalendarsVisible(calendarIds, state !== "true");
    });
    return button;
  }

  function createCalendarRow(calendar, onToggle, onToggleQuickCalendar, busy, quickActive, quickSelectedIds) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "gcal-groups-calendar";
    row.dataset.calendarId = calendar.calendarId;
    const quickSelected = quickSelectedIds.has(calendar.calendarId);
    if (quickActive) {
      row.setAttribute("aria-pressed", String(quickSelected));
      row.setAttribute("aria-label", `${quickSelected ? "Remove" : "Select"} ${calendar.displayName} for Quick Solo`);
    } else {
      row.setAttribute("role", "checkbox");
      row.setAttribute("aria-checked", String(calendar.visible));
      row.setAttribute("aria-label", `${calendar.visible ? "Hide" : "Show"} ${calendar.displayName}`);
    }
    row.dataset.quickMode = String(quickActive);
    row.dataset.quickSelected = String(quickSelected);
    row.disabled = busy;
    row.title = `${calendar.displayName} — ${calendar.nativeSection === "my-calendars" ? "My calendars" : "Other calendars"}`;
    row.addEventListener("click", () => {
      if (quickActive) onToggleQuickCalendar(calendar.calendarId);
      else onToggle(calendar.calendarId);
    });

    const checkbox = document.createElement("span");
    checkbox.className = "gcal-groups-checkbox";
    checkbox.setAttribute("aria-hidden", "true");
    checkbox.style.setProperty("--calendar-colour", calendar.colour);
    checkbox.textContent = (quickActive ? quickSelected : calendar.visible) ? "✓" : "";

    const name = document.createElement("span");
    name.className = "gcal-groups-calendar-name";
    name.textContent = calendar.displayName;

    row.append(checkbox, name);
    return row;
  }

  function createGroup(
    group,
    onToggle,
    onToggleQuickCalendar,
    onSetCalendarsVisible,
    soloState,
    onToggleSolo,
    onGroupCollapsed,
    busy
  ) {
    const quickActive = soloState.active && soloState.mode === "quick";
    const quickSelectedIds = new Set(soloState.selectedCalendarIds || []);
    const section = document.createElement("section");
    section.className = "gcal-groups-group";
    section.dataset.groupId = group.id;
    section.dataset.automatic = String(group.automatic);
    section.dataset.soloActive = String(soloState.active && soloState.activeGroupId === group.id);
    section.style.setProperty("--group-colour", group.colour || "#5f6368");

    const header = document.createElement("div");
    header.className = "gcal-groups-group-header";
    header.append(createGroupVisibilityButton(group, onSetCalendarsVisible, busy, quickActive));

    const collapseButton = document.createElement("button");
    collapseButton.type = "button";
    collapseButton.className = "gcal-groups-group-collapse";
    let collapsed = group.automatic ? collapsedGroupIds.has(group.id) : group.collapsed;
    collapseButton.setAttribute("aria-expanded", String(!collapsed));
    collapseButton.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${group.name}`);
    collapseButton.disabled = busy;

    const name = document.createElement("span");
    name.className = "gcal-groups-group-name";
    name.textContent = group.name;

    const count = document.createElement("span");
    count.className = "gcal-groups-group-count";
    count.textContent = String(group.calendars.length);
    count.setAttribute("aria-label", `${group.calendars.length} calendars`);

    collapseButton.append(name, count);
    header.append(collapseButton);

    const soloButton = document.createElement("button");
    soloButton.type = "button";
    soloButton.className = "gcal-groups-solo";
    soloButton.textContent = "Solo";
    soloButton.disabled = group.calendars.length === 0 || busy || quickActive;
    soloButton.setAttribute("aria-pressed", String(soloState.active && soloState.activeGroupId === group.id));
    soloButton.setAttribute(
      "aria-label",
      `${soloState.active && soloState.activeGroupId === group.id ? "Exit Solo for" : "Solo"} ${group.name}`
    );
    soloButton.addEventListener("click", () => {
      onToggleSolo(group.id, group.calendars.map((calendar) => calendar.calendarId));
    });
    header.append(soloButton);

    const iconButton = document.createElement("button");
    iconButton.type = "button";
    iconButton.className = "gcal-groups-group-icon-button";
    iconButton.setAttribute("aria-label", collapseButton.getAttribute("aria-label"));
    iconButton.disabled = busy;
    const icon = createMaterialIcon(
      collapsed ? "keyboard_arrow_down" : "keyboard_arrow_up",
      "gcal-groups-group-icon"
    );
    iconButton.append(icon);
    header.append(iconButton);

    const list = document.createElement("div");
    list.className = "gcal-groups-group-list";
    list.hidden = collapsed;
    group.calendars.forEach((calendar) => list.append(createCalendarRow(
      calendar,
      onToggle,
      onToggleQuickCalendar,
      busy,
      quickActive,
      quickSelectedIds
    )));

    function toggleGroupCollapsed() {
      collapsed = !collapsed;
      if (group.automatic) {
        if (collapsed) collapsedGroupIds.add(group.id);
        else collapsedGroupIds.delete(group.id);
      } else {
        // Phase 4 stores custom group collapse state with the rest of its
        // configuration so it survives refreshes and browser restarts.
        Promise.resolve(onGroupCollapsed(group.id, collapsed)).catch((error) => {
          console.error(`${LOG_PREFIX} Could not save collapsed group state`, error);
        });
      }
      list.hidden = collapsed;
      icon.textContent = collapsed ? "keyboard_arrow_down" : "keyboard_arrow_up";
      collapseButton.setAttribute("aria-expanded", String(!collapsed));
      collapseButton.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${group.name}`);
      iconButton.setAttribute("aria-label", collapseButton.getAttribute("aria-label"));
    }

    collapseButton.addEventListener("click", toggleGroupCollapsed);
    iconButton.addEventListener("click", toggleGroupCollapsed);

    section.append(header, list);
    return section;
  }

  function render({
    calendars,
    headings,
    onToggle,
    onSetCalendarsVisible,
    soloState,
    onToggleSolo,
    onToggleQuickSolo,
    onToggleQuickCalendar,
    onShowAll,
    onManage,
    configuration,
    onGroupCollapsed,
    busy,
    commandStatus
  }) {
    const root = ensureRoot(headings, calendars);
    if (!root) {
      console.warn(`${LOG_PREFIX} Could not find a safe insertion point beneath Other calendars.`);
      return false;
    }

    const wasCollapsed = root.dataset.collapsed === "true";
    root.replaceChildren();

    createTopHeader(root, () => {
      const collapsed = root.dataset.collapsed !== "true";
      root.dataset.collapsed = String(collapsed);
      const list = root.querySelector(".gcal-groups-list");
      const button = root.querySelector(".gcal-groups-collapse");
      list.hidden = collapsed;
      button.querySelector(".gcal-groups-collapse-icon").textContent = collapsed
        ? "keyboard_arrow_down"
        : "keyboard_arrow_up";
      button.setAttribute("aria-expanded", String(!collapsed));
      button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} Grouped`);
    }, onToggleQuickSolo, onShowAll, onManage, busy, commandStatus, soloState);

    const list = document.createElement("div");
    list.className = "gcal-groups-list";
    list.hidden = wasCollapsed;

    if (calendars.length === 0) {
      const empty = document.createElement("p");
      empty.className = "gcal-groups-empty";
      empty.textContent = "Waiting for native calendars…";
      list.append(empty);
    } else {
      const groups = namespace.grouping.buildStoredGroups(calendars, configuration);
      groups.forEach((group) => {
        list.append(createGroup(
          group,
          onToggle,
          onToggleQuickCalendar,
          onSetCalendarsVisible,
          soloState,
          onToggleSolo,
          onGroupCollapsed,
          busy
        ));
      });
    }

    root.dataset.collapsed = String(wasCollapsed);
    root.append(list);

    const topButton = root.querySelector(".gcal-groups-collapse");
    topButton.querySelector(".gcal-groups-collapse-icon").textContent = wasCollapsed
      ? "keyboard_arrow_down"
      : "keyboard_arrow_up";
    topButton.setAttribute("aria-expanded", String(!wasCollapsed));
    return true;
  }

  namespace.groupedSectionRenderer = { render };
})(window.GCalGroups = window.GCalGroups || {});
