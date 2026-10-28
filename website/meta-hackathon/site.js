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
