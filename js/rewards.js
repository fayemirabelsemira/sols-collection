/* =========================================================
   CHAPTER REWARDS (sql/10_rewards_and_spoilers.sql)
   Readers earn a free paid chapter of a book by commenting on it
   and sharing it (default: 20 comments + 2 days of sharing = 1 chapter).
   - Paid-chapter window: progress, or "Unlock free with reward"
   - Book page: a one-line progress note
   - Share button: a finished share is counted (once a day)
   Everything stays hidden until the SQL is installed.
========================================================= */
(function () {
  "use strict";
  var sb = typeof supabaseClient !== "undefined" ? supabaseClient : null;
  if (!sb) return;

  var installed = true;               /* false once we learn the SQL isn't there */
  var cache = {};                     /* bookId -> { at, data } */

  function user() { return typeof currentUser !== "undefined" ? currentUser : null; }
  function toast(m, o) { if (window.solToast) window.solToast(m, o); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function missing(err) { return err && /function|schema cache|does not exist|42883|PGRST202/i.test((err.message || "") + " " + (err.code || "")); }
  function friendly(err) {
    var m = (err && err.message) || "";
    return m.replace(/^.*?ERROR:\s*/, "") || "Something went wrong. Please try again.";
  }
  function label(ch) {
    if (!ch) return "this chapter";
    return window.solChapterLabel ? window.solChapterLabel(ch) : "Chapter " + ch.chapter_number;
  }

  async function status(bookId, fresh) {
    if (!installed || !user() || !bookId) return null;
    var c = cache[bookId];
    if (!fresh && c && Date.now() - c.at < 20000) return c.data;
    var res = await sb.rpc("reward_status", { p_book_id: bookId });
    if (res.error) {
      if (missing(res.error)) installed = false; else console.warn("reward_status:", res.error);
      return null;
    }
    cache[bookId] = { at: Date.now(), data: res.data };
    return res.data;
  }

  function bar(n, of) {
    var pct = of ? Math.round(Math.min(1, n / of) * 100) : 100;
    return '<span class="rw-bar"><i style="width:' + pct + '%"></i></span>';
  }

  /* ---------- paid-chapter window ---------- */
  function rewardBox(chapter, st) {
    if (!user()) {
      return '<div class="rw-box"><p class="rw-title">Or unlock it free</p>' +
        '<p class="rw-text">Comment and share this story to earn free chapters.</p>' +
        '<button type="button" class="rw-btn ghost" data-rw-login>Log in to start</button></div>';
    }
    if (!st || st.enabled === false) return "";
    if (st.available > 0) {
      return '<div class="rw-box ready"><p class="rw-title">You earned ' + st.available + " free chapter" + (st.available === 1 ? "" : "s") + "</p>" +
        '<p class="rw-text">Use one to open ' + esc(label(chapter)) + " now.</p>" +
        '<button type="button" class="rw-btn" data-rw-claim="' + esc(chapter.id) + '">Unlock ' + esc(label(chapter)) + " free</button></div>";
    }
    return '<div class="rw-box"><p class="rw-title">Or unlock it free</p>' +
      '<p class="rw-text">Earn 1 free chapter with ' + st.comments_needed + " comments and " + st.shares_needed + " shares on this story.</p>" +
      '<div class="rw-row"><span>Comments</span>' + bar(st.next_comments, st.comments_needed) + "<b>" + st.next_comments + "/" + st.comments_needed + "</b></div>" +
      '<div class="rw-row"><span>Shares</span>' + bar(st.next_shares, st.shares_needed) + "<b>" + st.next_shares + "/" + st.shares_needed + "</b></div>" +
      '<p class="rw-note">Comments need ' + st.min_comment_chars + "+ characters; up to " + st.max_comments_per_day +
      " count per day. One share a day counts" + (st.shared_today ? " (today's is in)" : "") + ".</p></div>";
  }

  async function paintPaymentBox(chapter) {
    var box = document.querySelector("#paymentModal .payment-box");
    if (!box || !chapter) return;
    var old = box.querySelector(".rw-box");
    if (old) old.remove();
    if (!installed) return;
    var bookId = chapter.book_id || (typeof currentBook !== "undefined" && currentBook ? currentBook.id : null);
    var st = user() ? await status(bookId, true) : null;
    if (user() && !st) return;
    var html = rewardBox(chapter, st);
    if (!html) return;
    var holder = document.createElement("div");
    holder.innerHTML = html;
    var anchor = box.querySelector(".demo-warning");
    box.insertBefore(holder.firstElementChild, anchor ? anchor.nextSibling : null);
  }

  if (typeof window.showPaymentModal === "function") {
    var origShow = window.showPaymentModal;
    window.showPaymentModal = function (chapter) {
      var r = origShow.apply(this, arguments);
      paintPaymentBox(chapter);
      return r;
    };
  }

  async function claim(btn) {
    var id = btn.getAttribute("data-rw-claim");
    btn.disabled = true;
    btn.textContent = "Unlocking…";
    var res = await sb.rpc("claim_reward_chapter", { p_chapter_id: id });
    if (res.error) {
      btn.disabled = false;
      btn.textContent = "Try again";
      toast(friendly(res.error));
      return;
    }
    var chapters = typeof currentChapters !== "undefined" ? currentChapters : [];
    var idx = chapters.findIndex(function (c) { return String(c.id) === String(id); });
    var ch = chapters[idx];
    Object.keys(cache).forEach(function (k) { delete cache[k]; });
    if (typeof closeModal === "function") closeModal("paymentModal");
    toast((ch ? label(ch) : "Chapter") + " unlocked with your reward.");
    if (typeof refreshUnlockedState === "function") await refreshUnlockedState();
    if (idx >= 0 && typeof openChapter === "function") openChapter(idx);
    paintBookLine();
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-rw-claim],[data-rw-login],[data-rw-share]");
    if (!t) return;
    e.preventDefault();
    if (t.hasAttribute("data-rw-share")) {
      if (typeof shareCurrentBook === "function") shareCurrentBook();
      return;
    }
    if (t.hasAttribute("data-rw-login")) {
      if (typeof closeModal === "function") closeModal("paymentModal");
      if (typeof openModal === "function") openModal("loginModal");
      return;
    }
    claim(t);
  });

  /* ---------- book page: one line of progress ---------- */
  function bookHasPaid(book) {
    return book && !(Number(book.price) === 0 && book.price !== null);
  }

  async function paintBookLine() {
    var host = document.querySelector("#bookModal .book-features");
    var old = document.getElementById("rwBookLine");
    if (old) old.remove();
    var book = typeof currentBook !== "undefined" ? currentBook : null;
    if (!host || !book || !installed || !bookHasPaid(book)) return;
    var line = document.createElement("p");
    line.id = "rwBookLine";
    line.className = "rw-line";
    if (!user()) {
      line.innerHTML = "<b>Free chapters:</b> comment and share this story to earn them.";
    } else {
      var st = await status(book.id);
      if (!st || st.enabled === false || (typeof currentBook !== "undefined" && currentBook !== book)) return;
      line.innerHTML = st.available > 0
        ? "<b>" + st.available + " free chapter" + (st.available === 1 ? "" : "s") + " ready.</b> Tap a locked chapter to use " + (st.available === 1 ? "it" : "one") + "."
        : "<b>Next free chapter:</b> " + st.next_comments + "/" + st.comments_needed + " comments · " + st.next_shares + "/" + st.shares_needed + " shares";
    }
    if (user()) {
      var s2 = cache[book.id] && cache[book.id].data;
      if (s2 && s2.enabled !== false && s2.shares_needed > 0) {
        var done = !!s2.shared_today;
        line.innerHTML += '<br><button type="button" class="rw-btn rw-streak" data-rw-share' + (done ? " disabled" : "") + ">" +
          (done ? "Today's share is in · " : "Share today · ") + "streak " + s2.next_shares + "/" + s2.shares_needed + " days</button>";
      }
    }
    host.insertAdjacentElement("afterend", line);
  }

  if (typeof window.showBook === "function") {
    var origBook = window.showBook;
    window.showBook = async function () {
      var r = await origBook.apply(this, arguments);
      paintBookLine();
      return r;
    };
  }

  /* ---------- shares ---------- */
  document.addEventListener("sol:shared", async function (e) {
    var bookId = e.detail && e.detail.bookId;
    if (!installed || !user() || !bookId) return;
    var book = typeof currentBook !== "undefined" ? currentBook : null;
    if (book && !bookHasPaid(book)) return;
    var before = await status(bookId);
    var res = await sb.rpc("record_share", { p_book_id: bookId });
    if (res.error) {
      if (missing(res.error)) installed = false;
      return;
    }
    cache[bookId] = { at: Date.now(), data: res.data };
    var st = res.data || {};
    if (before && before.shared_today) {
      toast("Thanks for sharing! Today's share already counted toward a free chapter.");
    } else if (st.available > (before ? before.available : 0)) {
      toast("You earned a free chapter! Open a locked chapter to use it.", { duration: 5000 });
    } else {
      toast("Share counted: " + st.next_shares + "/" + st.shares_needed + " toward your next free chapter.");
    }
    paintBookLine();
  });

  /* comments change the count: refresh on the next look */
  document.addEventListener("sol:commented", function (e) {
    var id = e.detail && e.detail.bookId;
    if (id) delete cache[id];
  });

  window.SolRewards = { status: status };
})();
