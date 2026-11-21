/* =========================================================
   GENRES PAGE (#/genres and #/genres/<genre>)
   - The genre list is built from the books themselves
     ("reverse harem | fantasy" counts for both), with a count.
   - Tapping a genre opens that genre's own list of books.
   Needs js/app-core.js and js/pages.js.
========================================================= */
(function () {
  "use strict";
  var A = window.SolApp, P = window.SolPages;
  if (!A || !P) return;
  var esc = A.esc;

  var BACK = '<svg class="sol-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';

  function all() { return typeof books !== "undefined" && Array.isArray(books) ? books : []; }
  function slug(g) { return String(g).toLowerCase().trim().replace(/\s+/g, "-"); }
  function title(g) { return g.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function genresOf(b) {
    return String(b.genre || "").split(/[|,\/]/).map(function (g) { return g.trim(); }).filter(Boolean);
  }

  /* slug -> { name, books[] } */
  function index() {
    var map = {};
    all().forEach(function (b) {
      var seen = {};
      genresOf(b).forEach(function (g) {
        var k = slug(g);
        if (seen[k]) return;
        seen[k] = 1;
        if (!map[k]) map[k] = { slug: k, name: title(g), books: [] };
        map[k].books.push(b);
      });
    });
    return map;
  }

  function num(b, k) { return Number(b[k]) || 0; }

  function tile(b) {
    var s = A.stats(b.id);
    var total = s ? s.chapter_count : (b.total_chapters || 0);
    return '<li class="sol-tile">' +
      '<button type="button" class="sol-tile-open" data-genre-open="' + esc(b.id) + '">' +
      '<span class="sol-tile-cover lores-cover">' + A.coverHtml(b) + "</span>" +
      '<span class="sol-tile-title">' + esc(b.title) + "</span>" +
      '<span class="sol-tile-meta">' + esc(b.author || "Sol") + (total ? " · " + total + " ch" : "") + "</span>" +
      "</button></li>";
  }

  function render(el, sub) {
    var inner = el.querySelector(".sol-page-inner");
    var map = index();
    var loading = !all().length;
    var key = sub ? slug(decodeURIComponent(sub)) : "";

    if (!key) {
      var list = Object.keys(map).map(function (k) { return map[k]; })
        .sort(function (a, b) { return b.books.length - a.books.length || a.name.localeCompare(b.name); });
      inner.innerHTML =
        '<div class="sol-page-head"><h1>Genres</h1></div>' +
        '<p class="sol-muted sol-genres-sub">Find your next story.</p>' +
        (loading ? '<p class="sol-muted sol-pad">Loading…</p>'
          : '<div class="sol-genres">' + list.map(function (g) {
              return '<a class="sol-genre" href="#/genres/' + encodeURIComponent(g.slug) + '">' +
                '<span class="sol-genre-name">' + esc(g.name) + "</span>" +
                '<span class="sol-genre-count">' + g.books.length + (g.books.length === 1 ? " story" : " stories") + "</span></a>";
            }).join("") + "</div>");
      return;
    }

    var g = map[key];
    var name = g ? g.name : title(decodeURIComponent(sub).replace(/-/g, " "));
    var head = '<div class="sol-page-head"><a class="sol-back" href="#/genres" aria-label="All genres">' + BACK + "</a><h1>" + esc(name) + "</h1></div>";
    if (loading) { inner.innerHTML = head + '<p class="sol-muted sol-pad">Loading…</p>'; return; }
    if (!g) {
      inner.innerHTML = head + '<div class="sol-empty"><p>No stories in this genre yet.</p><a class="sol-btn" href="#/genres">All genres</a></div>';
      return;
    }
    var sorted = g.books.slice().sort(function (a, b) { return num(b, "views") - num(a, "views"); });
    inner.innerHTML = head +
      '<p class="sol-muted sol-genres-sub">' + sorted.length + (sorted.length === 1 ? " story" : " stories") + "</p>" +
      '<ul class="sol-tiles">' + sorted.map(tile).join("") + "</ul>";
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-genre-open]");
    if (!t || typeof showBook !== "function") return;
    showBook(t.getAttribute("data-genre-open"));
  });

  P.register("genres", { title: "Genres", render: render, live: true });
})();
