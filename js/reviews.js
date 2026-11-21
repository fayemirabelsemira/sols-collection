/* =========================================================
   RATINGS & REVIEWS (book page)
   - 1–5 stars + optional written review, one per reader per book
   - Readers can edit or delete their own; the book's writer can
     delete any review on their book
   Needs js/app-core.js and sql/03_app_features.sql.
========================================================= */
(function () {
  "use strict";
  var A = window.SolApp;
  var panel = document.getElementById("reviewsPanel");
  if (!A || !panel) return;
  var sb = A.sb, esc = A.esc;

  var PAGE = 6;
  var MAX = 2000;
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.6 2.9 6 6.5.8-4.8 4.5 1.3 6.5L12 17.2l-5.9 3.2 1.3-6.5L2.6 9.4l6.5-.8z"/></svg>';

  var state = { bookId: null, list: [], mine: null, more: false, picked: 0, editing: false, busy: false };

  function starRow(n) {
    var h = "";
    for (var i = 1; i <= 5; i++) h += '<span class="' + (i <= n ? "on" : "") + '">' + STAR + "</span>";
    return '<span class="sol-stars" aria-label="' + n + ' out of 5 stars">' + h + "</span>";
  }

  async function load(bookId) {
    state.bookId = bookId;
    state.list = []; state.mine = null; state.more = false; state.picked = 0; state.editing = false;
    panel.hidden = false;
    panel.querySelector(".sol-rev-body").innerHTML = '<p class="sol-muted">Loading reviews…</p>';
    paintSummary();

    var res = await sb.from("book_reviews")
      .select("id, user_id, display_name, rating, body, created_at, updated_at")
      .eq("book_id", bookId).order("created_at", { ascending: false }).range(0, PAGE);
    if (state.bookId !== bookId) return;
    if (res.error) {
      if (A.isMissing(res.error)) { panel.hidden = true; return; }
      panel.querySelector(".sol-rev-body").innerHTML = '<p class="sol-muted">Reviews couldn’t load right now.</p>';
      return;
    }
    state.list = (res.data || []).slice(0, PAGE);
    state.more = (res.data || []).length > PAGE;

    var u = A.user();
    if (u) {
      state.mine = state.list.find(function (r) { return r.user_id === u.id; }) || null;
      if (!state.mine) {
        var m = await sb.from("book_reviews").select("id, user_id, display_name, rating, body, created_at, updated_at")
          .eq("book_id", bookId).eq("user_id", u.id).maybeSingle();
        if (state.bookId !== bookId) return;
        if (!m.error) state.mine = m.data || null;
      }
    }
    state.picked = state.mine ? state.mine.rating : 0;
    paint();
  }

  async function loadMore() {
    var from = state.list.length;
    var res = await sb.from("book_reviews")
      .select("id, user_id, display_name, rating, body, created_at, updated_at")
      .eq("book_id", state.bookId).order("created_at", { ascending: false }).range(from, from + PAGE);
    if (res.error) return;
    var rows = res.data || [];
    state.list = state.list.concat(rows.slice(0, PAGE));
    state.more = rows.length > PAGE;
    paint();
  }

  function paintSummary() {
    var el = panel.querySelector(".sol-rev-summary");
    var r = A.rating(state.bookId);
    el.innerHTML = r && r.review_count
      ? '<strong>' + Number(r.avg_rating).toFixed(1) + "</strong>" + starRow(Math.round(r.avg_rating)) +
        "<span>" + r.review_count + (r.review_count === 1 ? " rating" : " ratings") + "</span>"
      : '<span class="sol-muted">No ratings yet</span>';
  }

  function canDelete(r) {
    var u = A.user();
    if (!u) return false;
    var book = A.bookById(state.bookId);
    return r.user_id === u.id || (book && book.owner_id === u.id);
  }

  function formHtml() {
    var u = A.user();
    if (!u) {
      return '<div class="sol-rev-form"><p class="sol-muted">Finished a few chapters? <button type="button" class="sol-link" data-rev-login>Log in</button> to rate this story.</p></div>';
    }
    if (state.mine && !state.editing) {
      return '<div class="sol-rev-form mine"><p class="sol-muted">Your rating ' + starRow(state.mine.rating) +
        ' <button type="button" class="sol-link" data-rev-edit>Edit</button></p></div>';
    }
    var pick = "";
    for (var i = 1; i <= 5; i++) {
      pick += '<button type="button" class="' + (i <= state.picked ? "on" : "") + '" data-rev-star="' + i +
        '" aria-label="' + i + (i === 1 ? " star" : " stars") + '" aria-pressed="' + (i === state.picked) + '">' + STAR + "</button>";
    }
    return '<form class="sol-rev-form" data-rev-form>' +
      '<div class="sol-star-pick" role="group" aria-label="Your rating">' + pick + "</div>" +
      '<textarea name="body" rows="3" maxlength="' + MAX + '" placeholder="What did you love? No spoilers, please.">' +
      esc(state.mine ? state.mine.body : "") + "</textarea>" +
      '<div class="sol-rev-actions">' +
      (state.mine ? '<button type="button" class="sol-link danger" data-rev-delete="' + esc(state.mine.id) + '">Delete</button>' : "<span></span>") +
      (state.mine ? '<button type="button" class="sol-link" data-rev-cancel>Cancel</button>' : "") +
      '<button type="submit" class="read-button" ' + (state.picked ? "" : "disabled") + ">" + (state.mine ? "Update" : "Post") + "</button>" +
      "</div></form>";
  }

  function itemHtml(r) {
    return '<li class="sol-rev">' +
      '<div class="sol-rev-head"><span class="sol-avatar sm">' + esc((r.display_name || "R").trim().charAt(0).toUpperCase()) + "</span>" +
      "<strong>" + esc(r.display_name || "Reader") + "</strong>" + starRow(r.rating) +
      '<time class="sol-muted">' + A.timeAgo(r.updated_at || r.created_at) + "</time>" +
      (canDelete(r) ? '<button type="button" class="sol-link danger" data-rev-delete="' + esc(r.id) + '">Delete</button>' : "") +
      "</div>" +
      (r.body ? '<p class="sol-rev-text">' + esc(r.body) + "</p>" : "") +
      "</li>";
  }

  function paint() {
    paintSummary();
    var others = state.list;
    panel.querySelector(".sol-rev-body").innerHTML = formHtml() +
      (others.length ? '<ul class="sol-rev-list">' + others.map(itemHtml).join("") + "</ul>" : "") +
      (state.more ? '<button type="button" class="bm-more" data-rev-more>More reviews</button>' : "");
  }

  async function submit(form) {
    if (state.busy || !state.picked) return;
    state.busy = true;
    var btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    var res = await sb.rpc("upsert_review", { p_book_id: state.bookId, p_rating: state.picked, p_body: form.body.value });
    state.busy = false;
    if (res.error) {
      btn.disabled = false;
      if (typeof solToast === "function") solToast(res.error.message || "Couldn’t save your review.");
      return;
    }
    if (typeof solToast === "function") solToast(state.mine ? "Review updated." : "Thanks for rating!");
    A.loadStats();
    load(state.bookId);
  }

  async function remove(id) {
    if (!confirm("Delete this review?")) return;
    var res = await sb.from("book_reviews").delete().eq("id", id);
    if (res.error) {
      if (typeof solToast === "function") solToast("Couldn’t delete it.");
      return;
    }
    A.loadStats();
    load(state.bookId);
  }

  panel.addEventListener("click", function (e) {
    var t = e.target, el;
    if ((el = t.closest("[data-rev-star]"))) {
      state.picked = Number(el.getAttribute("data-rev-star"));
      var form = panel.querySelector("[data-rev-form]");
      var text = form ? form.body.value : "";
      paint();
      var f2 = panel.querySelector("[data-rev-form]");
      if (f2) { f2.body.value = text; }
    } else if (t.closest("[data-rev-edit]")) {
      state.editing = true; paint();
    } else if (t.closest("[data-rev-cancel]")) {
      state.editing = false; state.picked = state.mine ? state.mine.rating : 0; paint();
    } else if ((el = t.closest("[data-rev-delete]"))) {
      remove(el.getAttribute("data-rev-delete"));
    } else if (t.closest("[data-rev-more]")) {
      loadMore();
    } else if (t.closest("[data-rev-login]")) {
      if (typeof closeModal === "function") closeModal("bookModal");
      if (typeof openModal === "function") openModal("loginModal");
    }
  });

  panel.addEventListener("submit", function (e) {
    var form = e.target.closest("[data-rev-form]");
    if (!form) return;
    e.preventDefault();
    submit(form);
  });

  if (typeof showBook === "function") {
    var origShow = showBook;
    window.showBook = async function (bookId) {
      var r = await origShow.apply(this, arguments);
      load(bookId);
      return r;
    };
  }

  A.on("stats", function () { if (state.bookId) paintSummary(); });
  A.on("auth", function () {
    var m = document.getElementById("bookModal");
    if (state.bookId && m && m.classList.contains("active")) load(state.bookId);
  });
})();
