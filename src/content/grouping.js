(function initialiseStoredGrouping(namespace) {
  "use strict";

  function buildStoredGroups(calendars, configuration) {
    const assignedIds = new Set();
    const orderedDefinitions = [...configuration.groups].sort((first, second) => first.order - second.order);
    const groups = orderedDefinitions.map((definition) => {
      const groupCalendars = calendars.filter((calendar) => {
        if (assignedIds.has(calendar.calendarId)) return false;
        if (configuration.assignments[calendar.calendarId] !== definition.id) return false;
        assignedIds.add(calendar.calendarId);
        return true;
      });

      return {
        id: definition.id,
        name: definition.name,
        calendars: groupCalendars,
        automatic: false,
        collapsed: definition.collapsed,
        colour: definition.colour
      };
    });

    if (configuration.settings.showUngrouped) {
      groups.push({
        id: "ungrouped",
        name: "Ungrouped",
        calendars: calendars.filter((calendar) => !assignedIds.has(calendar.calendarId)),
        automatic: true,
        collapsed: false,
        colour: "#5f6368"
      });
    }

    return groups;
  }

  namespace.grouping = { buildStoredGroups };
})(window.GCalGroups = window.GCalGroups || {});
