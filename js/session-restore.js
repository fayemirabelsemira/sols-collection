/* =========================================================
   KEEP YOUR PLACE
   1. Opening Read / Write and closing it again puts the home page
      back exactly where it was scrolled.
   2. Refreshing the page keeps the home scroll position, and if the
      reader was open it reopens the same chapter at the same spot.
   (Writer Studio saves its own place: see js/author.js)
   Uses sessionStorage, so a NEW tab still starts at the homepage.
   Load LAST, after script.js and premium.js.
========================================================= */
(function () {
  "use strict";

  var Y_KEY = "sol_home_y";
  var VIEW_KEY = "sol_view";

  function get(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function set(key, val) {
    try {
      sessionStorage.setItem(key, val);
    } catch (e) {}
  }
  function drop(key) {
    try {
      sessionStorage.removeItem(key);
    } catch (e) {}
  }

  function overlayOpen() {
    var c = document.body.classList;
    return c.contains("reader-open") || c.contains("modal-open");
  }

  /* jump (no animation) - Lenis needs to be told, plain scrollTo is not enough */
  function jumpTo(y) {
    var l = window.SolsPremium && window.SolsPremium.lenis;
    try {
      if (l) l.scrollTo(y, { immediate: true, force: true });
    } catch (e) {}
    window.scrollTo(0, y);
  }

  /* ---------- 1. remember the home page scroll ---------- */

  var homeY = Number(get(Y_KEY)) || 0;
  var queued = false;
  /* don't overwrite the saved spot with the page's initial 0 before we restored it */
  var armed = !homeY;

  window.addEventListener(
    "scroll",
    function () {
      if (!armed || overlayOpen() || queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        if (overlayOpen()) return;
        homeY = Math.max(0, Math.round(window.scrollY));
        set(Y_KEY, String(homeY));
      });
    },
    { passive: true }
  );

  /* reader / Writer Studio / book window closed -> back to where you were */
  var wasOpen = overlayOpen();
  new MutationObserver(function () {
    var open = overlayOpen();
    if (wasOpen && !open) jumpTo(homeY);
    wasOpen = open;
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  /* ---------- 2. after a refresh ---------- */

  /* the page height is small until the books have loaded, so wait for it */
  function restoreHomeScroll() {
    var y = homeY;
    if (!y) return;
    var moved = false;
    function stop() {
      moved = true;
      armed = true;
    }
    ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (ev) {
      window.addEventListener(ev, stop, { once: true, passive: true });
    });
    var tries = 0;
    (function go() {
      if (moved) return;
      if (overlayOpen()) {
        armed = true;
        return;
      }
      var room = document.documentElement.scrollHeight - window.innerHeight;
      if (room >= y - 2 || tries > 50) {
        jumpTo(Math.min(y, Math.max(0, room)));
        setTimeout(function () {
          armed = true;
        }, 400);
        return;
      }
      tries++;
      setTimeout(go, 150);
    })();
  }

  /* ----- reader: remember book + chapter + spot ----- */

  function readerState() {
    if (typeof currentBook === "undefined" || !currentBook) return null;
    if (typeof currentChapters === "undefined" || typeof currentChapterIndex === "undefined") return null;
    var ch = currentChapters[currentChapterIndex];
    if (!ch) return null;
    /* a locked chapter that only opened the payment window is not "being read" */
    if (typeof pendingChapter !== "undefined" && pendingChapter && pendingChapter === ch) return null;
    return { v: "reader", bookId: currentBook.id, chapterNumber: Number(ch.chapter_number) || currentChapterIndex + 1 };
  }

  function saveReader(withPosition) {
    var s = readerState();
    if (!s) return;
    s.loggedIn = typeof currentUser !== "undefined" && !!currentUser;
    var old = null;
    try {
      old = JSON.parse(get(VIEW_KEY) || "null");
    } catch (e) {}
    var same = old && old.v === "reader" && String(old.bookId) === String(s.bookId) && old.chapterNumber === s.chapterNumber;
    if (same && old.pos) s.pos = old.pos;
    if (withPosition && typeof captureReadingPosition === "function") {
      var p = null;
      try {
        p = captureReadingPosition();
      } catch (e) {}
      if (p) s.pos = { offset: p.offset, ratio: p.ratio };
    } else if (!same) {
      delete s.pos;
    }
    set(VIEW_KEY, JSON.stringify(s));
  }

  /* a new chapter opened */
  var origOpenChapter = window.openChapter;
  if (typeof origOpenChapter === "function") {
    window.openChapter = async function () {
      var r = await origOpenChapter.apply(this, arguments);
      try {
        saveReader(false);
      } catch (e) {}
      return r;
    };
  }

  /* the reader was closed on purpose: next refresh starts at the homepage view */
  var origCloseReader = window.closeReader;
  if (typeof origCloseReader === "function") {
    window.closeReader = function () {
      drop(VIEW_KEY);
      return origCloseReader.apply(this, arguments);
    };
  }

  /* keep the reading spot fresh while scrolling the story, and when leaving */
  var posTimer = null;
  function schedulePos() {
    clearTimeout(posTimer);
    posTimer = setTimeout(function () {
      if (document.body.classList.contains("reader-open")) saveReader(true);
    }, 600);
  }
  function flushPos() {
    clearTimeout(posTimer);
    if (document.body.classList.contains("reader-open")) saveReader(true);
  }
  function hookStoryScroll() {
    var sc = document.querySelector(".story-reader");
    if (sc) sc.addEventListener("scroll", schedulePos, { passive: true });
  }
  window.addEventListener("pagehide", flushPos);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushPos();
  });

  async function restoreReader(s) {
    /* wait for the book list (and for login, so paid chapters still open) */
    var waited = 0;
    while (waited < 8000) {
      var ready =
        typeof books !== "undefined" && books.length && (!s.loggedIn || (typeof currentUser !== "undefined" && currentUser));
      if (ready) break;
      await new Promise(function (r) {
        setTimeout(r, 150);
      });
      waited += 150;
    }
    if (typeof books === "undefined" || !books.length) return;
    var book = books.find(function (b) {
      return String(b.id) === String(s.bookId);
    });
    if (!book || typeof openReader !== "function") return;

    if (s.pos && typeof pendingRestore !== "undefined") {
      pendingRestore = {
        bookId: book.id,
        chapterNumber: s.chapterNumber,
        offset: s.pos.offset,
        ratio: s.pos.ratio
      };
    }
    try {
      await openReader(book.id, s.chapterNumber);
    } finally {
      if (typeof pendingRestore !== "undefined") pendingRestore = null;
    }
  }

  function init() {
    hookStoryScroll();

    /* a shared link or a payment return decides the page by itself */
    var hasRoute = !!(window.location.hash || window.location.search);

    var s = null;
    try {
      s = JSON.parse(get(VIEW_KEY) || "null");
    } catch (e) {}

    if (!hasRoute && s && s.v === "reader") restoreReader(s);

    if (!hasRoute) restoreHomeScroll();
    else armed = true;
  }

  if (document.readyState === "complete") init();
  else window.addEventListener("load", init);
})();
