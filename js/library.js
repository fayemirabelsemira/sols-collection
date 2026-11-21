/* =========================================================
   LIBRARY PAGE (#/library) + NEW-CHAPTER ALERTS
   - "Add to Library" on every book page
   - Library page: Saved / History / Offline, as a cover grid
   - Books in the library show "2 new" when chapters go live;
     the Library tab, header link and the installed app icon get
     a badge, and a toast says what's new.
   Needs js/app-core.js, js/pages.js and sql/03_app_features.sql.
========================================================= */
(function () {
  "use strict";
  var A = window.SolApp, P = window.SolPages;
  if (!A || !P) return;
  var sb = A.sb, esc = A.esc;

  var rows = new Map();      /* bookId -> { added_at, last_seen_at } */
  var updates = new Map();   /* bookId -> number of new chapters */
  var progress = new Map();  /* bookId -> { chapterNumber, chapterId, percent, ts } */
  var available = true;      /* false until the SQL is run */
  var loaded = false;
  var tab = "saved";
  var editing = false;
  var announced = false;

  function key(id) { return String(id); }

  /* ---------- data ---------- */
  async function load() {
    rows.clear(); updates.clear(); progress.clear();
    loaded = false;
    var u = A.user();
    mergeLocalProgress();
    if (!u) { loaded = true; paintAll(); return; }

    var res = await sb.from("library").select("book_id, added_at, last_seen_at").order("added_at", { ascending: false });
    if (res.error) {
      if (A.isMissing(res.error)) available = false;
      else console.warn("Library:", res.error);
    } else {
      available = true;
      (res.data || []).forEach(function (r) { rows.set(key(r.book_id), r); });
      var up = await sb.rpc("get_library_updates");
      if (!up.error) (up.data || []).forEach(function (r) { if (r.new_chapters > 0) updates.set(key(r.book_id), r.new_chapters); });
    }

    var pr = await sb.from("reading_progress").select("book_id, chapter_id, chapter_number, progress_percent, updated_at").eq("user_id", u.id);
    if (!pr.error) (pr.data || []).forEach(function (r) {
      var cur = progress.get(key(r.book_id));
      var ts = Date.parse(r.updated_at) || 0;
      if (!cur || ts > cur.ts) progress.set(key(r.book_id), { chapterNumber: Number(r.chapter_number) || 1, chapterId: r.chapter_id, percent: Number(r.progress_percent) || 0, ts: ts });
    });
    mergeLocalProgress();
    loaded = true;
    paintAll();
    announce();
  }

  function mergeLocalProgress() {
    if (typeof readLocalPositions !== "function") return;
    try {
      Object.values(readLocalPositions()).forEach(function (p) {
        if (!p || !p.bookId) return;
        var cur = progress.get(key(p.bookId));
        if (!cur || (p.ts || 0) > cur.ts) {
          progress.set(key(p.bookId), { chapterNumber: Number(p.chapterNumber) || 1, chapterId: p.chapterId, percent: Number(p.percent) || 0, ts: p.ts || 0, offset: p.offset, ratio: p.ratio });
        }
      });
    } catch (e) {}
  }

  function totalNew() {
    var n = 0;
    updates.forEach(function (v) { n += v; });
    return n;
  }

  function announce() {
    if (announced || !updates.size || typeof books === "undefined" || !books.length) return;
    announced = true;
    var ids = Array.from(updates.keys());
    var first = A.bookById(ids[0]);
    var msg = ids.length === 1 && first
      ? (updates.get(ids[0]) === 1 ? "New chapter" : updates.get(ids[0]) + " new chapters") + " in “" + first.title + "”"
      : ids.length + " stories in your library have new chapters";
    if (typeof solToast === "function") solToast(msg, { duration: 6000 });
  }

  async function add(bookId) {
    if (!A.requireLogin("Log in to save stories to your library.")) return;
    var id = key(bookId);
    rows.set(id, { book_id: bookId, added_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
    paintAll();
    var res = await sb.from("library").upsert({ user_id: A.user().id, book_id: bookId }, { onConflict: "user_id,book_id" });
    if (res.error) {
      rows.delete(id);
      paintAll();
      if (typeof solToast === "function") solToast(A.isMissing(res.error) ? "Library isn’t set up yet." : "Couldn’t add to your library.");
      return;
    }
    if (window.SolProfile) window.SolProfile.invalidate();
    if (typeof solToast === "function") solToast("Added to your library.");
  }

  async function remove(bookId) {
    var id = key(bookId);
    var old = rows.get(id);
    rows.delete(id); updates.delete(id);
    paintAll();
    var res = await sb.from("library").delete().eq("book_id", bookId).eq("user_id", A.user().id);
    if (res.error) {
      rows.set(id, old);
      paintAll();
      if (typeof solToast === "function") solToast("Couldn’t remove it. Try again.");
      return;
    }
    if (window.SolProfile) window.SolProfile.invalidate();
  }

  async function markSeen(bookId) {
    var id = key(bookId);
    if (!rows.has(id) || !A.user()) return;
    var had = updates.has(id);
    updates.delete(id);
    rows.get(id).last_seen_at = new Date().toISOString();
    if (had) paintAll();
    await sb.from("library").update({ last_seen_at: new Date().toISOString() }).eq("book_id", bookId).eq("user_id", A.user().id);
  }

  /* ---------- badges + book-page button ---------- */
  function paintBadges() {
    var n = totalNew();
    document.querySelectorAll("[data-library-badge]").forEach(function (el) {
      el.textContent = n > 99 ? "99+" : String(n);
      el.hidden = !n;
    });
    try {
      if (n && navigator.setAppBadge) navigator.setAppBadge(n);
      else if (!n && navigator.clearAppBadge) navigator.clearAppBadge();
    } catch (e) {}
  }

  function paintToggle() {
    var btn = document.getElementById("libraryToggle");
    if (!btn) return;
    var book = typeof currentBook !== "undefined" ? currentBook : null;
    btn.hidden = !available || !book;
    if (!book) return;
    var inLib = rows.has(key(book.id));
    btn.classList.toggle("in-library", inLib);
    btn.setAttribute("aria-pressed", inLib ? "true" : "false");
    btn.setAttribute("aria-label", inLib ? "In your library. Tap to remove." : "Add to library");
    btn.title = inLib ? "In your library" : "Add to library";
  }

  /* ---------- page ---------- */
  function tile(book, opts) {
    var p = progress.get(key(book.id));
    var s = A.stats(book.id);
    var total = s ? s.chapter_count : (book.total_chapters || 0);
    var n = updates.get(key(book.id));
    var meta = opts.meta || (p ? "Ch " + p.chapterNumber + (total ? " / " + total : "") : (total ? total + " chapters" : ""));
    var pct = p && total ? Math.min(100, Math.round(p.chapterNumber / total * 100)) : 0;
    return '<li class="sol-tile">' +
      '<button type="button" class="sol-tile-open" data-lib-open="' + esc(book.id) + '">' +
      '<span class="sol-tile-cover lores-cover">' + A.coverHtml(book) +
      (n ? '<span class="sol-new">' + n + " new</span>" : "") +
      (pct ? '<span class="sol-tile-bar"><i style="width:' + pct + '%"></i></span>' : "") +
      "</span>" +
      '<span class="sol-tile-title">' + esc(book.title) + "</span>" +
      '<span class="sol-tile-meta">' + esc(meta) + "</span>" +
      "</button>" +
      (opts.removable && editing ? '<button type="button" class="sol-tile-x" data-lib-remove="' + esc(book.id) + '" aria-label="Remove ' + esc(book.title) + '">×</button>' : "") +
      "</li>";
  }

  function empty(text, action) {
    return '<div class="sol-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4v16H5zM11 4h4v16h-4z"/><path d="m17 5 3.5 1-3.5 14-3.2-.9"/></svg><p>' + text + "</p>" + (action || "") + "</div>";
  }

  function listFor(which) {
    if (which === "saved") {
      return Array.from(rows.keys()).map(A.bookById).filter(Boolean)
        .sort(function (a, b) { return (updates.get(key(b.id)) || 0) - (updates.get(key(a.id)) || 0); });
    }
    if (which === "history") {
      mergeLocalProgress();
      return Array.from(progress.entries())
        .sort(function (a, b) { return b[1].ts - a[1].ts; })
        .map(function (e) { return A.bookById(e[0]); }).filter(Boolean);
    }
    var off = window.SolOffline;
    return (typeof books !== "undefined" ? books : []).filter(function (b) { return off && off.has(b.id); });
  }

  function render(el) {
    var inner = el.querySelector(".sol-page-inner");
    var u = A.user();
    var saved = listFor("saved");
    var showEdit = tab === "saved" && u && saved.length;
    if (!showEdit) editing = false;

    var tabs = [["saved", "Saved"], ["history", "History"], ["offline", "Offline"]].map(function (t) {
      return '<button type="button" role="tab" data-lib-tab="' + t[0] + '" aria-selected="' + (tab === t[0]) + '" class="' + (tab === t[0] ? "active" : "") + '">' + t[1] + "</button>";
    }).join("");

    var body;
    if (tab === "saved" && !u) {
      body = empty("Log in to save stories and see when new chapters drop.", '<button type="button" class="sol-btn primary" data-lib-login>Log in</button>');
    } else if (tab === "saved" && !available) {
      body = empty("The library switches on once the site’s database update is installed.");
    } else if (!loaded && tab !== "offline") {
      body = '<p class="sol-muted sol-pad">Loading…</p>';
    } else {
      var list = listFor(tab);
      if (!list.length) {
        body = tab === "saved" ? empty("Nothing saved yet. Tap the bookmark next to <strong>Start Reading</strong> on any story.", '<a class="sol-btn" href="#/search">Find a story</a>')
          : tab === "history" ? empty("Stories you start reading show up here.")
          : empty("Save a story offline from its page to read it without internet.");
      } else {
        body = '<ul class="sol-tiles">' + list.map(function (b) {
          return tile(b, { removable: tab === "saved", meta: tab === "offline" ? "Saved offline" : null });
        }).join("") + "</ul>";
      }
    }

    inner.innerHTML =
      '<div class="sol-page-head"><h1>Library</h1>' +
      (showEdit ? '<button type="button" class="sol-btn sm" data-lib-edit>' + (editing ? "Done" : "Edit") + "</button>" : "") +
      "</div>" +
      '<div class="sol-seg" role="tablist" aria-label="Library">' + tabs + "</div>" + body;
  }

  P.register("library", { title: "Library", render: render, live: true });
  var page = document.querySelector('.sol-page[data-page="library"]');

  function paintAll() {
    paintBadges();
    paintToggle();
    P.refresh("library");
  }

  async function openBook(bookId) {
    var book = A.bookById(bookId);
    if (!book) return;
    var p = progress.get(key(book.id));
    if (!p || tab === "saved" && updates.get(key(book.id))) return showBook(book.id);
    pendingRestore = { bookId: book.id, chapterId: p.chapterId, chapterNumber: p.chapterNumber, offset: p.offset || 0, ratio: p.ratio || 0 };
    try { await openReader(book.id, p.chapterNumber); }
    finally { pendingRestore = null; }
  }

  /* ---------- events ---------- */
  page.addEventListener("click", function (e) {
    var t = e.target, el;
    if ((el = t.closest("[data-lib-tab]"))) {
      tab = el.getAttribute("data-lib-tab");
      editing = false;
      render(page);
    } else if (t.closest("[data-lib-edit]")) {
      editing = !editing;
      render(page);
    } else if ((el = t.closest("[data-lib-remove]"))) {
      remove(el.getAttribute("data-lib-remove"));
    } else if ((el = t.closest("[data-lib-open]"))) {
      if (!editing) openBook(el.getAttribute("data-lib-open"));
    } else if (t.closest("[data-lib-login]")) {
      if (typeof openModal === "function") openModal("loginModal");
    }
  });

  document.addEventListener("click", function (e) {
    if (!e.target.closest("#libraryToggle")) return;
    var book = typeof currentBook !== "undefined" ? currentBook : null;
    if (!book) return;
    if (rows.has(key(book.id))) remove(book.id); else add(book.id);
  });

  if (typeof showBook === "function") {
    var origShow = showBook;
    window.showBook = async function () {
      var r = await origShow.apply(this, arguments);
      paintToggle();
      return r;
    };
  }
  if (typeof openReader === "function") {
    var origOpen = openReader;
    window.openReader = function (bookId) {
      markSeen(bookId);
      return origOpen.apply(this, arguments);
    };
  }

  A.on("auth", function () { announced = false; load(); });
  A.on("stats", announce);

  /* back in the app after a while: check for new chapters again */
  var lastCheck = Date.now();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && A.user() && available && Date.now() - lastCheck > 10 * 60 * 1000) {
      lastCheck = Date.now();
      announced = false;
      load();
    }
  });

  window.SolLibrary = { open: function () { P.go("library"); }, has: function (id) { return rows.has(key(id)); }, reload: load };
})();
