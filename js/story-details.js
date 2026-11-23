/* =========================================================
   STORY DETAILS + CONTENT WARNINGS
   - Cards: Ongoing / Completed tag, 18+ tag, star rating
   - Book page: status, chapters, reading time, last update,
     update schedule, language, content warnings
   - 18+ stories ask once per story before the first chapter opens
   Needs js/app-core.js and sql/03_app_features.sql.
========================================================= */
(function () {
  "use strict";
  var A = window.SolApp;
  if (!A) return;
  var esc = A.esc;

  var ACK_KEY = "solMatureOk.v1";

  function acked() {
    try { return JSON.parse(localStorage.getItem(ACK_KEY) || "[]"); } catch (e) { return []; }
  }
  function ack(id) {
    var list = acked();
    if (list.indexOf(String(id)) === -1) list.push(String(id));
    try { localStorage.setItem(ACK_KEY, JSON.stringify(list)); } catch (e) {}
  }

  function warnings(book) {
    return Array.isArray(book && book.content_warnings) ? book.content_warnings.filter(Boolean) : [];
  }

  function stars(avg) {
    return '<svg class="sol-star" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.6 2.9 6 6.5.8-4.8 4.5 1.3 6.5L12 17.2l-5.9 3.2 1.3-6.5L2.6 9.4l6.5-.8z"/></svg>' +
      Number(avg).toFixed(1);
  }

  /* ---------- cards ---------- */
  function decorateCards(list) {
    var grid = document.getElementById("booksGrid");
    if (!grid || !Array.isArray(list)) return;
    var cards = grid.querySelectorAll(":scope > .book-card");
    cards.forEach(function (card, i) {
      var book = list[i];
      if (!book) return;
      var cover = card.querySelector(".book-cover");
      var old = card.querySelector(".sol-cover-tags");
      if (old) old.remove();
      var tags = "";
      if (book.status === "completed") tags += '<span class="sol-tag done">Completed</span>';
      else if (book.status === "hiatus") tags += '<span class="sol-tag">On hiatus</span>';
      if (book.is_mature) tags += '<span class="sol-tag mature">18+</span>';
      if (tags && cover) cover.insertAdjacentHTML("afterbegin", '<div class="sol-cover-tags">' + tags + "</div>");

      var r = A.rating(book.id);
      var statsRow = card.querySelector(".book-stats");
      var oldR = card.querySelector(".sol-card-rating");
      if (oldR) oldR.remove();
      if (r && r.review_count && statsRow) {
        statsRow.insertAdjacentHTML("beforeend",
          '<span class="sol-card-rating" title="' + r.review_count + ' ratings">' + stars(r.avg_rating) + "</span>");
      }
      var s = A.stats(book.id);
      var count = card.querySelector(".chapter-count");
      if (s && count) count.textContent = s.chapter_count + (s.chapter_count === 1 ? " Chapter" : " Chapters");
    });
  }

  var lastList = null;
  if (typeof renderBooks === "function") {
    var origRender = renderBooks;
    window.renderBooks = function (list) {
      var r = origRender.apply(this, arguments);
      lastList = list || (typeof books !== "undefined" ? books : []);
      decorateCards(lastList);
      return r;
    };
  }
  A.on("stats", function () {
    if (lastList) decorateCards(lastList);
    if (typeof currentBook !== "undefined" && currentBook &&
        document.getElementById("bookModal").classList.contains("active")) renderDetails(currentBook);
  });

  /* ---------- book page ---------- */
  function renderDetails(book) {
    var host = document.getElementById("solDetails");
    if (!host) {
      host = document.createElement("div");
      host.id = "solDetails";
      host.className = "sol-details";
      var anchor = document.querySelector("#bookModal .book-synopsis");
      if (!anchor) return;
      anchor.parentNode.insertBefore(host, anchor);
    }
    var s = A.stats(book.id);
    var bits = [];
    var status = A.STATUS_LABEL[book.status];
    if (status) bits.push('<span class="sol-chip ' + (book.status === "completed" ? "done" : "") + '">' + status + "</span>");
    if (book.is_mature) bits.push('<span class="sol-chip mature">18+</span>');
    if (s) {
      bits.push('<span class="sol-chip plain">' + s.chapter_count + (s.chapter_count === 1 ? " chapter" : " chapters") + "</span>");
      if (s.last_updated) bits.push('<span class="sol-chip plain">Updated ' + A.timeAgo(s.last_updated) + "</span>");
    }
    if (book.language) bits.push('<span class="sol-chip plain">' + esc(book.language) + "</span>");

    var html = bits.length ? '<div class="sol-chips">' + bits.join("") + "</div>" : "";
    if (book.update_schedule && book.status !== "completed") {
      html += '<p class="sol-schedule"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>New chapters: ' + esc(book.update_schedule) + "</p>";
    }
    var w = warnings(book);
    if (w.length) {
      html += '<details class="sol-warnings"><summary>Content warnings (' + w.length + ")</summary><p>" +
        w.map(esc).join(" · ") + "</p></details>";
    }
    host.innerHTML = html;
    host.hidden = !html;
  }

  if (typeof showBook === "function") {
    var origShow = showBook;
    window.showBook = async function (bookId) {
      var r = await origShow.apply(this, arguments);
      var book = A.bookById(bookId);
      if (book) renderDetails(book);
      return r;
    };
  }

  /* ---------- 18+ check before the first chapter ---------- */
  var pending = null;
  var cancelPending = null;

  function askMature(book, go, cancel) {
    var modal = document.getElementById("matureModal");
    if (!modal) return go();
    pending = go;
    cancelPending = cancel;
    document.getElementById("matureTitle").textContent = book.title;
    var w = warnings(book);
    var list = document.getElementById("matureWarnings");
    list.innerHTML = w.length ? "<li>" + w.map(esc).join("</li><li>") + "</li>" : "";
    list.hidden = !w.length;
    if (typeof openModal === "function") openModal("matureModal");
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("#matureContinue")) {
      var go = pending;
      pending = cancelPending = null;
      if (typeof currentBook !== "undefined" && currentBook) ack(currentBook.id);
      if (typeof closeModal === "function") closeModal("matureModal");
      if (go) go();
    } else if (e.target.closest("#matureLeave")) {
      var cancel = cancelPending;
      pending = cancelPending = null;
      if (cancel) cancel();
      if (typeof closeModal === "function") closeModal("matureModal");
    }
  });

  if (typeof openReader === "function") {
    var origOpen = openReader;
    window.openReader = function (bookId) {
      var self = this, args = arguments;
      var book = A.bookById(bookId);
      if (book && (book.is_mature || warnings(book).length) && acked().indexOf(String(book.id)) === -1) {
        currentBook = book;
        return new Promise(function (resolve) {
          askMature(book, function () { resolve(origOpen.apply(self, args)); }, function () { resolve(); });
        });
      }
      return origOpen.apply(this, arguments);
    };
  }
})();
