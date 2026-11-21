/* =========================================================
   PAGES
   Gives Search, Library, Discussion, Me and About their own
   screens (the home page is the normal site).
     #/search   #/library   #/discuss   #/discuss/<id>
     #/me       #/me/edit   #/about
   The phone's back button moves between them. Book pages keep
   using #/book/<slug> on top of whatever page is open.
   Feature files register a page with SolPages.register().
   Load AFTER script.js and js/app-core.js, BEFORE the feature files.
========================================================= */
(function () {
  "use strict";

  var pages = {};          /* name -> { el, render } */
  var current = "home";
  var currentHash = "";
  var TAB_FOR = { home: "home", search: "search", library: "library", discuss: "discuss", me: "me", about: "me" };
  var LEGACY = { "#library": "#/library", "#about": "#/about", "#discuss": "#/discuss", "#genres": "#/genres" };

  function parse(hash) {
    if (LEGACY[hash]) hash = LEGACY[hash];
    if (!hash || hash === "#" || hash === "#/" || hash === "#top") return { page: "home", sub: "", params: new URLSearchParams() };
    var m = hash.match(/^#\/([a-z]+)(?:\/([^?]*))?(?:\?(.*))?$/);
    if (!m || m[1] === "book") return null;
    return { page: m[1], sub: m[2] ? decodeURIComponent(m[2]) : "", params: new URLSearchParams(m[3] || "") };
  }

  function setTabs(name) {
    var tab = TAB_FOR[name] || "home";
    document.querySelectorAll("#mTabbar button").forEach(function (b) {
      var on = b.getAttribute("data-tab") === tab;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    document.querySelectorAll("[data-nav-page]").forEach(function (a) {
      a.classList.toggle("is-current", a.getAttribute("data-nav-page") === name);
    });
  }

  function toTop() {
    try {
      if (window.lenis && typeof window.lenis.scrollTo === "function") window.lenis.scrollTo(0, { immediate: true });
    } catch (e) {}
    window.scrollTo(0, 0);
  }

  /* scroll-in animations (premium.js) inside a page that was hidden: finish them */
  function settleAnimations(el) {
    if (!window.ScrollTrigger) return;
    try {
      ScrollTrigger.getAll().forEach(function (st) {
        if (st.trigger && el.contains(st.trigger) && st.animation) st.animation.progress(1);
      });
      ScrollTrigger.refresh();
    } catch (e) {}
  }

  function show(route) {
    var name = route.page;
    if (name !== "home" && !pages[name]) name = "home";
    var changed = name !== current;
    current = name;
    currentHash = name === "home" ? "" : location.hash;
    document.body.setAttribute("data-page", name);
    Object.keys(pages).forEach(function (k) { pages[k].el.hidden = k !== name; });
    setTabs(name);

    /* a page change closes the book sheet */
    var bm = document.getElementById("bookModal");
    if (bm && bm.classList.contains("active") && typeof closeModal === "function") closeModal("bookModal");
    if (typeof closeMobileMenu === "function") closeMobileMenu();
    var reader = document.getElementById("readerSection");
    if (reader && reader.classList.contains("active") && typeof closeReader === "function") closeReader();

    if (name !== "home") {
      try { pages[name].render(pages[name].el, route.sub, route.params); } catch (e) { console.error(e); }
      settleAnimations(pages[name].el);
    } else if (window.ScrollTrigger) {
      setTimeout(function () { try { ScrollTrigger.refresh(); } catch (e) {} }, 50);
    }
    if (changed || name !== "home") toTop();
    var title = pages[name] && pages[name].title;
    document.title = title ? title + " · Sol" : "Sol";
  }

  function onHash() {
    var h = location.hash;
    if (/^#\/book\//.test(h)) return;          /* book page opens on top */
    var route = parse(h);
    if (route) return show(route);
    /* an anchor on the home page (#books, #genres, ...) */
    var target = h && document.getElementById(h.slice(1));
    if (current !== "home") show({ page: "home", sub: "", params: new URLSearchParams() });
    if (target) setTimeout(function () { target.scrollIntoView({ behavior: "smooth", block: "start" }); }, 30);
  }

  function go(path) {
    var hash = path ? "#/" + path.replace(/^\/+/, "") : "#/";
    if (location.hash === hash) onHash();
    else location.hash = hash;
  }

  /* closing a book page must not drop the page you were on */
  if (typeof clearBookHash === "function") {
    var origClear = clearBookHash;
    window.clearBookHash = function () {
      var r = origClear.apply(this, arguments);
      if (current !== "home" && currentHash && !location.hash) {
        history.replaceState(null, "", location.pathname + location.search + currentHash);
      }
      return r;
    };
  }

  /* Home / Books / Genres links (header + mobile menu) while another page is
     open: their targets live on the hidden home page, so the smooth-scroll
     handler used to swallow the click and nothing happened. Go home first,
     then scroll to the section. */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || current === "home") return;
    var href = a.getAttribute("href") || "";
    if (href.length < 2 || href.charAt(1) === "/" || LEGACY[href]) return;
    var target = document.getElementById(href.slice(1));
    if (!target || !document.getElementById("top").contains(target) && href !== "#top") return;
    e.preventDefault();
    e.stopPropagation();
    if (location.hash) history.pushState(null, "", location.pathname + location.search);
    show({ page: "home", sub: "", params: new URLSearchParams() });
    if (href === "#top") return;
    setTimeout(function () {
      try {
        if (window.lenis && typeof window.lenis.scrollTo === "function") {
          window.lenis.scrollTo(target, { offset: -20, duration: 1.2 });
          return;
        }
      } catch (err) {}
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }, true);

  /* bottom tab bar */
  document.addEventListener("click", function (e) {
    var tab = e.target.closest("#mTabbar button[data-tab]");
    if (!tab) return;
    e.preventDefault();
    e.stopPropagation();
    var k = tab.getAttribute("data-tab");
    if (k === "home") {
      if (current === "home") toTop(); else go("");
    } else if (current === k && !parse(location.hash).sub) {
      toTop();
    } else go(k);
  }, true);

  window.addEventListener("hashchange", onHash);

  /* first load: open the page in the address bar */
  function start() {
    var route = parse(location.hash);
    if (LEGACY[location.hash]) history.replaceState(null, "", location.pathname + location.search + LEGACY[location.hash]);
    if (route && route.page !== "home") show(route);
    else { document.body.setAttribute("data-page", "home"); setTabs("home"); }
  }

  window.SolPages = {
    register: function (name, opts) {
      var el = document.querySelector('.sol-page[data-page="' + name + '"]');
      if (!el) return;
      pages[name] = { el: el, render: opts.render, title: opts.title, live: !!opts.live };
      el.hidden = true;
    },
    go: go,
    current: function () { return current; },
    route: function () { return parse(location.hash) || { page: "home", sub: "", params: new URLSearchParams() }; },
    /* re-draw the open page (new data arrived) */
    refresh: function (name) {
      if (current === "home" || (name && name !== current)) return;
      var r = parse(location.hash);
      if (r && pages[current]) {
        try { pages[current].render(pages[current].el, r.sub, r.params); } catch (e) { console.error(e); }
      }
    },
    back: function (fallback) {
      if (depth > 0) history.back();
      else go(fallback || "");
    }
  };

  /* how deep in-app navigation is, so "Back" never leaves the site */
  var depth = 0;
  window.addEventListener("hashchange", function () { depth++; });

  /* About is plain HTML in index.html: nothing to draw */
  window.SolPages.register("about", { title: "About", render: function () {} });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(start, 0); });
  else setTimeout(start, 0);

  /* new numbers arrived: re-draw list pages (never pages with forms) */
  if (window.SolApp) window.SolApp.on("stats", function () {
    if (pages[current] && pages[current].live) window.SolPages.refresh();
  });
})();
