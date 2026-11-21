/* =========================================================
   SOL APP CORE
   Shared helpers + data for the app features
   (story details, library, reviews, profile, offline).
   Needs sql/03_app_features.sql. Until that SQL is run, every
   feature built on it quietly stays hidden.
   Load AFTER script.js.
========================================================= */
(function () {
  "use strict";
  if (typeof supabaseClient === "undefined") return;

  var sb = supabaseClient;
  var listeners = {};

  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
  }
  function emit(evt, data) {
    (listeners[evt] || []).forEach(function (fn) {
      try { fn(data); } catch (e) { console.error(e); }
    });
  }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* Colours stored in user profiles are user-controlled (anyone can call
     auth.updateUser). Only a plain #rrggbb value may reach a style="" attribute,
     otherwise "red;position:fixed;..." would restyle the page for every viewer. */
  function safeColor(v, fallback) {
    return /^#[0-9a-fA-F]{6}$/.test(String(v || "")) ? String(v) : (fallback || "#e0274f");
  }

  /* "table/function doesn't exist yet" = SQL not run: hide, don't nag */
  function isMissing(error) {
    if (!error) return false;
    var c = String(error.code || "");
    return c === "PGRST202" || c === "PGRST205" || c === "42P01" || c === "42883" || c === "42703" ||
      /does not exist|could not find/i.test(error.message || "");
  }

  function isOfflineError(error) {
    return !navigator.onLine || /failed to fetch|network|load failed/i.test((error && (error.message || String(error))) || "");
  }

  function timeAgo(value) {
    if (!value) return "";
    var d = new Date(value);
    if (isNaN(d)) return "";
    var days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return days + " days ago";
    if (days < 30) { var w = Math.floor(days / 7); return w + (w === 1 ? " week ago" : " weeks ago"); }
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  }

  function readTime(words) {
    var mins = Math.round((Number(words) || 0) / 230);
    if (mins < 1) return "";
    if (mins < 60) return mins + " min read";
    var h = mins / 60;
    return (h < 10 ? Math.round(h * 2) / 2 : Math.round(h)) + " h read";
  }

  var STATUS_LABEL = { ongoing: "Ongoing", completed: "Completed", hiatus: "On hiatus" };

  /* furthest chapter this reader opened in a book (set by the reader) */
  function reachedIn(bookId) {
    var n = 0;
    try { n = Number((JSON.parse(localStorage.getItem("solReached.v1") || "{}") || {})[String(bookId)]) || 0; } catch (e) {}
    try {
      var st = window.SolReader && window.SolReader.state ? window.SolReader.state() : null;
      if (st && st.book && st.chapter && String(st.book.id) === String(bookId)) n = Math.max(n, Number(st.chapter.chapter_number) || 0);
    } catch (e) {}
    return n;
  }

  /* spoiler-safe: written by someone further ahead than this reader? */
  function aheadOf(bookId, writerChapter) {
    var w = Number(writerChapter) || 0;
    return !!bookId && w > 0 && w > reachedIn(bookId);
  }

  function bookById(id) {
    return (typeof books !== "undefined" ? books : []).find(function (b) { return String(b.id) === String(id); });
  }

  function user() {
    return typeof currentUser !== "undefined" ? currentUser : null;
  }

  function requireLogin(message) {
    if (user()) return true;
    if (typeof solToast === "function") solToast(message || "Log in first.");
    if (typeof openModal === "function") openModal("loginModal");
    return false;
  }

  function coverHtml(book) {
    return book && book.cover_url
      ? '<img src="' + esc(book.cover_url) + '" alt="" loading="lazy" decoding="async">'
      : '<div class="cover-fallback"><span>S</span></div>';
  }

  /* ---------- public numbers: chapters, words, last update, ratings ---------- */
  var stats = {};
  var ratings = {};

  async function loadStats() {
    var res = await Promise.all([
      sb.rpc("get_book_stats").then(function (r) { return r; }, function (e) { return { error: e }; }),
      sb.rpc("get_rating_summary").then(function (r) { return r; }, function (e) { return { error: e }; })
    ]);
    if (!res[0].error && Array.isArray(res[0].data)) {
      stats = {};
      res[0].data.forEach(function (r) { stats[r.book_id] = r; });
    }
    if (!res[1].error && Array.isArray(res[1].data)) {
      ratings = {};
      res[1].data.forEach(function (r) { ratings[r.book_id] = r; });
    }
    emit("stats");
  }

  /* reload the numbers whenever the catalog reloads */
  if (typeof loadBooks === "function") {
    var origLoad = loadBooks;
    window.loadBooks = async function () {
      var r = await origLoad.apply(this, arguments);
      await loadStats();
      return r;
    };
  }

  /* ---------- auth (cheap work only inside the callback: see script.js) ---------- */
  var lastUid;
  sb.auth.onAuthStateChange(function (_e, session) {
    var uid = session && session.user ? session.user.id : null;
    if (uid === lastUid) return;
    lastUid = uid;
    setTimeout(function () { emit("auth", session ? session.user : null); }, 0);
  });

  window.SolApp = {
    sb: sb,
    on: on,
    emit: emit,
    esc: esc,
    safeColor: safeColor,
    isMissing: isMissing,
    isOfflineError: isOfflineError,
    timeAgo: timeAgo,
    readTime: readTime,
    STATUS_LABEL: STATUS_LABEL,
    bookById: bookById,
    reachedIn: reachedIn,
    aheadOf: aheadOf,
    user: user,
    requireLogin: requireLogin,
    coverHtml: coverHtml,
    stats: function (id) { return stats[id] || null; },
    rating: function (id) { return ratings[id] || null; },
    setRating: function (id, r) { ratings[id] = r; emit("stats"); },
    loadStats: loadStats
  };

  /* books may already be on screen if this file loaded late */
  if (typeof books !== "undefined" && books.length) loadStats();
})();
