(() => {
  if (window.__reelsPipNetworkObserved) return;
  window.__reelsPipNetworkObserved = true;

  const ATTR = "reelsPipGraphqlInflight";
  let inFlight = 0;

  const publish = () => {
    document.documentElement.dataset[ATTR] = String(inFlight);
  };

  const start = () => {
    inFlight++;
    publish();
  };

  const end = () => {
    inFlight = Math.max(0, inFlight - 1);
    publish();
  };

  publish();

  const isGraphQLUrl = (url) => typeof url === "string" && url.includes("/api/graphql");

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const input = args[0];
    const url = typeof input === "string" ? input : input?.url;
    const tracked = isGraphQLUrl(url);
    if (tracked) start();
    let result;
    try {
      result = origFetch.apply(this, args);
    } catch (e) {
      if (tracked) end();
      throw e;
    }
    if (tracked) result.then(end, end);
    return result;
  };

  const XHR = window.XMLHttpRequest;
  const origOpen = XHR.prototype.open;
  const origSend = XHR.prototype.send;

  XHR.prototype.open = function (method, url, ...rest) {
    this.__reelsPipTracked = isGraphQLUrl(url);
    return origOpen.call(this, method, url, ...rest);
  };

  XHR.prototype.send = function (...args) {
    if (this.__reelsPipTracked) {
      start();
      this.addEventListener("loadend", end, { once: true });
    }
    return origSend.apply(this, args);
  };
})();
