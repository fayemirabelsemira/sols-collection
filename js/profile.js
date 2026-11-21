/* =========================================================
   ME PAGE  (#/me)
   Clean profile: card, one row of stats, then simple menu rows.
   Sub-pages: #/me/edit, #/me/purchases, #/me/downloads
   Needs js/app-core.js + js/pages.js. Purchases use the existing
   purchases table; downloads come from js/offline.js.
========================================================= */
(function () {
  "use strict";
  var A = window.SolApp, P = window.SolPages;
  if (!A || !P) return;
  var sb = A.sb, esc = A.esc;

  var COLORS = ["#e0274f", "#ff6a4d", "#ff9a3c", "#b05cff", "#3fa7ff", "#2fbf8f"];
  var cache = null;      /* { uid, library, started, highlights, reviews, purchases, chapterNo } */
  var loading = null;

  var I = {
    library: '<path d="M5 4h4v16H5zM11 4h4v16h-4z"/><path d="m17 5 3.5 1-3.5 14-3.2-.9"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/>',
    doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>',
    refund: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v4h4"/>',
    out: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    back: '<path d="m15 18-6-6 6-6"/>'
  };
  function icon(name) { return '<svg class="sol-ic" viewBox="0 0 24 24" aria-hidden="true">' + I[name] + "</svg>"; }

  function meta() { var u = A.user(); return (u && u.user_metadata) || {}; }
  function displayName() {
    var u = A.user();
    return (meta().display_name || (u && u.email ? u.email.split("@")[0] : "Reader")).trim();
  }
  function avatarColor() { return COLORS.indexOf(meta().avatar_color) !== -1 ? meta().avatar_color : COLORS[0]; }
  function avatarHtml(size, color) {
    return '<span class="sol-avatar ' + (size || "") + '" style="--av:' + A.safeColor(color || avatarColor()) + '">' +
      esc(displayName().charAt(0).toUpperCase() || "R") + "</span>";
  }

  /* ---------- header avatar (desktop) + mobile menu ---------- */
  function paintHeader() {
    var u = A.user();
    var nav = document.querySelector(".main-nav");
    var btn = document.getElementById("profileNavButton");
    if (nav && !btn) {
      btn = document.createElement("a");
      btn.id = "profileNavButton";
      btn.href = "#/me";
      btn.className = "sol-nav-avatar";
      btn.setAttribute("aria-label", "My profile");
      nav.insertBefore(btn, document.getElementById("logoutButton"));
    }
    if (btn) {
      btn.hidden = !u;
      if (u) btn.innerHTML = avatarHtml("sm");
    }
    var mobile = document.getElementById("mobileProfileButton");
    if (mobile) mobile.classList.toggle("hidden", !u);
    var logoutBtn = document.getElementById("logoutButton");
    if (logoutBtn) logoutBtn.classList.toggle("sol-hide-desktop", !!u);
  }

  /* ---------- data ---------- */
  function settle(p) { return p.then(function (r) { return r; }, function (e) { return { error: e }; }); }

  async function gather() {
    var u = A.user();
    if (!u) return null;
    if (cache && cache.uid === u.id) return cache;
    if (loading) return loading;
    loading = (async function () {
      var out = { uid: u.id, library: null, started: null, highlights: 0, reviews: null, purchases: null, chapterNo: {} };
      try { out.highlights = (JSON.parse(localStorage.getItem("solBookmarks.v1") || "[]") || []).length; } catch (e) {}
      var q = await Promise.all([
        settle(sb.from("library").select("book_id", { count: "exact", head: true }).eq("user_id", u.id)),
        settle(sb.from("reading_progress").select("book_id", { count: "exact", head: true }).eq("user_id", u.id)),
        settle(sb.from("book_reviews").select("id", { count: "exact", head: true }).eq("user_id", u.id)),
        settle(sb.from("purchases").select("book_id, chapter_id, purchase_type, amount, purchased_at")
          .eq("user_id", u.id).eq("payment_status", "paid").order("purchased_at", { ascending: false }).limit(50))
      ]);
      if (!q[0].error) out.library = q[0].count || 0;
      if (!q[1].error) out.started = q[1].count || 0;
      if (!q[2].error) out.reviews = q[2].count || 0;
      if (!q[3].error) out.purchases = q[3].data || [];
      var ids = (out.purchases || []).filter(function (r) { return r.chapter_id; }).map(function (r) { return r.chapter_id; });
      if (ids.length) {
        var c = await settle(sb.from("chapters").select("id, chapter_number").in("id", ids));
        if (!c.error) (c.data || []).forEach(function (r) { out.chapterNo[r.id] = r.chapter_number; });
      }
      cache = out;
      return out;
    })();
    try { return await loading; } finally { loading = null; }
  }

  /* ---------- pieces ---------- */
  function head(title, back) {
    return '<div class="sol-page-head">' +
      (back ? '<a class="sol-back" href="#/' + back + '" aria-label="Back">' + icon("back") + "</a>" : "") +
      "<h1>" + esc(title) + "</h1></div>";
  }
  function row(opts) {
    var tag = opts.href ? "a" : "button";
    return "<" + tag + ' class="sol-row-link' + (opts.danger ? " danger" : "") + '"' +
      (opts.href ? ' href="' + opts.href + '"' + (opts.external ? "" : "") : ' type="button"') +
      (opts.data ? " " + opts.data : "") + ">" +
      icon(opts.icon) + "<span>" + esc(opts.label) + "</span>" +
      (opts.value != null && opts.value !== "" ? '<em>' + esc(opts.value) + "</em>" : "") +
      (opts.chev === false ? "" : '<svg class="sol-chev" viewBox="0 0 24 24" aria-hidden="true">' + I.chev + "</svg>") +
      "</" + tag + ">";
  }
  function n(v) { return v == null ? "–" : Number(v).toLocaleString(); }

  function appRows() {
    var off = window.SolOffline;
    var h = "";
    if (off && !off.isStandalone()) h += row({ icon: "phone", label: "Install the app", data: "data-install", value: "", chev: false }) ;
    if (window.SolAuthor && window.SolAuthor.canWrite && window.SolAuthor.canWrite()) {
      h += row({ icon: "pen", label: "Writer Studio", data: "data-open-studio" });
    }
    h += row({ icon: "info", label: "About Sol", href: "#/about" });
    return h;
  }
  function helpRows() {
    return row({ icon: "shield", label: "Privacy Policy", href: "/privacy.html" }) +
      row({ icon: "doc", label: "Terms of Use", href: "/terms.html" }) +
      row({ icon: "refund", label: "Refund Policy", href: "/refunds.html" });
  }

  /* ---------- views ---------- */
  function viewMain(inner) {
    var u = A.user();
    if (!u) {
      inner.innerHTML = head("Me") +
        '<div class="sol-me-card guest"><span class="sol-avatar lg" style="--av:#3a2a33">?</span>' +
        '<div class="sol-me-who"><strong>Welcome to Sol</strong><small>Log in to keep your library, reviews and purchases.</small>' +
        '<div class="sol-btn-row"><button type="button" class="sol-btn primary" data-me-login>Log in</button>' +
        '<button type="button" class="sol-btn" data-me-signup>Sign up</button></div></div></div>' +
        '<div class="sol-group"><p class="sol-group-label">App</p>' + appRows() + "</div>" +
        '<div class="sol-group"><p class="sol-group-label">Help</p>' + helpRows() + "</div>";
      return;
    }
    var since = u.created_at ? new Date(u.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "";
    var d = cache && cache.uid === u.id ? cache : null;
    var offCount = window.SolOffline ? window.SolOffline.count() : 0;

    inner.innerHTML = head("Me") +
      '<div class="sol-me-card">' + avatarHtml("lg") +
      '<div class="sol-me-who"><strong>' + esc(displayName()) + "</strong>" +
      (since ? "<small>Reader since " + esc(since) + "</small>" : "") + "</div>" +
      '<a class="sol-btn sm" href="#/me/edit">Edit</a></div>' +
      '<div class="sol-me-stats">' +
      '<div><strong>' + n(d && d.library) + "</strong><span>Library</span></div>" +
      '<div><strong>' + n(d && d.started) + "</strong><span>Started</span></div>" +
      '<div><strong>' + n(d ? d.highlights : null) + "</strong><span>Highlights</span></div>" +
      '<div><strong>' + n(d && d.reviews) + "</strong><span>Reviews</span></div>" +
      '<div><strong data-streak-stat>' + (window.SolStreak ? esc(window.SolStreak.text()) : "–") + "</strong><span>Streak</span></div></div>" +
      '<div class="sol-group"><p class="sol-group-label">Reading</p>' +
      row({ icon: "library", label: "My Library", href: "#/library" }) +
      row({ icon: "chat", label: "Discussion", href: "#/discuss" }) +
      row({ icon: "receipt", label: "Purchases", href: "#/me/purchases", value: d && d.purchases ? String(d.purchases.length) : "" }) +
      row({ icon: "download", label: "Offline downloads", href: "#/me/downloads", value: offCount ? String(offCount) : "" }) +
      "</div>" +
      '<div class="sol-group"><p class="sol-group-label">App</p>' + appRows() + "</div>" +
      '<div class="sol-group"><p class="sol-group-label">Help</p>' + helpRows() + "</div>" +
      '<div class="sol-group">' + row({ icon: "out", label: "Log out", data: "data-me-logout", danger: true, chev: false }) + "</div>" +
      '<p class="sol-me-foot">' + esc(u.email || "") + "</p>";

    if (window.SolStreak) window.SolStreak.refresh();
    if (!d) gather().then(function () { if (P.current() === "me" && !P.route().sub) viewMain(inner); });
  }

  function viewEdit(inner) {
    var u = A.user();
    if (!u) return P.go("me");
    var picked = avatarColor();
    var swatches = COLORS.map(function (c) {
      return '<button type="button" class="sol-swatch' + (c === picked ? " on" : "") + '" style="--av:' + A.safeColor(c) +
        '" data-avatar-color="' + c + '" aria-label="Avatar colour" aria-pressed="' + (c === picked) + '"></button>';
    }).join("");
    inner.innerHTML = head("Edit profile", "me") +
      '<form class="sol-form" data-edit-form>' +
      '<div class="sol-edit-avatar" data-preview>' + avatarHtml("xl", picked) + "</div>" +
      '<p class="sol-label">Avatar colour</p><div class="sol-swatches">' + swatches + "</div>" +
      '<label class="sol-label" for="meName">Display name</label>' +
      '<input id="meName" name="name" class="sol-input" maxlength="60" value="' + esc(displayName()) + '" autocomplete="nickname">' +
      '<p class="sol-hint">Shown on your reviews and discussion posts.</p>' +
      '<label class="sol-label">Email</label><p class="sol-readonly">' + esc(u.email || "") + "</p>" +
      '<div class="sol-btn-row end"><a class="sol-btn" href="#/me">Cancel</a><button type="submit" class="sol-btn primary">Save</button></div>' +
      "</form>";
    inner.querySelector("[data-edit-form]").dataset.color = picked;
  }

  function viewPurchases(inner) {
    if (!A.user()) return P.go("me");
    inner.innerHTML = head("Purchases", "me") + '<div data-buys><p class="sol-muted">Loading…</p></div>';
    gather().then(function (d) {
      var box = inner.querySelector("[data-buys]");
      if (!box) return;
      if (!d || d.purchases === null) { box.innerHTML = '<p class="sol-muted">Couldn’t load purchases right now.</p>'; return; }
      if (!d.purchases.length) {
        box.innerHTML = '<div class="sol-empty"><p>No purchases yet. Chapters and books you unlock will be listed here.</p></div>';
        return;
      }
      box.innerHTML = '<ul class="sol-list">' + d.purchases.map(function (r) {
        var book = A.bookById(r.book_id);
        var what = r.purchase_type === "book" ? "Full book" : (d.chapterNo[r.chapter_id] ? "Chapter " + d.chapterNo[r.chapter_id] : "Chapter");
        var date = r.purchased_at ? new Date(r.purchased_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
        return '<li class="sol-list-item"><span class="sol-thumb lores-cover">' + A.coverHtml(book) + "</span>" +
          "<span class=\"sol-list-text\"><strong>" + esc(book ? book.title : "A story") + "</strong><small>" + what + (date ? " · " + date : "") + "</small></span>" +
          (r.amount != null ? "<b>₱" + Number(r.amount).toLocaleString() + "</b>" : "") + "</li>";
      }).join("") + "</ul>";
    });
  }

  function viewDownloads(inner) {
    inner.innerHTML = head("Offline downloads", "me") + '<div data-downloads></div>';
    if (window.SolOffline) window.SolOffline.renderDownloads(inner.querySelector("[data-downloads]"));
  }

  function render(el, sub) {
    var inner = el.querySelector(".sol-page-inner");
    if (sub === "edit") viewEdit(inner);
    else if (sub === "purchases") viewPurchases(inner);
    else if (sub === "downloads") viewDownloads(inner);
    else viewMain(inner);
  }

  /* re-draw the main Me screen only (never wipe a half-filled form) */
  function refreshMain() {
    if (P.current() === "me" && !P.route().sub) P.refresh("me");
  }

  P.register("me", { title: "Me", render: render });
  var page = document.querySelector('.sol-page[data-page="me"]');

  /* ---------- actions ---------- */
  async function saveMeta(patch) {
    var res = await sb.auth.updateUser({ data: patch });
    if (res.error) { if (typeof solToast === "function") solToast("Couldn’t save. Try again."); return false; }
    if (res.data && res.data.user) currentUser = res.data.user;
    paintHeader();
    return true;
  }

  page.addEventListener("click", function (e) {
    var t = e.target, el;
    if ((el = t.closest("[data-avatar-color]"))) {
      var form = page.querySelector("[data-edit-form]");
      var c = el.getAttribute("data-avatar-color");
      form.dataset.color = c;
      page.querySelectorAll("[data-avatar-color]").forEach(function (b) {
        var on = b === el; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
      });
      page.querySelector("[data-preview]").innerHTML = avatarHtml("xl", c);
    } else if (t.closest("[data-me-logout]")) {
      if (typeof logout === "function") logout();
    } else if (t.closest("[data-me-login]")) {
      if (typeof openModal === "function") openModal("loginModal");
    } else if (t.closest("[data-me-signup]")) {
      if (typeof openModal === "function") openModal("signupModal");
    } else if (t.closest("[data-open-studio]")) {
      if (window.SolAuthor) window.SolAuthor.open();
    }
  });

  page.addEventListener("submit", async function (e) {
    var form = e.target.closest("[data-edit-form]");
    if (!form) return;
    e.preventDefault();
    var name = form.name.value.trim().slice(0, 60);
    if (!name) { form.name.focus(); return; }
    var btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    var ok = await saveMeta({ display_name: name, avatar_color: form.dataset.color || avatarColor() });
    btn.disabled = false;
    if (ok) {
      if (typeof solToast === "function") solToast("Profile saved.");
      P.go("me");
    }
  });

  A.on("auth", function () {
    cache = null;
    paintHeader();
    if (P.route().sub === "edit" || P.route().sub === "purchases") { if (P.current() === "me") P.refresh("me"); }
    else refreshMain();
  });
  document.addEventListener("sol:canwrite", refreshMain);
  paintHeader();

  window.SolProfile = {
    open: function () { P.go("me"); },
    invalidate: function () { cache = null; }
  };
})();
