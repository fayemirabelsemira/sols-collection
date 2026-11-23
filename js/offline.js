/* =========================================================
   APP + OFFLINE
   - registers the service worker (sw.js) so Sol can be installed
   - "Install app" banner / button (Android, desktop) and
     Add-to-Home-Screen steps for iPhone
   - "Save offline" on the book page: stores every chapter this
     reader can open in IndexedDB on this device; the reader uses
     the saved copy when there's no internet
   - offline banner
   Downloads are wiped when the reader logs out.
   Load AFTER script.js and js/app-core.js.
========================================================= */
(function () {
  "use strict";
  var A = window.SolApp;
  if (!A) return;
  var sb = A.sb, esc = A.esc;

  /* ---------- service worker ---------- */
  var swOk = "serviceWorker" in navigator &&
    (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1");
  if (swOk) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function (e) { console.warn("Service worker:", e); });
    });
  }

  /* ---------- tiny IndexedDB key/value store ---------- */
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error("No IndexedDB"));
      var req = indexedDB.open("sol-offline", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("kv"); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("kv", mode);
        var out = fn(t.objectStore("kv"));
        t.oncomplete = function () { resolve(out && out.result); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }
  function get(k) { return tx("readonly", function (s) { return s.get(k); }).catch(function () { return undefined; }); }
  function put(k, v) { return tx("readwrite", function (s) { s.put(v, k); }).catch(function () {}); }
  function del(k) { return tx("readwrite", function (s) { s.delete(k); }).catch(function () {}); }

  /* downloaded books: id -> { title, saved, total, chapterIds, savedAt } */
  var saved = {};
  var ready = get("books").then(function (v) { saved = v || {}; paintButton(); });
  function persistIndex() { return put("books", saved); }

  /* ---------- reader uses the saved copy when offline ---------- */
  var origRpc = sb.rpc.bind(sb);
  sb.rpc = function (fn, args, opts) {
    var k = fn === "get_chapter_for_reader" && args ? "ch:" + args.p_chapter_id
      : fn === "get_book_chapter_metadata" && args ? "meta:" + args.p_book_id : null;
    if (!k) return origRpc(fn, args, opts);
    return (async function () {
      await ready;
      if (!navigator.onLine) {
        var early = await get(k);
        if (early) return { data: early, error: null, offline: true };
      }
      /* weak signal: the phone says "online" but requests hang. If this is
         saved on the device, don't wait more than a few seconds for it. */
      var cached = await get(k);
      var res, call = origRpc(fn, args, opts).then(null, function (e) { return { data: null, error: e }; });
      if (cached) {
        var slow = new Promise(function (r) { setTimeout(function () { r(null); }, 4000); });
        res = await Promise.race([call, slow]);
        if (!res) return { data: cached, error: null, offline: true };
      } else res = await call;
      if (res.error && A.isOfflineError(res.error)) {
        if (cached) return { data: cached, error: null, offline: true };
        if (k.indexOf("ch:") === 0 && typeof solToast === "function") solToast("You’re offline and this chapter isn’t saved yet.");
      } else if (!res.error && Array.isArray(res.data) && res.data.length) {
        /* keep every chapter list + chapter read online, so recently read
           chapters open offline even without "Save offline" */
        put(k, res.data);
        if (k.indexOf("ch:") === 0) keepRecent(k);
      }
      return res;
    })();
  };

  /* Chapters kept from normal reading: newest last, capped so the device
     doesn't fill up. Chapters of fully saved books are never evicted. */
  var RECENT_MAX = 150;
  function keepRecent(k) {
    get("recent").then(function (list) {
      list = (list || []).filter(function (x) { return x !== k; });
      list.push(k);
      var drop = list.length > RECENT_MAX ? list.splice(0, list.length - RECENT_MAX) : [];
      var savedKeys = {};
      Object.keys(saved).forEach(function (b) { (saved[b].chapterIds || []).forEach(function (c) { savedKeys["ch:" + c] = 1; }); });
      drop.forEach(function (d) { if (!savedKeys[d]) del(d); });
      return put("recent", list);
    });
  }
  /* ask the browser not to clear our saved stories (iPhone clears site data otherwise) */
  function askPersist() {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
  }

  /* Offline, the purchase check can't reach the server. A chapter that's
     saved on this device was already unlocked when it was saved: open it. */
  if (typeof openChapter === "function") {
    var origOpenChapter = openChapter;
    window.openChapter = async function (index) {
      var ch = typeof currentChapters !== "undefined" ? currentChapters[index] : null;
      if (ch && !navigator.onLine && (await get("ch:" + ch.id))) {
        currentChapterIndex = index;
        currentChapter = ch;
        await loadChapterContent(ch);
        updateChapterSidebar();
        updateNavigationButtons();
        return;
      }
      return origOpenChapter.apply(this, arguments);
    };
  }

  /* ---------- save a whole book ---------- */
  var busy = null;

  async function download(book) {
    if (busy) return;
    if (!navigator.onLine) { if (typeof solToast === "function") solToast("Connect to the internet to save this story."); return; }
    busy = { id: String(book.id), done: 0, total: 0 };
    askPersist();
    paintButton();
    try {
      var meta = await origRpc("get_book_chapter_metadata", { p_book_id: book.id });
      if (meta.error) throw meta.error;
      var chapters = meta.data || [];
      busy.total = chapters.length;
      await put("meta:" + book.id, chapters);
      var ids = [];
      for (var i = 0; i < chapters.length; i++) {
        var c = chapters[i];
        var res = await origRpc("get_chapter_for_reader", { p_chapter_id: c.id });
        if (!res.error && Array.isArray(res.data) && res.data.length) {
          await put("ch:" + c.id, res.data);
          ids.push(c.id);
        }
        busy.done = i + 1;
        paintButton();
      }
      saved[String(book.id)] = { title: book.title, saved: ids.length, total: chapters.length, chapterIds: ids, savedAt: Date.now() };
      await persistIndex();
      if (typeof solToast === "function") {
        solToast(ids.length === chapters.length
          ? "Saved for offline: all " + ids.length + " chapters."
          : "Saved " + ids.length + " of " + chapters.length + " chapters. Locked chapters save once you unlock them.", { duration: 6000 });
      }
    } catch (e) {
      console.error("Offline save failed:", e);
      if (typeof solToast === "function") solToast("Couldn’t save this story. Try again.");
    } finally {
      busy = null;
      paintButton();
    }
  }

  async function removeBook(id) {
    var rec = saved[String(id)];
    if (!rec) return;
    await Promise.all((rec.chapterIds || []).map(function (c) { return del("ch:" + c); }));
    await del("meta:" + id);
    delete saved[String(id)];
    await persistIndex();
    paintButton();
  }

  async function removeAll() {
    await Promise.all(Object.keys(saved).map(removeBook));
    var recent = (await get("recent")) || [];
    await Promise.all(recent.map(del));
    await del("recent");
  }

  /* ---------- book page button ---------- */
  var DL_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>';
  var OK_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  function paintButton() {
    var host = document.getElementById("modalStats");
    var book = typeof currentBook !== "undefined" ? currentBook : null;
    if (!host || !book) return;
    var btn = document.getElementById("offlineButton");
    if (!btn) return; // the "Save offline" button was removed from the book page
    var id = String(book.id);
    if (busy && busy.id === id) {
      btn.disabled = true;
      btn.innerHTML = DL_ICON + "<span>Saving " + busy.done + "/" + (busy.total || "…") + "</span>";
    } else if (saved[id]) {
      btn.disabled = false;
      btn.classList.add("voted");
      btn.title = "Saved on this device. Tap to remove.";
      btn.innerHTML = OK_ICON + "<span>Offline</span>";
    } else {
      btn.disabled = !!busy;
      btn.classList.remove("voted");
      btn.title = "Save this story to read without internet";
      btn.innerHTML = DL_ICON + "<span>Save offline</span>";
    }
  }

  document.addEventListener("click", function (e) {
    var t = e.target, el;
    if (t.closest("#offlineButton")) {
      var book = typeof currentBook !== "undefined" ? currentBook : null;
      if (!book) return;
      if (saved[String(book.id)]) {
        if (confirm("Remove “" + book.title + "” from this device?")) removeBook(book.id);
      } else download(book);
    } else if ((el = t.closest("[data-offline-open]"))) {
      var oid = el.getAttribute("data-offline-open");
      if (typeof showBook === "function" && A.bookById(oid)) showBook(A.bookById(oid).id);
      else if (typeof solToast === "function") solToast("This story isn’t loaded yet. Open the app once with internet.");
    } else if ((el = t.closest("[data-offline-remove]"))) {
      removeBook(el.getAttribute("data-offline-remove")).then(function () { rerenderSettings(); });
    } else if (t.closest("[data-install]")) {
      install();
    } else if (t.closest("[data-install-dismiss]")) {
      try { localStorage.setItem("solInstallDismissed", String(Date.now())); } catch (e2) {}
      var b = document.getElementById("installBanner");
      if (b) b.hidden = true;
    }
  });

  if (typeof showBook === "function") {
    var origShow = showBook;
    window.showBook = async function () {
      var r = await origShow.apply(this, arguments);
      paintButton();
      return r;
    };
  }

  /* logging out removes downloaded (possibly paid) chapters from the device.
     Offline logout: keep them for now (a weak signal shouldn't lose stories)
     and wipe the next time the device is online, unless the same reader is
     signed in again by then. */
  var WIPE_KEY = "sol_offline_wipe";
  function pendingWipe() { try { return localStorage.getItem(WIPE_KEY); } catch (e) { return null; } }
  function setPendingWipe(v) { try { v ? localStorage.setItem(WIPE_KEY, v) : localStorage.removeItem(WIPE_KEY); } catch (e) {} }
  var hadUser = false, lastUid = null, authKnown = false, curUid = null;
  async function runPendingWipe() {
    var who = pendingWipe();
    if (!who || !navigator.onLine || !authKnown) return;
    setPendingWipe(null);
    if (curUid && curUid === who) return; /* same reader came back: keep their stories */
    await ready;
    await removeAll();
    paintButton();
  }
  A.on("auth", function (u) {
    authKnown = true;
    curUid = u && u.id ? String(u.id) : null;
    if (hadUser && !u) {
      if (navigator.onLine) removeAll();
      else setPendingWipe(lastUid || "1");
    }
    hadUser = !!u;
    if (curUid) lastUid = curUid;
    runPendingWipe();
  });
  window.addEventListener("online", runPendingWipe);

  /* ---------- install ---------- */
  var deferred = null;
  var isStandalone = function () {
    return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  };
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1 && !/android/i.test(navigator.userAgent));

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    showBanner();
    rerenderSettings();
  });
  window.addEventListener("appinstalled", function () {
    deferred = null;
    var b = document.getElementById("installBanner");
    if (b) b.hidden = true;
    if (typeof solToast === "function") solToast("Sol is on your home screen now.");
    rerenderSettings();
  });

  async function install() {
    if (deferred) {
      deferred.prompt();
      try { await deferred.userChoice; } catch (e) {}
      deferred = null;
      var b = document.getElementById("installBanner");
      if (b) b.hidden = true;
      rerenderSettings();
    } else {
      showGuide();
    }
  }

  /* Browsers without a one-tap install (iPhone/iPad, some Android browsers):
     show the steps instead of hiding the button. */
  var SHARE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  var MENU_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
  function showGuide() {
    var old = document.getElementById("solInstallGuide");
    if (old) old.remove();
    var steps = isIOS
      ? ["Tap the <b>Share</b> button " + SHARE_ICON + " in your browser bar.",
         "Scroll down and tap <b>Add to Home Screen</b>.",
         "Tap <b>Add</b>. Sol opens full screen from your home screen."]
      : ["Tap your browser’s <b>menu</b> " + MENU_ICON + " (top or bottom corner).",
         "Tap <b>Install app</b> or <b>Add to Home screen</b>.",
         "Tap <b>Install</b>. Sol opens full screen from your home screen."];
    var g = document.createElement("div");
    g.id = "solInstallGuide";
    g.className = "sol-install-guide";
    g.setAttribute("role", "dialog");
    g.setAttribute("aria-modal", "true");
    g.setAttribute("aria-label", "Install Sol");
    g.innerHTML = '<div class="sol-install-sheet"><img src="/icons/icon-192.png" alt="" width="56" height="56">' +
      "<h2>Install Sol</h2><ol>" + steps.map(function (s) { return "<li>" + s + "</li>"; }).join("") + "</ol>" +
      '<button type="button" class="read-button" data-guide-close>Got it</button></div>';
    g.addEventListener("click", function (e) {
      if (e.target === g || e.target.closest("[data-guide-close]")) g.remove();
    });
    document.body.appendChild(g);
  }

  function showBanner() {
    var b = document.getElementById("installBanner");
    if (!b || isStandalone()) return;
    var dismissed = 0;
    try { dismissed = Number(localStorage.getItem("solInstallDismissed")) || 0; } catch (e) {}
    if (Date.now() - dismissed < 14 * 86400000) return;
    if (!deferred && !isIOS && !isPhone) return;
    b.querySelector("[data-install-text]").textContent = "Install Sol: full screen, offline reading, one tap from your home screen.";
    b.querySelector("[data-install]").hidden = false;
    b.hidden = false;
  }
  var isPhone = isIOS || /android|mobile/i.test(navigator.userAgent);
  // Phones: show the banner even when the browser gives no install event;
  // the button then shows the manual steps.
  if (isPhone) setTimeout(showBanner, 4000);

  /* ---------- "Offline downloads" screen (Me page) ---------- */
  var downloadsEl = null;
  function rerenderSettings() {
    if (downloadsEl && downloadsEl.isConnected) renderDownloads(downloadsEl);
    if (window.SolPages && window.SolPages.current() === "me" && !window.SolPages.route().sub) window.SolPages.refresh("me");
  }

  function renderDownloads(el) {
    downloadsEl = el;
    var ids = Object.keys(saved);
    if (!ids.length) {
      el.innerHTML = '<div class="sol-empty"><p>No stories saved yet. Open a story and tap <strong>Save offline</strong> to read it without internet.</p></div>';
      return;
    }
    el.innerHTML = '<p class="sol-hint">Saved on this device only. Chapters you read are also kept for offline automatically. Logging out removes them.</p><ul class="sol-list">' + ids.map(function (id) {
      var r = saved[id];
      var book = A.bookById(id);
      return '<li class="sol-list-item sol-dl-item"><button type="button" class="sol-dl-open" data-offline-open="' + esc(id) + '" aria-label="Open ' + esc(r.title) + '">' +
        '<span class="sol-thumb lores-cover">' + A.coverHtml(book) + "</span>" +
        '<span class="sol-list-text"><strong>' + esc(r.title) + "</strong><small>" + r.saved + " of " + r.total +
        ' chapters · tap to open</small></span></button><button type="button" class="sol-btn sm" data-offline-remove="' + esc(id) + '">Remove</button></li>';
    }).join("") + "</ul>";
  }

  /* ---------- offline banner ---------- */
  /* a small note that shows for a few seconds when the connection changes,
     then gets out of the way (it used to stay on screen the whole time) */
  var bannerTimer = 0, wasOffline = false;
  function paintOnline(e) {
    var el = document.getElementById("offlineBanner");
    if (!el) return;
    var off = !navigator.onLine;
    if (!off && !wasOffline) { el.hidden = true; return; }
    el.textContent = off ? "Offline · saved stories still open" : "Back online";
    el.classList.toggle("is-online", !off);
    el.hidden = false;
    el.classList.remove("is-out");
    wasOffline = off;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () {
      el.classList.add("is-out");
      setTimeout(function () { el.hidden = true; el.classList.remove("is-out"); }, 400);
    }, off ? 3000 : 1800);
  }
  window.addEventListener("online", paintOnline);
  window.addEventListener("offline", paintOnline);
  paintOnline();

    window.SolOffline = {
    has: function (id) { return !!saved[String(id)]; },
    count: function () { return Object.keys(saved).length; },
    renderDownloads: renderDownloads,
    isStandalone: isStandalone,
    install: install
  };
})();
