(function initialiseConstants(namespace) {
  "use strict";

  // One shared namespace keeps the content scripts independent without requiring
  // a bundler. Chrome loads these files in the order listed in manifest.json.
  namespace.constants = Object.freeze({
    ROOT_ID: "gcal-grouped-calendars-root",
    LOG_PREFIX: "[Grouped Calendars]",
    RECONCILE_DELAY_MS: 200,
    POST_CLICK_CHECKS_MS: [60, 250, 750],
    SECTION_NAMES: Object.freeze({
      "my calendars": "my-calendars",
      "other calendars": "other-calendars"
    })
  });
})(window.GCalGroups = window.GCalGroups || {});
