(function () {
  "use strict";
  var cards = [].slice.call(document.querySelectorAll(".portal-card[data-portal]"));
  if (!cards.length) return;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var frames = [];

  cards.forEach(function (card) {
    var frame = card.querySelector(".portal-frame");
    var image = card.querySelector(".portal-snapshot");
    var badge = card.querySelector(".portal-preview-badge");
    var iframe = card.querySelector(".portal-iframe");
    var tryLive = card.querySelector("[data-portal-try-live]");
    var goBack = card.querySelector("[data-portal-snapshot-back]");
    var fallback = card.querySelector(".portal-image-error");
    if (!frame || !image || !iframe || !tryLive || !goBack) return;
    frames.push({frame: frame, image: image});
    var loadTimeout = 0;
    var liveLoaded = false;

    image.addEventListener("error", function () {
      image.hidden = true;
      if (fallback) fallback.hidden = false;
      if (badge) badge.textContent = "Preview image unavailable";
    });

    function showSnapshot() {
      window.clearTimeout(loadTimeout);
      iframe.hidden = true;
      iframe.removeAttribute("src");
      frame.classList.remove("is-live", "is-loading-live");
      tryLive.hidden = false;
      tryLive.disabled = false;
      tryLive.textContent = "Try live view";
      goBack.hidden = true;
      liveLoaded = false;
    }

    function tryInteractiveView() {
      if (frame.classList.contains("is-loading-live") || frame.classList.contains("is-live")) return;
      var url = iframe.getAttribute("data-live-src");
      if (!url || !/^https:\/\//i.test(url)) return;
      frame.classList.add("is-loading-live");
      tryLive.disabled = true;
      tryLive.textContent = "Connecting...";
      goBack.hidden = false;
      iframe.hidden = false;
      // Loading a blocked third-party frame can still fire iframe.load.
      // Never remove the snapshot or the reversible "Back" control.
      iframe.src = url;
      loadTimeout = window.setTimeout(function () {
        if (!liveLoaded) {
          showSnapshot();
          if (badge) badge.textContent = "Live embed timed out. Saved preview shown.";
        }
      }, 7000);
    }

    iframe.addEventListener("load", function () {
      if (!frame.classList.contains("is-loading-live")) return;
      liveLoaded = true;
      window.clearTimeout(loadTimeout);
      frame.classList.remove("is-loading-live");
      frame.classList.add("is-live");
      tryLive.hidden = true;
      goBack.hidden = false;
      if (badge) badge.textContent = "Interactive view (may be blocked by site policy)";
    });
    iframe.addEventListener("error", function () {
      showSnapshot();
      if (badge) badge.textContent = "Live embed blocked. Saved preview shown.";
    });
    tryLive.addEventListener("click", tryInteractiveView);
    goBack.addEventListener("click", showSnapshot);
  });

  // The manifest is produced by the same build that creates the WebP files.
  // A failed capture is labeled honestly, never presented as a screenshot.
  fetch("/images/previews/capture-status.json", {
    cache: "no-store", credentials: "same-origin"
  }).then(function (response) {
    if (!response.ok) throw new Error("Missing capture status");
    return response.json();
  }).then(function (data) {
    cards.forEach(function (card) {
      var frame = card.querySelector(".portal-frame");
      var badge = card.querySelector(".portal-preview-badge");
      if (!frame || !badge) return;
      var key = frame.getAttribute("data-snapshot-key");
      var record = data && data.items && data.items[key];
      if (!record) return;
      if (record.status === "captured") {
        badge.textContent = "Locally saved website screenshot";
      } else {
        badge.textContent = "Site not capturable. Open live instead.";
      }
    });
  }).catch(function () {
    cards.forEach(function (card) {
      var badge = card.querySelector(".portal-preview-badge");
      if (badge) badge.textContent = "Locally served preview";
    });
  });

  // Transform-only, requestAnimationFrame-coalesced parallax. No heavy canvas,
  // no JS layout loop when the user has requested reduced motion.
  var scheduled = false;
  function tick() {
    scheduled = false;
    if (reduceMotion.matches) return;
    var halfHeight = Math.max(1, window.innerHeight / 2);
    frames.forEach(function (item) {
      var r = item.frame.getBoundingClientRect();
      if (r.bottom < -100 || r.top > window.innerHeight + 100) return;
      var progress = Math.max(-1, Math.min(1, (halfHeight - (r.top + r.height / 2)) / halfHeight));
      item.image.style.transform = "translate3d(0," + (progress * 29).toFixed(1) + "px,0) scale(1.17)";
    });
  }
  function schedule() {
    if (!scheduled && !reduceMotion.matches) {
      scheduled = true;
      window.requestAnimationFrame(tick);
    }
  }
  window.addEventListener("scroll", schedule, {passive:true});
  window.addEventListener("resize", schedule, {passive:true});
  schedule();
})();
