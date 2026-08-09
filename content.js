(() => {
  if (window.__reelsPipLoaded) return;
  window.__reelsPipLoaded = true;

  const DEFAULT_WATCH_SECONDS = 15;
  const MAX_WATCH_SECONDS = 90;

  const POLL_INTERVAL_MS = 600;
  const URL_POLL_INTERVAL_MS = 800;
  const GRAPHQL_IDLE_POLL_MS = 300;
  const GRAPHQL_IDLE_MAX_WAIT_MS = 8000;
  const NAV_SETTLE_MS = 700;
  const HINT_VISIBLE_MS = 2400;

  const REELS_PATH = /^\/reels?(\/|$)/;

  const ICONS = {
    pip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><rect class="rp-pane" x="12" y="12" width="6" height="4" rx="1"/></svg>`,
    autoAdvance: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7l6 5 6-5"/><path d="M6 13l6 5 6-5"/></svg>`,
  };

  const PIP_STYLES = `
    :root {
      --rp-ink: #0b0b0c;
      --rp-shell: rgba(22, 22, 24, 0.82);
      --rp-shell-lift: rgba(44, 44, 48, 0.92);
      --rp-edge: rgba(255, 255, 255, 0.14);
      --rp-glyph: #ffffff;
      color-scheme: dark;
    }

    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: var(--rp-ink);
    }

    #wrap { position: absolute; inset: 0; }

    #pip-video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: var(--rp-ink);
      cursor: pointer;
    }

    #controls {
      position: absolute;
      right: 10px;
      bottom: 10px;
      display: flex;
      gap: 6px;
      opacity: 0;
      transition: opacity 140ms ease;
    }

    #wrap:hover #controls { opacity: 1; }

    #controls button {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      margin: 0;
      padding: 0;
      border: 1px solid var(--rp-edge);
      border-radius: 7px;
      background: var(--rp-shell);
      color: var(--rp-glyph);
      cursor: pointer;
      -webkit-appearance: none;
      appearance: none;
      backdrop-filter: blur(12px) saturate(120%);
      transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease,
        transform 140ms ease;
    }

    #controls button svg { display: block; width: 14px; height: 14px; }
    #controls button:hover { background: var(--rp-shell-lift); }
    #controls button:active { transform: scale(0.94); }
    #controls button:focus-visible { outline: 2px solid var(--rp-glyph); outline-offset: 2px; }

    #controls button.is-on {
      background: var(--rp-glyph);
      border-color: transparent;
      color: var(--rp-ink);
    }

    #hint {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      padding: 5px 10px;
      border: 1px solid var(--rp-edge);
      border-radius: 8px;
      background: var(--rp-shell);
      color: var(--rp-glyph);
      font: 500 11px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.02em;
      white-space: nowrap;
      -webkit-font-smoothing: antialiased;
      backdrop-filter: blur(12px) saturate(120%);
      opacity: 0;
      transition: opacity 140ms ease;
      pointer-events: none;
    }

    #hint.is-visible, #wrap:hover #hint { opacity: 1; }

    @media (prefers-reduced-motion: reduce) {
      #controls, #controls button, #hint { transition: none; }
    }
  `;

  const PIP_MARKUP = `
    <video id="pip-video" autoplay muted playsinline></video>
    <div id="hint">Scroll for next &nbsp;·&nbsp; Click to pause</div>
    <div id="controls">
      <button id="pip-auto" class="is-on" type="button" aria-pressed="true" aria-label="Turn off auto-advance" title="Auto-advance">${ICONS.autoAdvance}</button>
    </div>
  `;

  const STATE = {
    pipWindow: null,
    activeVideo: null,
    activeSrc: null,
    advanceTimer: null,
    durationFallbackTimer: null,
    pollInterval: null,
    autoAdvanceEnabled: true,
    navigating: false,
    lastUrl: location.href,
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const onReelsPage = () => REELS_PATH.test(location.pathname);
  const srcOf = (video) => (video ? video.currentSrc || video.src || null : null);

  function findActiveVideo() {
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    let best = null;
    let bestScore = 0;

    for (const video of document.querySelectorAll("video")) {
      const r = video.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const visibleW = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const visibleH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      let score = visibleW * visibleH;
      if (!score) continue;
      if (!video.paused) score *= 4;
      if (score > bestScore) {
        bestScore = score;
        best = video;
      }
    }
    return best;
  }

  const NAV_SELECTORS = {
    next: [
      'div[aria-label="Reels navigation controls"] div[aria-label="Navigate to next Reel"]',
      '[aria-label="Navigate to next Reel"]',
      '[aria-label="Next reel"]',
      'button[aria-label="Next"]',
    ],
    previous: [
      'div[aria-label="Reels navigation controls"] div[aria-label="Navigate to previous Reel"]',
      '[aria-label="Navigate to previous Reel"]',
      '[aria-label="Previous reel"]',
      'button[aria-label="Previous"]',
    ],
  };

  function clickNavButton(direction) {
    for (const selector of NAV_SELECTORS[direction]) {
      const el = document.querySelector(selector);
      if (el) {
        el.click();
        return true;
      }
    }
    return false;
  }

  function pressArrowKey(direction) {
    const key = direction === "next" ? "ArrowDown" : "ArrowUp";
    const keyCode = direction === "next" ? 40 : 38;
    for (const type of ["keydown", "keyup"]) {
      document.dispatchEvent(
        new KeyboardEvent(type, {
          key,
          code: key,
          keyCode,
          which: keyCode,
          bubbles: true,
          cancelable: true,
        })
      );
    }
    return true;
  }

  function findScrollContainer(node) {
    for (let el = node?.parentElement; el; el = el.parentElement) {
      const overflowY = getComputedStyle(el).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1) {
        return el;
      }
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollOneReel(direction) {
    const container = findScrollContainer(STATE.activeVideo);
    const step = container === document.scrollingElement ? window.innerHeight : container.clientHeight;
    if (!step) return false;
    container.scrollBy({ top: direction === "next" ? step : -step, behavior: "smooth" });
    return true;
  }

  async function navigate(direction) {
    if (STATE.navigating) return false;
    STATE.navigating = true;
    const before = STATE.activeSrc ?? srcOf(findActiveVideo());
    try {
      for (const strategy of [clickNavButton, pressArrowKey, scrollOneReel]) {
        if (!strategy(direction)) continue;
        await wait(NAV_SETTLE_MS);
        const src = srcOf(findActiveVideo());
        if (src && src !== before) return true;
      }
      console.warn("[reels-pip] could not advance to the %s reel", direction);
      return false;
    } finally {
      STATE.navigating = false;
    }
  }

  function isGraphQLIdle() {
    const raw = document.documentElement.dataset.reelsPipGraphqlInflight;
    return raw === undefined || Number(raw) <= 0;
  }

  async function advanceWhenIdle() {
    const deadline = Date.now() + GRAPHQL_IDLE_MAX_WAIT_MS;
    while (!isGraphQLIdle() && Date.now() < deadline) {
      await wait(GRAPHQL_IDLE_POLL_MS);
    }
    await navigate("next");
  }

  function toast(message) {
    document.getElementById("reels-pip-toast")?.remove();
    const el = document.createElement("div");
    el.id = "reels-pip-toast";
    el.setAttribute("role", "status");
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function setToggleState(on) {
    const btn = document.getElementById("reels-pip-toggle");
    if (!btn) return;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Close Picture-in-Picture" : "Open Picture-in-Picture");
  }

  function injectToggleButton() {
    if (document.getElementById("reels-pip-toggle")) return;
    const btn = document.createElement("button");
    btn.id = "reels-pip-toggle";
    btn.type = "button";
    btn.title = "Picture-in-Picture";
    btn.innerHTML = ICONS.pip;
    btn.addEventListener("click", onToggleClick);
    document.body.appendChild(btn);
    setToggleState(!!STATE.pipWindow && !STATE.pipWindow.closed);
  }

  function syncToggleButton() {
    if (!document.body) return;
    if (onReelsPage()) injectToggleButton();
    else document.getElementById("reels-pip-toggle")?.remove();
  }

  async function onToggleClick() {
    if (STATE.pipWindow && !STATE.pipWindow.closed) {
      STATE.pipWindow.close();
      return;
    }
    if (!("documentPictureInPicture" in window)) {
      toast("Picture-in-Picture needs Chrome 116 or newer.");
      return;
    }
    const video = findActiveVideo();
    if (!video) {
      toast("No reel playing yet. Start one, then try again.");
      return;
    }
    await openPiP(video);
  }

  function ensureVideoMetadata(video) {
    if (video.videoWidth && video.videoHeight) return Promise.resolve();
    return new Promise((resolve) => {
      video.addEventListener("loadedmetadata", resolve, { once: true });
      setTimeout(resolve, 500);
    });
  }

  async function openPiP(video) {
    await ensureVideoMetadata(video);
    const w = video.videoWidth || 405;
    const h = video.videoHeight || 720;
    const pipWindow = await documentPictureInPicture.requestWindow({
      width: Math.round(w / 2),
      height: Math.round(h / 2),
    });
    STATE.pipWindow = pipWindow;
    setToggleState(true);

    buildPiPUI(pipWindow);
    attachToVideo(video, { force: true });

    STATE.pollInterval = setInterval(pollActiveVideo, POLL_INTERVAL_MS);
    pipWindow.addEventListener("pagehide", teardown, { once: true });
  }

  function pipVideoEl() {
    return STATE.pipWindow && !STATE.pipWindow.closed
      ? STATE.pipWindow.document.getElementById("pip-video")
      : null;
  }

  function hasLiveVideoTrack(stream) {
    return !!stream && stream.getVideoTracks().some((t) => t.readyState === "live");
  }

  function pollActiveVideo() {
    if (!STATE.pipWindow || STATE.pipWindow.closed) return;
    const video = findActiveVideo();
    if (!video) return;
    const stale = !hasLiveVideoTrack(pipVideoEl()?.srcObject);
    attachToVideo(video, { force: stale });
  }

  function buildPiPUI(win) {
    const style = win.document.createElement("style");
    style.textContent = PIP_STYLES;
    win.document.head.appendChild(style);

    const wrap = win.document.createElement("div");
    wrap.id = "wrap";
    wrap.innerHTML = PIP_MARKUP;
    win.document.body.appendChild(wrap);

    const hint = win.document.getElementById("hint");
    hint.classList.add("is-visible");
    setTimeout(() => hint.classList.remove("is-visible"), HINT_VISIBLE_MS);

    const autoBtn = win.document.getElementById("pip-auto");
    autoBtn.addEventListener("click", () => {
      STATE.autoAdvanceEnabled = !STATE.autoAdvanceEnabled;
      autoBtn.classList.toggle("is-on", STATE.autoAdvanceEnabled);
      autoBtn.setAttribute("aria-pressed", String(STATE.autoAdvanceEnabled));
      autoBtn.setAttribute(
        "aria-label",
        STATE.autoAdvanceEnabled ? "Turn off auto-advance" : "Turn on auto-advance"
      );
      if (STATE.autoAdvanceEnabled && STATE.activeVideo) scheduleAutoAdvance(STATE.activeVideo);
    });

    win.document.getElementById("pip-video").addEventListener("click", () => {
      const video = STATE.activeVideo;
      if (!video) return;
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });

    let wheelCooldown = false;
    wrap.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (wheelCooldown || Math.abs(e.deltaY) < 8) return;
        wheelCooldown = true;
        setTimeout(() => {
          wheelCooldown = false;
        }, 450);
        navigate(e.deltaY > 0 ? "next" : "previous");
      },
      { passive: false }
    );
  }

  function stopStream(stream) {
    if (stream && typeof stream.getTracks === "function") {
      for (const track of stream.getTracks()) track.stop();
    }
  }

  function attachToVideo(video, { force = false } = {}) {
    const src = srcOf(video);
    const isSameReel = video === STATE.activeVideo && src === STATE.activeSrc;
    if (!force && isSameReel) return;
    STATE.activeVideo = video;
    STATE.activeSrc = src;

    const pipVideo = pipVideoEl();
    if (pipVideo) {
      stopStream(pipVideo.srcObject);
      try {
        pipVideo.srcObject = video.captureStream();
      } catch (e) {
        console.warn("[reels-pip] captureStream failed", e);
        return;
      }
      pipVideo.muted = true;
      pipVideo.play().catch(() => {});
    }

    if (!isSameReel) scheduleAutoAdvance(video);
  }

  function scheduleAutoAdvance(video) {
    clearTimeout(STATE.advanceTimer);
    clearTimeout(STATE.durationFallbackTimer);

    const knownDuration = () =>
      Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;

    const fire = () => {
      if (!STATE.autoAdvanceEnabled) return;
      if (STATE.activeVideo !== video) return;
      if (!STATE.pipWindow || STATE.pipWindow.closed) return;
      if (video.paused) {
        STATE.advanceTimer = setTimeout(fire, 1000);
        return;
      }
      advanceWhenIdle();
    };

    const schedule = () => {
      clearTimeout(STATE.advanceTimer);
      clearTimeout(STATE.durationFallbackTimer);
      const duration = Math.min(knownDuration() ?? DEFAULT_WATCH_SECONDS, MAX_WATCH_SECONDS);
      const remaining = Math.max(duration - video.currentTime, 1);
      STATE.advanceTimer = setTimeout(fire, remaining * 1000);
    };

    if (knownDuration() !== null) {
      schedule();
      return;
    }

    const onDurationChange = () => {
      if (knownDuration() !== null) {
        video.removeEventListener("durationchange", onDurationChange);
        schedule();
      }
    };
    video.addEventListener("durationchange", onDurationChange);
    STATE.durationFallbackTimer = setTimeout(() => {
      video.removeEventListener("durationchange", onDurationChange);
      schedule();
    }, DEFAULT_WATCH_SECONDS * 1000);
  }

  function teardown() {
    clearTimeout(STATE.advanceTimer);
    clearTimeout(STATE.durationFallbackTimer);
    clearInterval(STATE.pollInterval);
    stopStream(STATE.pipWindow?.document.getElementById("pip-video")?.srcObject);
    STATE.pipWindow = null;
    STATE.activeVideo = null;
    STATE.activeSrc = null;
    STATE.pollInterval = null;
    setToggleState(false);
  }

  function init() {
    syncToggleButton();

    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        syncToggleButton();
      });
    }).observe(document.body, { childList: true });

    setInterval(() => {
      if (location.href === STATE.lastUrl) return;
      STATE.lastUrl = location.href;
      syncToggleButton();
    }, URL_POLL_INTERVAL_MS);
  }

  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init, { once: true });
})();
