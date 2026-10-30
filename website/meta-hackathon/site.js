// YouTube embeds: load the player only when the visitor clicks play.
// Same facade as the main site: thumbnail + play button, iframe on click.
(function () {
  "use strict";

  document.querySelectorAll(".video-frame").forEach(function (frame) {
    var id = (frame.getAttribute("data-youtube-id") || "").trim();
    if (!id) {
      frame.classList.add("empty");
      frame.textContent = "Video coming soon";
      return;
    }
    var button = document.createElement("button");
    button.type = "button";
    button.className = "video-play";
    button.setAttribute("aria-label", "Play: " + frame.getAttribute("data-title"));
    button.style.backgroundImage = "url(https://i.ytimg.com/vi/" + encodeURIComponent(id) + "/hqdefault.jpg)";
    button.innerHTML = "<span aria-hidden=\"true\">&#9654;</span>";
    button.addEventListener("click", function () {
      // Always play inline. Note: YouTube only allows embeds on http(s)
      // pages, so preview via a local server or the deployed site —
      // opening this file directly (file://) makes YouTube show error 153.
      var iframe = document.createElement("iframe");
      iframe.src = "https://www.youtube.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0";
      iframe.title = frame.getAttribute("data-title");
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      frame.replaceChildren(iframe);
    });
    frame.appendChild(button);
  });
})();

// Subtitle browser: the left language list switches the right preview pane.
(function () {
  "use strict";

  var tabs = Array.prototype.slice.call(document.querySelectorAll(".sub-list [role=\"tab\"]"));
  if (!tabs.length) {
    return;
  }

  function select(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
      var panel = document.getElementById(t.getAttribute("aria-controls"));
      if (panel) {
        panel.hidden = !on;
      }
    });
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () { select(tab); });
    tab.addEventListener("keydown", function (e) {
      var next = null;
      if (e.key === "ArrowDown") {
        next = tabs[(i + 1) % tabs.length];
      } else if (e.key === "ArrowUp") {
        next = tabs[(i - 1 + tabs.length) % tabs.length];
      }
      if (next) {
        e.preventDefault();
        next.focus();
        select(next);
      }
    });
  });
})();

// Scroll reveals + animated hero counters. No dependencies.
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Reveal sections as they enter the viewport.
  var revealItems = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealItems.forEach(function (el) { observer.observe(el); });
  } else {
    revealItems.forEach(function (el) { el.classList.add("visible"); });
  }

  // Animated counters in the hero stats.
  function animateCount(el) {
    var target = parseInt(el.getAttribute("data-count"), 10);
    if (!isFinite(target)) {
      return;
    }
    if (reduceMotion) {
      el.textContent = String(target);
      return;
    }
    var duration = 1100;
    var started = null;
    function frame(now) {
      if (started === null) {
        started = now;
      }
      var ratio = Math.min(1, (now - started) / duration);
      var eased = 1 - Math.pow(1 - ratio, 3);
      el.textContent = String(Math.round(target * eased));
      if (ratio < 1) {
        requestAnimationFrame(frame);
      }
    }
    requestAnimationFrame(frame);
  }

  var counters = document.querySelectorAll("[data-count]");
  if ("IntersectionObserver" in window && !reduceMotion) {
    var counted = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          counted.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    counters.forEach(function (el) { counted.observe(el); });
  } else {
    counters.forEach(animateCount);
  }
})();
