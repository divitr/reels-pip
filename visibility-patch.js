(() => {
  if (window.__reelsPipVisibilityPatched) return;
  window.__reelsPipVisibilityPatched = true;

  const define = (obj, prop, value) => {
    try {
      Object.defineProperty(obj, prop, { get: () => value, configurable: true });
    } catch (e) {}
  };

  define(document, "hidden", false);
  define(document, "webkitHidden", false);
  define(document, "visibilityState", "visible");
  define(document, "webkitVisibilityState", "visible");

  try {
    document.hasFocus = () => true;
  } catch (e) {}

  const swallow = (e) => {
    e.stopImmediatePropagation();
  };

  for (const type of ["visibilitychange", "webkitvisibilitychange", "freeze", "resume"]) {
    document.addEventListener(type, swallow, true);
  }
  for (const type of ["blur", "pagehide"]) {
    window.addEventListener(type, swallow, true);
  }
})();
