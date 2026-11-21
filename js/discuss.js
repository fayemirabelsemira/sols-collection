/* =========================================================
   DISCUSSION (#/discuss)
   #/discuss              board (filter by story, Latest / Top)
   #/discuss?book=<id>    one story's board
   #/discuss/new          write a post
   #/discuss/<id>         a post + replies
   Book pages get a "Discussion" link.
   Needs js/app-core.js, js/pages.js and sql/04_discussions.sql.
========================================================= */
(function () {
  "use strict";
  var A = window.SolApp, P = window.SolPages;
  if (!A || !P) return;
  var sb = A.sb, esc = A.esc;

  var PAGE = 20;
  var state = { book: "", sort: "latest", list: [], more: false, liked: new Set(), writer: false, missing: false, loadingKey: "" };
  var COLS_BASE = "id, book_id, user_id, display_name, avatar_color, title, body, is_spoiler, pinned, reply_count, like_count, created_at, last_activity_at";
  /* reader_chapter comes with sql/10 (spoiler-safe); work without it until then */
  var hasReach = true;
  function cols() { return hasReach ? COLS_BASE + ", reader_chapter" : COLS_BASE; }
  function replyCols() { return "id, user_id, display_name, avatar_color, body, created_at" + (hasReach ? ", reader_chapter" : ""); }
  function noColumn(err) { return err && (err.code === "42703" || /reader_chapter/.test(err.message || "")); }
  async function withCols(run) {
    var r = await run();
    if (hasReach && r && r.error && noColumn(r.error)) { hasReach = false; r = await run(); }
    return r;
  }

  /* spoiler-safe: posted by someone who had read further than this reader */
  function ahead(row, bookId) {
    var u = A.user();
    if (!bookId || (u && row.user_id === u.id)) return false;
    return A.aheadOf ? A.aheadOf(bookId, row.reader_chapter) : false;
  }
  function aheadNote(n) { return "Possible spoiler · from a reader at Chapter " + n; }

  var ICON = {
    back: '<path d="m15 18-6-6 6-6"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    reply: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/>',
    pin: '<path d="M9 3h6l-1 6 4 4H6l4-4z"/><path d="M12 13v8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    send: '<path d="M4 12 20 4l-6 16-3-7z"/>'
  };
  function ic(n, cls) { return '<svg class="' + (cls || "sol-ic") + '" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + "</svg>"; }

  function avatar(name, color, size) {
    return '<span class="sol-avatar ' + (size || "sm") + '" style="--av:' + A.safeColor(color) + '">' +
      esc(String(name || "R").trim().charAt(0).toUpperCase()) + "</span>";
  }
  function bookTag(id) {
    if (!id) return '<span class="sol-dtag">General</span>';
    var b = A.bookById(id);
    return '<span class="sol-dtag story">' + esc(b ? b.title : "A story") + "</span>";
  }
  function canDelete(row) {
    var u = A.user();
    return !!u && (row.user_id === u.id || state.writer);
  }
  function routeHash(book, sort) {
    var q = [];
    if (book) q.push("book=" + encodeURIComponent(book));
    if (sort && sort !== "latest") q.push("sort=" + sort);
    return "discuss" + (q.length ? "?" + q.join("&") : "");
  }

  async function checkWriter() {
    state.writer = false;
    if (!A.user()) return;
    var r = await sb.rpc("is_sol_writer");
    state.writer = !r.error && r.data === true;
  }

  async function loadLikes(ids) {
    var u = A.user();
    if (!u || !ids.length) return;
    var r = await sb.from("discussion_likes").select("thread_id").eq("user_id", u.id).in("thread_id", ids);
    if (!r.error) (r.data || []).forEach(function (x) { state.liked.add(x.thread_id); });
  }

  /* ---------- board ---------- */
  async function fetchList(append) {
    var from = append ? state.list.length : 0;
    var r = await withCols(function () {
      var q = sb.from("discussion_threads").select(cols());
      if (state.book === "general") q = q.is("book_id", null);
      else if (state.book) q = q.eq("book_id", state.book);
      q = state.sort === "top"
        ? q.order("pinned", { ascending: false }).order("like_count", { ascending: false }).order("reply_count", { ascending: false })
        : q.order("pinned", { ascending: false }).order("last_activity_at", { ascending: false });
      return q.range(from, from + PAGE);
    });
    if (r.error) {
      if (A.isMissing(r.error)) state.missing = true;
      return false;
    }
    state.missing = false;
    var rows = r.data || [];
    state.more = rows.length > PAGE;
    rows = rows.slice(0, PAGE);
    state.list = append ? state.list.concat(rows) : rows;
    await loadLikes(rows.map(function (x) { return x.id; }));
    return true;
  }

  function threadCard(t) {
    var liked = state.liked.has(t.id);
    return '<li><article class="sol-thread' + (t.pinned ? " pinned" : "") + '">' +
      '<a class="sol-thread-link" href="#/discuss/' + esc(t.id) + '" aria-label="' + esc(t.title) + '"></a>' +
      '<div class="sol-thread-top">' + avatar(t.display_name, t.avatar_color) +
      "<strong>" + esc(t.display_name) + "</strong>" +
      '<time>' + A.timeAgo(t.created_at) + "</time>" +
      (t.pinned ? '<span class="sol-pin">' + ic("pin") + "Pinned</span>" : "") + "</div>" +
      (ahead(t, t.book_id)
        ? '<h3 class="sol-ahead-title">' + esc(aheadNote(t.reader_chapter)) + "</h3>" +
          '<p class="sol-muted">Hidden because you haven’t reached that chapter yet. Open it to read anyway.</p>'
        : "<h3>" + esc(t.title) + "</h3>" +
          (t.body ? '<p class="sol-thread-body' + (t.is_spoiler ? " spoiler" : "") + '">' + esc(t.body) + "</p>" : "")) +
      '<div class="sol-thread-foot">' + bookTag(t.book_id) +
      '<button type="button" class="sol-act' + (liked ? " on" : "") + '" data-like="' + esc(t.id) + '" aria-pressed="' + liked + '" aria-label="Like">' + ic("heart") + "<span>" + (t.like_count || 0) + "</span></button>" +
      '<span class="sol-act">' + ic("reply") + "<span>" + (t.reply_count || 0) + "</span></span>" +
      "</div></article></li>";
  }

  function filterChips() {
    var opts = [["", "All"], ["general", "General"]].concat((typeof books !== "undefined" ? books : []).map(function (b) { return [String(b.id), b.title]; }));
    return opts.map(function (o) {
      var on = state.book === o[0];
      return '<a class="sol-pill' + (on ? " on" : "") + '" href="#/' + routeHash(o[0], state.sort) + '" aria-current="' + (on ? "true" : "false") + '">' + esc(o[1]) + "</a>";
    }).join("");
  }

  function boardHtml() {
    var head = '<div class="sol-page-head"><h1>Discussion</h1>' +
      '<a class="sol-btn sm primary" href="#/discuss/new' + (state.book && state.book !== "general" ? "?book=" + encodeURIComponent(state.book) : "") + '">' + ic("plus") + "New post</a></div>" +
      '<div class="sol-chip-row scroll">' + filterChips() + "</div>" +
      '<div class="sol-seg small" role="tablist">' +
      '<a role="tab" href="#/' + routeHash(state.book, "latest") + '" class="' + (state.sort !== "top" ? "active" : "") + '" aria-selected="' + (state.sort !== "top") + '">Latest</a>' +
      '<a role="tab" href="#/' + routeHash(state.book, "top") + '" class="' + (state.sort === "top" ? "active" : "") + '" aria-selected="' + (state.sort === "top") + '">Top</a></div>';
    if (state.missing) return '<div class="sol-page-head"><h1>Discussion</h1></div><div class="sol-empty"><p>Discussion switches on once the site’s database update is installed.</p></div>';
    if (!state.list.length) {
      return head + '<div class="sol-empty">' + ic("reply") + "<p>No posts here yet. Start the conversation: theories, favourite scenes, who you’re rooting for.</p>" +
        '<a class="sol-btn primary" href="#/discuss/new' + (state.book && state.book !== "general" ? "?book=" + encodeURIComponent(state.book) : "") + '">Write the first post</a></div>';
    }
    return head + '<ul class="sol-threads">' + state.list.map(threadCard).join("") + "</ul>" +
      (state.more ? '<button type="button" class="sol-btn wide" data-more>Show more</button>' : "");
  }

  async function viewBoard(inner, params) {
    state.book = params.get("book") || "";
    state.sort = params.get("sort") === "top" ? "top" : "latest";
    var key = state.book + "|" + state.sort;
    if (state.loadingKey !== key || !state.list.length) {
      state.loadingKey = key;
      inner.innerHTML = '<div class="sol-page-head"><h1>Discussion</h1></div><p class="sol-muted sol-pad">Loading…</p>';
      await fetchList(false);
      if (state.loadingKey !== key) return;
    }
    if (P.current() !== "discuss" || P.route().sub) return;
    inner.innerHTML = boardHtml();
  }

  /* ---------- new post ---------- */
  function viewNew(inner, params) {
    if (!A.user()) {
      inner.innerHTML = '<div class="sol-page-head"><a class="sol-back" href="#/discuss" aria-label="Back">' + ic("back") + "</a><h1>New post</h1></div>" +
        '<div class="sol-empty"><p>Log in to start a discussion.</p><button type="button" class="sol-btn primary" data-login>Log in</button></div>';
      return;
    }
    var pre = params.get("book") || "";
    var opts = '<option value="">General</option>' + (typeof books !== "undefined" ? books : []).map(function (b) {
      return '<option value="' + esc(b.id) + '"' + (String(b.id) === pre ? " selected" : "") + ">" + esc(b.title) + "</option>";
    }).join("");
    inner.innerHTML =
      '<div class="sol-page-head"><a class="sol-back" href="#/discuss" aria-label="Back">' + ic("back") + "</a><h1>New post</h1></div>" +
      '<form class="sol-form" data-new-form>' +
      '<label class="sol-label" for="dBook">About</label><select id="dBook" name="book" class="sol-input">' + opts + "</select>" +
      '<label class="sol-label" for="dTitle">Title</label><input id="dTitle" name="title" class="sol-input" maxlength="140" required placeholder="e.g. Who do you think betrayed Ivy?">' +
      '<label class="sol-label" for="dBody">Post <span class="sol-hint inline">(optional)</span></label>' +
      '<textarea id="dBody" name="body" class="sol-input" rows="6" maxlength="4000" placeholder="Share your theory, a favourite scene, a question…"></textarea>' +
      '<label class="sol-check"><input type="checkbox" name="spoiler"> Contains spoilers (hidden until tapped)</label>' +
      '<p class="sol-hint">Be kind. Posts that attack other readers are removed.</p>' +
      '<div class="sol-btn-row end"><a class="sol-btn" href="#/discuss">Cancel</a><button type="submit" class="sol-btn primary">Post</button></div>' +
      "</form>";
  }

  /* ---------- one post ---------- */
  async function viewThread(inner, id) {
    inner.innerHTML = '<div class="sol-page-head"><a class="sol-back" href="#/discuss" aria-label="Back">' + ic("back") + "</a><h1>Post</h1></div><p class=\"sol-muted sol-pad\">Loading…</p>";
    var res = await Promise.all([
      withCols(function () { return sb.from("discussion_threads").select(cols()).eq("id", id).maybeSingle(); }),
      withCols(function () { return sb.from("discussion_replies").select(replyCols()).eq("thread_id", id).order("created_at", { ascending: true }).limit(200); })
    ]);
    if (P.route().sub !== id) return;
    var t = res[0].data;
    if (res[0].error || !t) {
      inner.innerHTML = '<div class="sol-page-head"><a class="sol-back" href="#/discuss" aria-label="Back">' + ic("back") + "</a><h1>Post</h1></div>" +
        '<div class="sol-empty"><p>This post was removed or doesn’t exist.</p><a class="sol-btn" href="#/discuss">Back to Discussion</a></div>';
      return;
    }
    await loadLikes([t.id]);
    var replies = res[1].data || [];
    var liked = state.liked.has(t.id);
    var u = A.user();

    inner.innerHTML =
      '<div class="sol-page-head"><a class="sol-back" href="#/discuss' + (t.book_id ? "?book=" + encodeURIComponent(t.book_id) : "") + '" aria-label="Back">' + ic("back") + "</a><h1>Post</h1></div>" +
      '<article class="sol-post">' +
      '<div class="sol-thread-top">' + avatar(t.display_name, t.avatar_color) + "<strong>" + esc(t.display_name) + "</strong><time>" + A.timeAgo(t.created_at) + "</time>" +
      (t.pinned ? '<span class="sol-pin">' + ic("pin") + "Pinned</span>" : "") + "</div>" +
      (ahead(t, t.book_id)
        ? '<div class="sol-ahead" data-reveal tabindex="0" role="button" aria-label="Possible spoiler. Tap to show.">' +
          '<span class="sol-ahead-note">' + esc(aheadNote(t.reader_chapter)) + ". Tap to show.</span>" +
          '<span class="sol-ahead-text"><h2>' + esc(t.title) + "</h2>" + (t.body ? '<p class="sol-post-body">' + esc(t.body) + "</p>" : "") + "</span></div>"
        : "<h2>" + esc(t.title) + "</h2>" +
          (t.body ? '<p class="sol-post-body' + (t.is_spoiler ? " spoiler" : "") + '" ' + (t.is_spoiler ? 'data-reveal tabindex="0" role="button" aria-label="Spoiler. Tap to reveal."' : "") + ">" + esc(t.body) + "</p>" : "")) +
      '<div class="sol-thread-foot">' + (t.book_id ? '<a class="sol-dtag story" href="#/book/' + esc(slugFor(t.book_id)) + '">' + esc(bookTitle(t.book_id)) + "</a>" : bookTag(null)) +
      '<button type="button" class="sol-act' + (liked ? " on" : "") + '" data-like="' + esc(t.id) + '" aria-pressed="' + liked + '" aria-label="Like">' + ic("heart") + "<span>" + (t.like_count || 0) + "</span></button>" +
      (state.writer ? '<button type="button" class="sol-link" data-pin="' + esc(t.id) + '" data-pinned="' + t.pinned + '">' + (t.pinned ? "Unpin" : "Pin") + "</button>" : "") +
      (canDelete(t) ? '<button type="button" class="sol-link danger" data-del-thread="' + esc(t.id) + '">Delete</button>' : "") +
      "</div></article>" +
      '<h3 class="sol-replies-title">' + replies.length + (replies.length === 1 ? " reply" : " replies") + "</h3>" +
      '<ul class="sol-replies">' + replies.map(function (r) {
        return '<li class="sol-reply"><div class="sol-thread-top">' + avatar(r.display_name, r.avatar_color) +
          "<strong>" + esc(r.display_name) + "</strong><time>" + A.timeAgo(r.created_at) + "</time>" +
          (canDelete(r) ? '<button type="button" class="sol-link danger" data-del-reply="' + esc(r.id) + '">Delete</button>' : "") +
          "</div>" + (ahead(r, t.book_id)
            ? '<p class="sol-ahead" data-reveal tabindex="0" role="button" aria-label="Possible spoiler. Tap to show."><span class="sol-ahead-note">' + esc(aheadNote(r.reader_chapter)) + '. Tap to show.</span><span class="sol-ahead-text">' + esc(r.body) + "</span></p>"
            : "<p>" + esc(r.body) + "</p>") + "</li>";
      }).join("") + "</ul>" +
      (u
        ? '<form class="sol-reply-box" data-reply-form data-thread="' + esc(t.id) + '"><textarea name="body" rows="1" maxlength="2000" placeholder="Write a reply…" aria-label="Write a reply" required></textarea>' +
          '<button type="submit" class="sol-send" aria-label="Send reply">' + ic("send") + "</button></form>"
        : '<p class="sol-muted sol-pad"><button type="button" class="sol-link" data-login>Log in</button> to reply.</p>');
  }

  function bookTitle(id) { var b = A.bookById(id); return b ? b.title : "A story"; }
  function slugFor(id) {
    var b = A.bookById(id);
    return b && typeof bookSlug === "function" ? bookSlug(b) : "";
  }

  function render(el, sub, params) {
    var inner = el.querySelector(".sol-page-inner");
    if (sub === "new") viewNew(inner, params);
    else if (sub) viewThread(inner, sub);
    else viewBoard(inner, params || new URLSearchParams());
  }

  P.register("discuss", { title: "Discussion", render: render });
  var page = document.querySelector('.sol-page[data-page="discuss"]');

  /* ---------- actions ---------- */
  function toast(m) { if (typeof solToast === "function") solToast(m); }

  async function toggleLike(id, btn) {
    if (!A.requireLogin("Log in to like posts.")) return;
    btn.disabled = true;
    var r = await sb.rpc("toggle_thread_like", { p_thread_id: id });
    btn.disabled = false;
    if (r.error) return toast("Couldn’t save that. Try again.");
    var liked = !!r.data.liked;
    if (liked) state.liked.add(id); else state.liked.delete(id);
    btn.classList.toggle("on", liked);
    btn.setAttribute("aria-pressed", liked);
    btn.querySelector("span").textContent = r.data.like_count;
    var row = state.list.find(function (x) { return x.id === id; });
    if (row) row.like_count = r.data.like_count;
  }

  page.addEventListener("click", async function (e) {
    var t = e.target, el;
    if ((el = t.closest("[data-like]"))) {
      e.preventDefault();
      toggleLike(el.getAttribute("data-like"), el);
    } else if (t.closest("[data-more]")) {
      await fetchList(true);
      page.querySelector(".sol-page-inner").innerHTML = boardHtml();
    } else if (t.closest("[data-login]")) {
      if (typeof openModal === "function") openModal("loginModal");
    } else if ((el = t.closest("[data-reveal]"))) {
      el.classList.remove("spoiler", "sol-ahead");
      el.removeAttribute("data-reveal");
      el.removeAttribute("role");
    } else if ((el = t.closest(".sol-thread-body.spoiler"))) {
      e.preventDefault();
      el.classList.remove("spoiler");
    } else if ((el = t.closest("[data-del-thread]"))) {
      if (!confirm("Delete this post and its replies?")) return;
      var r = await sb.from("discussion_threads").delete().eq("id", el.getAttribute("data-del-thread"));
      if (r.error) return toast("Couldn’t delete it.");
      state.list = state.list.filter(function (x) { return x.id !== el.getAttribute("data-del-thread"); });
      toast("Post deleted.");
      P.go("discuss");
    } else if ((el = t.closest("[data-del-reply]"))) {
      if (!confirm("Delete this reply?")) return;
      var r2 = await sb.from("discussion_replies").delete().eq("id", el.getAttribute("data-del-reply"));
      if (r2.error) return toast("Couldn’t delete it.");
      state.loadingKey = "";
      P.refresh("discuss");
    } else if ((el = t.closest("[data-pin]"))) {
      var pinned = el.getAttribute("data-pinned") !== "true";
      var r3 = await sb.rpc("set_thread_pinned", { p_thread_id: el.getAttribute("data-pin"), p_pinned: pinned });
      if (r3.error) return toast("Couldn’t change that.");
      state.loadingKey = "";
      toast(pinned ? "Pinned to the top." : "Unpinned.");
      P.refresh("discuss");
    }
  });

  page.addEventListener("keydown", function (e) {
    var el = e.target.closest && e.target.closest("[data-reveal]");
    if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); el.click(); }
  });

  /* reply box grows with the text */
  page.addEventListener("input", function (e) {
    if (e.target.matches(".sol-reply-box textarea")) {
      e.target.style.height = "auto";
      e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
    }
  });

  page.addEventListener("submit", async function (e) {
    var form = e.target;
    e.preventDefault();
    var btn = form.querySelector('[type="submit"]');
    if (form.matches("[data-new-form]")) {
      var title = form.title.value.trim();
      if (title.length < 3) { toast("Give your post a title (3+ characters)."); form.title.focus(); return; }
      btn.disabled = true;
      var r = await sb.rpc("create_thread", {
        p_book_id: form.book.value || null,
        p_title: title,
        p_body: form.body.value,
        p_spoiler: form.spoiler.checked
      });
      btn.disabled = false;
      if (r.error) return toast(r.error.message || "Couldn’t post. Try again.");
      state.loadingKey = "";
      toast("Posted!");
      P.go("discuss/" + r.data.id);
    } else if (form.matches("[data-reply-form]")) {
      var body = form.body.value.trim();
      if (!body) return;
      btn.disabled = true;
      var r2 = await sb.rpc("add_reply", { p_thread_id: form.getAttribute("data-thread"), p_body: body });
      btn.disabled = false;
      if (r2.error) return toast(r2.error.message || "Couldn’t send. Try again.");
      state.loadingKey = "";
      await viewThread(page.querySelector(".sol-page-inner"), form.getAttribute("data-thread"));
      var last = page.querySelector(".sol-reply:last-child");
      if (last) last.scrollIntoView({ block: "center" });
    }
  });

  /* ---------- book page link ---------- */
  async function bookLink(book) {
    var host = document.getElementById("solDiscussLink");
    if (!host) {
      host = document.createElement("a");
      host.id = "solDiscussLink";
      host.className = "sol-discuss-link";
      var anchor = document.querySelector("#bookModal .book-features");
      if (!anchor) return;
      anchor.after(host);
    }
    host.href = "#/discuss?book=" + encodeURIComponent(book.id);
    host.innerHTML = ic("reply") + '<span><strong>Discussion</strong><small>Theories, favourite scenes, questions</small></span><em data-count></em>' +
      '<svg class="sol-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
    host.hidden = state.missing;
    var r = await sb.from("discussion_threads").select("id", { count: "exact", head: true }).eq("book_id", book.id);
    if (r.error) { if (A.isMissing(r.error)) { state.missing = true; host.hidden = true; } return; }
    host.hidden = false;
    var c = host.querySelector("[data-count]");
    if (c) c.textContent = r.count ? r.count + (r.count === 1 ? " post" : " posts") : "Start one";
  }

  if (typeof showBook === "function") {
    var origShow = showBook;
    window.showBook = async function (id) {
      var r = await origShow.apply(this, arguments);
      var b = A.bookById(id);
      if (b) bookLink(b);
      return r;
    };
  }

  A.on("auth", function () {
    state.liked = new Set();
    checkWriter().then(function () {
      state.loadingKey = "";
      if (P.current() === "discuss" && P.route().sub !== "new") P.refresh("discuss");
    });
  });
})();
