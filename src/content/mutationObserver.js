(function initialiseMutationObserver(namespace) {
  "use strict";

  const { ROOT_ID, RECONCILE_DELAY_MS, LOG_PREFIX } = namespace.constants;

  function mutationIsExtensionOnly(mutation) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return false;
    if (root.contains(mutation.target)) return true;

    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return changedNodes.length > 0 && changedNodes.every((node) => node === root || (node.nodeType === Node.ELEMENT_NODE && root.contains(node)));
  }

  function startMutationObserver(requestReconcile) {
    let timer = null;

    const observer = new MutationObserver((mutations) => {
      if (mutations.every(mutationIsExtensionOnly)) return;

      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        console.debug(`${LOG_PREFIX} Native DOM mutation/rerender detected (${mutations.length} mutation records).`);
        requestReconcile("native rerender detected");
      }, RECONCILE_DELAY_MS);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // Class/style changes are frequent during ordinary scrolling and do not
      // indicate calendar state changes. Child changes still catch rerenders.
      attributeFilter: ["aria-checked", "aria-label"]
    });

    return observer;
  }

  namespace.mutationObserver = { startMutationObserver };
})(window.GCalGroups = window.GCalGroups || {});
