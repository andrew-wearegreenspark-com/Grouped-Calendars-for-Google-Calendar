(function initialiseCalendarDiscovery(namespace) {
  "use strict";

  const { ROOT_ID, SECTION_NAMES, LOG_PREFIX } = namespace.constants;

  const CHECKBOX_SELECTOR = [
    '[role="checkbox"]',
    'input[type="checkbox"]',
    '[aria-checked="true"]',
    '[aria-checked="false"]',
    '[aria-checked="mixed"]'
  ].join(",");

  // These attributes are checked from strongest to weakest. Google changes its
  // internal HTML periodically, so discovery deliberately uses several signals.
  const IDENTIFIER_ATTRIBUTES = [
    "data-calendar-id",
    "data-calendarid",
    "data-cal-id",
    "data-calendar-key",
    "data-key",
    "data-id",
    "aria-controls",
    "name",
    "id"
  ];

  function normaliseText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function hashText(value) {
    // A compact deterministic hash is only used for runtime fallback identifiers.
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function isExtensionElement(element) {
    return Boolean(element && element.closest && element.closest(`#${ROOT_ID}`));
  }

  function elementIsUsable(element) {
    if (!(element instanceof HTMLElement) || isExtensionElement(element)) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    return true;
  }

  function findSectionHeadings() {
    const headings = {};
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (!elementIsUsable(node) || node.children.length > 8) {
            return NodeFilter.FILTER_SKIP;
          }

          const text = normaliseText(node.textContent).toLocaleLowerCase();
          return SECTION_NAMES[text]
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        }
      }
    );

    while (walker.nextNode()) {
      const element = walker.currentNode;
      const section = SECTION_NAMES[normaliseText(element.textContent).toLocaleLowerCase()];
      // Prefer the last matching element. It is normally the smallest text node
      // wrapper rather than a large ancestor that happens to contain the title.
      headings[section] = element;
    }

    return headings;
  }

  function comesBefore(first, second) {
    if (!first || !second || first === second) return false;
    return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function readVisibility(control) {
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      return control.checked;
    }

    const checked = control.getAttribute("aria-checked");
    if (checked === "true") return true;
    if (checked === "false") return false;

    // Some Google controls put the state on a child or parent of the clickable
    // element. Check only nearby elements so unrelated rows cannot affect it.
    const stateOwner = control.querySelector("[aria-checked]") || control.closest("[aria-checked]");
    if (stateOwner) return stateOwner.getAttribute("aria-checked") === "true";

    return null;
  }

  function findCalendarRow(control) {
    let candidate = control;
    let best = control.parentElement || control;

    // A calendar row is usually a compact ancestor containing one checkbox and a
    // label. Stop before reaching a large sidebar/section container.
    for (let depth = 0; candidate && depth < 7; depth += 1) {
      const text = normaliseText(candidate.textContent);
      const controls = candidate.querySelectorAll(CHECKBOX_SELECTOR).length;
      // Once an ancestor contains a second checkbox, it is a list/container and
      // no longer represents this one calendar row.
      if (controls > 1 || text.length > 240) break;
      if (text && controls === 1) best = candidate;
      candidate = candidate.parentElement;
    }

    return best;
  }

  function readDisplayName(control, row) {
    const labelledBy = control.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((element) => normaliseText(element.textContent))
        .filter(Boolean)
        .join(" ");
      if (label) return label;
    }

    const ariaLabel = normaliseText(control.getAttribute("aria-label"));
    if (ariaLabel) {
      // Common labels include "Primary calendar, checked" or "Show Primary calendar". Remove only
      // generic state/action words; the original label remains in diagnostics.
      return ariaLabel
        .replace(/^(show|hide|toggle)\s+/i, "")
        .replace(/,?\s*(checked|unchecked|selected|not selected)$/i, "")
        .trim();
    }

    if (control.id) {
      const explicitLabel = document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
      const labelText = normaliseText(explicitLabel && explicitLabel.textContent);
      if (labelText) return labelText;
    }

    return normaliseText(row.textContent);
  }

  function looksLikeUsefulIdentifier(attribute, value, displayName) {
    if (!value || value.length < 2 || value.length > 500) return false;
    const normalisedValue = normaliseText(value).toLocaleLowerCase();
    const normalisedName = normaliseText(displayName).toLocaleLowerCase();
    if (normalisedValue === normalisedName) return false;
    if (/^(true|false|checked|unchecked|checkbox)$/i.test(value)) return false;
    return attribute !== "id" || !/^[a-z]{1,3}\d{0,3}$/i.test(value);
  }

  function findIdentifier(control, row, section, displayName, occurrence) {
    const nearby = [control, row, ...Array.from(row.querySelectorAll("[data-calendar-id],[data-calendarid],[data-cal-id],[data-calendar-key],[data-key],[data-id],[aria-controls],[name],[id]"))];

    for (const attribute of IDENTIFIER_ATTRIBUTES) {
      for (const element of nearby) {
        const value = normaliseText(element && element.getAttribute && element.getAttribute(attribute));
        if (looksLikeUsefulIdentifier(attribute, value, displayName)) {
          return {
            calendarId: `${attribute}:${value}`,
            identifierSource: attribute,
            identifierStable: !["id", "aria-controls"].includes(attribute)
          };
        }
      }
    }

    // This fallback keeps duplicate names independently controllable in the live
    // page. It is intentionally reported as unstable and must not be persisted in
    // later phases until a stable page identifier has been proven.
    const fingerprint = `${section}|${displayName}|${occurrence}`;
    return {
      calendarId: `runtime:${hashText(fingerprint)}`,
      identifierSource: "section/name/occurrence fallback",
      identifierStable: false
    };
  }

  function readColour(row, control) {
    // Google exposes the real calendar colour as a CSS custom property on the
    // native checkbox wrapper (for example: --checkbox-color: #CC3000).
    // Read that first so ordinary text colour is never mistaken for the swatch.
    let nearby = control;
    for (let depth = 0; nearby && depth < 5; depth += 1) {
      const inlineColour = nearby.style && nearby.style.getPropertyValue("--checkbox-color").trim();
      const computedColour = window.getComputedStyle(nearby).getPropertyValue("--checkbox-color").trim();
      const calendarColour = inlineColour || computedColour;
      if (calendarColour && CSS.supports("color", calendarColour)) return calendarColour;
      if (nearby === row) break;
      nearby = nearby.parentElement;
    }

    const candidates = Array.from(row.querySelectorAll("svg [fill],svg [stroke],[style*='background-color'],[style*='border-color']"));

    for (const element of candidates) {
      const style = window.getComputedStyle(element);
      const values = [
        element.getAttribute && element.getAttribute("fill"),
        element.getAttribute && element.getAttribute("stroke"),
        style.backgroundColor,
        style.borderColor
      ];
      const colour = values.find((value) => value && !/rgba?\(0, 0, 0, 0\)|transparent|none/i.test(value));
      if (colour) return colour;
    }

    return "currentColor";
  }

  function identifySection(control, headings) {
    const myHeading = headings["my-calendars"];
    const otherHeading = headings["other-calendars"];
    if (!myHeading || !otherHeading) return null;
    if (comesBefore(myHeading, control) && comesBefore(control, otherHeading)) return "my-calendars";
    if (comesBefore(otherHeading, control)) return "other-calendars";
    return null;
  }

  function findSidebarScrollRegion(headings) {
    let candidate = headings["other-calendars"];
    while (candidate && candidate !== document.body) {
      const overflowY = window.getComputedStyle(candidate).overflowY;
      if (["auto", "scroll"].includes(overflowY) && candidate.contains(headings["my-calendars"])) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }
    return null;
  }

  function discoverCalendars() {
    const headings = findSectionHeadings();
    if (!headings["my-calendars"] || !headings["other-calendars"]) {
      console.debug(`${LOG_PREFIX} Waiting for both native calendar section headings.`);
      return { calendars: [], headings, ready: false };
    }

    const seenControls = new Set();
    const occurrences = new Map();
    const calendars = [];
    const sidebarScrollRegion = findSidebarScrollRegion(headings);

    for (const control of document.querySelectorAll(CHECKBOX_SELECTOR)) {
      if (!elementIsUsable(control) || seenControls.has(control)) continue;
      // Event editors, colour palettes, settings menus, and other overlays are
      // often appended after the calendar headings in document order. They are
      // not calendar rows and must never enter discovery or the Ungrouped cache.
      if (sidebarScrollRegion && !sidebarScrollRegion.contains(control)) continue;
      if (control.closest('[role="dialog"],[role="menu"],[role="listbox"],[aria-modal="true"]')) continue;
      // Prefer the deepest checked element. This prevents a wrapper and its
      // nested checkbox from being reported as two separate calendars.
      if (control.querySelector(CHECKBOX_SELECTOR)) continue;
      seenControls.add(control);

      const section = identifySection(control, headings);
      if (!section) continue;

      const visible = readVisibility(control);
      if (visible === null) continue;

      const row = findCalendarRow(control);
      const displayName = readDisplayName(control, row);
      if (!displayName || SECTION_NAMES[displayName.toLocaleLowerCase()]) continue;

      const occurrenceKey = `${section}|${displayName}`;
      const occurrence = (occurrences.get(occurrenceKey) || 0) + 1;
      occurrences.set(occurrenceKey, occurrence);

      const identifier = findIdentifier(control, row, section, displayName, occurrence);
      calendars.push({
        ...identifier,
        displayName,
        nativeSection: section,
        visible,
        colour: readColour(row, control),
        nativeControl: control,
        nativeRow: row,
        nativeAriaLabel: normaliseText(control.getAttribute("aria-label"))
      });
    }

    // If Google exposes the same checked state through nested elements, prefer
    // the outermost discovered control and keep one calendar per identifier.
    const unique = [];
    const identifiers = new Set();
    for (const calendar of calendars) {
      if (identifiers.has(calendar.calendarId)) continue;
      identifiers.add(calendar.calendarId);
      unique.push(calendar);
    }

    return { calendars: unique, headings, ready: true };
  }

  function logDiscovery(calendars) {
    console.groupCollapsed(`${LOG_PREFIX} Discovered ${calendars.length} native calendars`);
    console.table(calendars.map((calendar) => ({
      calendarId: calendar.calendarId,
      displayName: calendar.displayName,
      identifierSource: calendar.identifierSource,
      stableIdentifier: calendar.identifierStable,
      nativeSection: calendar.nativeSection,
      visible: calendar.visible,
      matchingNativeControl: Boolean(calendar.nativeControl && calendar.nativeControl.isConnected),
      nativeAriaLabel: calendar.nativeAriaLabel
    })));

    const unstable = calendars.filter((calendar) => !calendar.identifierStable);
    if (unstable.length) {
      console.warn(`${LOG_PREFIX} ${unstable.length} mapping(s) use a temporary runtime fallback.`, unstable);
    }
    console.groupEnd();
  }

  namespace.calendarDiscovery = {
    discoverCalendars,
    logDiscovery,
    readVisibility
  };
})(window.GCalGroups = window.GCalGroups || {});
