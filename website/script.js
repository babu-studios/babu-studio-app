// Header shadow after scrolling.
(function () {
  var header = document.getElementById("site-header");
  function update() { header.classList.toggle("scrolled", window.scrollY > 8); }
  window.addEventListener("scroll", update, { passive: true });
  update();
})();

// Screenshot carousel: native scroll-snap showing several slides at once, with buttons, dots, keyboard and autoplay.
(function () {
  var track = document.getElementById("carousel-track");
  var dotsEl = document.getElementById("carousel-dots");
  var slides = Array.prototype.slice.call(track.children);
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var index = 0, timer = null, dots = [];

  function perView() { return Math.max(1, Math.round(track.clientWidth / slides[0].offsetWidth)); }
  function maxIndex() { return slides.length - perView(); }
  function step() { return slides[1].offsetLeft - slides[0].offsetLeft; }

  function buildDots() {
    dotsEl.textContent = "";
    dots = [];
    for (var i = 0; i <= maxIndex(); i++) {
      (function (n) {
        var dot = document.createElement("button");
        dot.type = "button";
        dot.setAttribute("role", "tab");
        dot.setAttribute("aria-label", "Show screenshots from " + (n + 1));
        dot.addEventListener("click", function () { go(n); stop(); });
        dotsEl.appendChild(dot);
        dots.push(dot);
      })(i);
    }
    index = Math.min(index, maxIndex());
    render();
  }

  function render() {
    dots.forEach(function (dot, i) {
      dot.classList.toggle("active", i === index);
      dot.setAttribute("aria-selected", i === index ? "true" : "false");
    });
  }

  function go(i) {
    var max = maxIndex();
    index = i > max ? 0 : i < 0 ? max : i;
    track.scrollTo({ left: index * step(), behavior: reduceMotion ? "auto" : "smooth" });
    render();
  }

  function start() { if (!reduceMotion && !timer) timer = setInterval(function () { go(index + 1); }, 5000); }
  function stop() { clearInterval(timer); timer = null; }

  track.addEventListener("scroll", function () {
    var i = Math.min(Math.round(track.scrollLeft / step()), maxIndex());
    if (i !== index) { index = i; render(); }
  }, { passive: true });
  window.addEventListener("resize", buildDots);
  document.getElementById("carousel-prev").addEventListener("click", function () { go(index - 1); stop(); });
  document.getElementById("carousel-next").addEventListener("click", function () { go(index + 1); stop(); });
  track.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") { go(index - 1); stop(); e.preventDefault(); }
    if (e.key === "ArrowRight") { go(index + 1); stop(); e.preventDefault(); }
  });
  var carousel = document.getElementById("carousel");
  carousel.addEventListener("mouseenter", stop);
  carousel.addEventListener("touchstart", stop, { passive: true });
  buildDots();

  // Only autoplay while the carousel is on screen.
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      entries[0].isIntersecting ? start() : stop();
    }, { threshold: 0.4 }).observe(carousel);
  } else {
    start();
  }

  // Full view: an expand button on each slide opens the image in a lightbox.
  var box = document.getElementById("lightbox");
  var boxImg = document.getElementById("lightbox-img");
  var boxCaption = document.getElementById("lightbox-caption");
  var current = 0, opener = null;

  function show(i) {
    current = (i + slides.length) % slides.length;
    var img = slides[current].querySelector("img");
    boxImg.src = img.src;
    boxImg.alt = img.alt;
    boxCaption.innerHTML = slides[current].querySelector("figcaption").innerHTML;
  }
  function openBox(i) {
    stop();
    opener = document.activeElement;
    show(i);
    box.hidden = false;
    document.body.style.overflow = "hidden";
    document.getElementById("lightbox-close").focus();
  }
  function closeBox() {
    box.hidden = true;
    document.body.style.overflow = "";
    if (opener) opener.focus();
  }

  slides.forEach(function (slide, i) {
    var expand = document.createElement("button");
    expand.type = "button";
    expand.className = "expand-btn";
    expand.setAttribute("aria-label", "View screenshot " + (i + 1) + " full size");
    expand.innerHTML = "<svg viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7\"/></svg>";
    expand.addEventListener("click", function () { openBox(i); });
    slide.appendChild(expand);
    slide.querySelector("img").addEventListener("click", function () { openBox(i); });
  });

  document.getElementById("lightbox-close").addEventListener("click", closeBox);
  document.getElementById("lightbox-prev").addEventListener("click", function () { show(current - 1); });
  document.getElementById("lightbox-next").addEventListener("click", function () { show(current + 1); });
  box.addEventListener("click", function (e) { if (e.target === box) closeBox(); });
  document.addEventListener("keydown", function (e) {
    if (box.hidden) return;
    if (e.key === "Escape") closeBox();
    if (e.key === "ArrowLeft") show(current - 1);
    if (e.key === "ArrowRight") show(current + 1);
  });
})();

// YouTube embeds: load the player only when the visitor clicks play.
(function () {
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
      // YouTube rejects embeds from file:// pages (error 153), so open the video directly instead.
      if (location.protocol === "file:") {
        window.open("https://www.youtube.com/watch?v=" + encodeURIComponent(id), "_blank", "noopener");
        return;
      }
      var iframe = document.createElement("iframe");
      iframe.src = "https://www.youtube.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0";
      iframe.title = frame.getAttribute("data-title");
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      frame.replaceChildren(iframe);
    });
    frame.appendChild(button);

    var link = document.createElement("a");
    link.className = "video-link";
    link.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(id);
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Watch on YouTube";
    frame.parentNode.appendChild(link);
  });
})();

// Scroll reveals: fade sections in as they enter the viewport.
(function () {
  var items = document.querySelectorAll(".reveal");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!("IntersectionObserver" in window) || reduceMotion) {
    items.forEach(function (el) { el.classList.add("visible"); });
    return;
  }
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  items.forEach(function (el) { observer.observe(el); });
})();

// Recommend the build for the visitor's Mac when the browser can tell us.
(function () {
  var canvas = document.createElement("canvas");
  var gl = canvas.getContext("webgl");
  var info = gl && gl.getExtension("WEBGL_debug_renderer_info");
  var renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "";
  if (/Intel/i.test(renderer) && !/Apple/i.test(renderer)) {
    document.querySelectorAll("[data-dl-main]").forEach(function (main) {
      var alt = document.querySelector('[data-dl-alt="' + main.getAttribute("data-dl-main") + '"]');
      if (!alt) return;
      var href = main.href, label = main.textContent;
      main.href = alt.href; main.textContent = alt.textContent;
      alt.href = href; alt.textContent = label;
    });
  }
})();
