/* GoodStrata marketing nav — progressive enhancement.
   Injects an accessible mobile menu button and wires the toggle; marks the
   current page. No dependencies; safe if the header is missing. */
(function () {
  "use strict";
  var header = document.querySelector("header.site");
  if (!header) return;
  var nav = header.querySelector("nav");
  if (!nav) return;

  // Decorative: a translucent 3D square that rotates around the logo's icon.
  var logo = header.querySelector(".logo");
  if (logo) {
    var orbit = document.createElement("span");
    orbit.className = "logo-orbit";
    orbit.setAttribute("aria-hidden", "true");
    orbit.innerHTML =
      '<span class="logo-cube">' +
      '<span class="cf cf-front"></span><span class="cf cf-back"></span>' +
      '<span class="cf cf-right"></span><span class="cf cf-left"></span>' +
      '<span class="cf cf-top"></span><span class="cf cf-bottom"></span>' +
      "</span>";
    logo.insertBefore(orbit, logo.firstChild);
  }

  var MOBILE = window.matchMedia("(max-width: 820px)");

  // Mark the current page (normalise trailing slashes).
  var here = location.pathname.replace(/\/+$/, "") || "/";
  nav.querySelectorAll("a[href]").forEach(function (a) {
    var url;
    try {
      url = new URL(a.getAttribute("href"), location.origin);
    } catch (_) {
      return;
    }
    if (url.origin === location.origin) {
      var path = url.pathname.replace(/\/+$/, "") || "/";
      if (path === here) a.setAttribute("aria-current", "page");
    }
  });

  // Build the toggle button.
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "nav-toggle";
  btn.setAttribute("aria-label", "Open menu");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", nav.id || (nav.id = "site-nav"));
  btn.innerHTML = '<span class="nav-toggle-bars" aria-hidden="true"><span></span><span></span><span></span></span>';
  header.insertBefore(btn, nav);

  function setOpen(open) {
    header.classList.toggle("nav-open", open);
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }

  btn.addEventListener("click", function () {
    setOpen(!header.classList.contains("nav-open"));
  });

  // Close on link tap, Escape, and when leaving mobile width.
  nav.addEventListener("click", function (e) {
    if (e.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && header.classList.contains("nav-open")) {
      setOpen(false);
      btn.focus();
    }
  });
  var onChange = function () {
    if (!MOBILE.matches) setOpen(false);
  };
  if (MOBILE.addEventListener) MOBILE.addEventListener("change", onChange);
  else if (MOBILE.addListener) MOBILE.addListener(onChange);

  // Sticky header: transparent at the top of the page, solid once scrolled.
  var stickyWrap = header.parentElement;
  if (stickyWrap) {
    var onScroll = function () {
      stickyWrap.classList.toggle("scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }
})();
