(function startGroupedCalendars(namespace) {
  "use strict";

  if (window.__gcalGroupedCalendarsPhase1Loaded) return;
  window.__gcalGroupedCalendarsPhase1Loaded = true;

  const { LOG_PREFIX } = namespace.constants;
  const reconciler = namespace.reconciliation.createReconciler();
  const version = chrome.runtime.getManifest().version;

  console.info(`${LOG_PREFIX} v${version} loaded. No calendar or event data is sent to the developer.`);
  namespace.mutationObserver.startMutationObserver(reconciler.reconcile);

  // Load persistent configuration before the first intentional render. If sync
  // storage is temporarily unavailable, Calendar controls still start with a
  // safe in-memory default rather than leaving the extension unusable.
  reconciler.hydrateConfiguration()
    .then(() => {
      reconciler.reconcile("initial configuration ready");
      return reconciler.hydrateSolo();
    })
    .catch((error) => {
      console.error(`${LOG_PREFIX} Could not load persistent configuration`, error);
      reconciler.reconcile("initial configuration fallback");
      reconciler.hydrateSolo();
    });

  // Google Calendar can change route without a full page load. Popstate catches
  // browser navigation; DOM observation catches Calendar's internal navigation.
  window.addEventListener("popstate", () => reconciler.reconcile("route rerender"));
})(window.GCalGroups = window.GCalGroups || {});
