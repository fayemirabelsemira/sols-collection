/* =========================================================
   SEARCH PAGE (#/search)
   Type to search titles, authors, genres and descriptions.
   Empty box: recent searches, genres and most-read stories.
   Needs js/app-core.js + js/pages.js.
========================================================= */
(function () {
  "use strict";
  var A = window.SolApp, P = window.SolPages;
  if (!A || !P) return;
  var esc = A.esc;

  var RECENT_KEY = "solRecentSearches.v1";
  var GENRES = ["Romance", "Dark Romance", "Revenge", "Drama", "Fantasy", "Mystery", "Reverse Harem"];
  var query = "";
  var genre = "";

  function recent() {
    try { var v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function remember(q) {
    q = q.trim();
    if (q.length < 2) return;
    var list = recent().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); });
    list.unshift(q);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6))); } catch (e) {}
  }

  /* genres that actually exist in the catalog ("reverse harem | fantasy" -> two) */
  function genreList() {
    var seen = {}, out = [];
    all().forEach(function (b) {
      String(b.genre || "").split(/[|,\/]/).forEach(function (g) {
        g = g.trim();
        if (!g) return;
        var k = g.toLowerCase();
        if (seen[k]) return;
        seen[k] = 1;
        out.push(g.replace(/\b\w/g, function (c) { return c.toUpperCase(); }));
      });
    });
    return out.length ? out.sort() : GENRES;
  }

  function all() { return typeof books !== "undefined" ? books : []; }

  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function results() {
    var q = norm(query).trim();
    var g = norm(genre);
    return all().map(function (b) {
      var title = norm(b.title), hay = norm([b.author, b.genre, b.description, b.language].join(" "));
      if (g && norm(b.genre).indexOf(g) === -1) return null;
      if (!q) return { b: b, score: 1 };
      var words = q.split(/\s+/);
      var score = 0;
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (title.indexOf(w) !== -1) score += title.indexOf(w) === 0 ? 6 : 4;
        else if (hay.indexOf(w) !== -1) score += 1;
        else return null;
      }
      return { b: b, score: score };
    }).filter(Boolean).sort(function (x, y) {
      return y.score - x.score || (Number(y.b.views) || 0) - (Number(x.b.views) || 0);
    }).map(function (x) { return x.b; });
  }

  function rowHtml(b) {
    var s = A.stats(b.id), r = A.rating(b.id);
    var bits = [];
    if (A.STATUS_LABEL[b.status]) bits.push(A.STATUS_LABEL[b.status]);
    if (s) bits.push(s.chapter_count + " ch");
    if (r && r.review_count) bits.push("★ " + Number(r.avg_rating).toFixed(1));
    if (b.is_mature) bits.push("18+");
    return '<li><button type="button" class="sol-result" data-search-open="' + esc(b.id) + '">' +
      '<span class="sol-thumb lores-cover">' + A.coverHtml(b) + "</span>" +
      '<span class="sol-list-text"><strong>' + esc(b.title) + "</strong>" +
      "<small>" + esc(b.genre || "Romance") + "</small>" +
      (bits.length ? '<small class="sol-result-meta">' + esc(bits.join(" · ")) + "</small>" : "") +
      "</span></button></li>";
  }

  function paintResults(inner) {
    var box = inner.querySelector("[data-search-results]");
    if (!box) return;
    var q = query.trim();
    if (!q && !genre) {
      var rec = recent();
      var top = all().slice().sort(function (a, b) { return (Number(b.views) || 0) - (Number(a.views) || 0); }).slice(0, 5);
      box.innerHTML =
        (rec.length ? '<div class="sol-search-sec"><div class="sol-sec-head"><h2>Recent</h2><button type="button" class="sol-link" data-search-clear>Clear</button></div>' +
          '<div class="sol-chip-row">' + rec.map(function (x) { return '<button type="button" class="sol-pill" data-search-term="' + esc(x) + '">' + esc(x) + "</button>"; }).join("") + "</div></div>" : "") +
        (top.length ? '<div class="sol-search-sec"><div class="sol-sec-head"><h2>Most read</h2></div><ol class="sol-results ranked">' + top.map(rowHtml).join("") + "</ol></div>" : "");
      return;
    }
    var list = results();
    box.innerHTML = list.length
      ? '<p class="sol-hint">' + list.length + (list.length === 1 ? " story" : " stories") + "</p><ul class=\"sol-results\">" + list.map(rowHtml).join("") + "</ul>"
      : '<div class="sol-empty"><p>No stories match “' + esc(q || genre) + '”. Try a different word.</p></div>';
  }

  function render(el, sub, params) {
    var inner = el.querySelector(".sol-page-inner");
    if (params && params.get("genre")) genre = params.get("genre");
    var chips = genreList().map(function (g) {
      return '<button type="button" class="sol-pill' + (g === genre ? " on" : "") + '" data-search-genre="' + esc(g) + '" aria-pressed="' + (g === genre) + '">' + esc(g) + "</button>";
    }).join("");
    var existing = inner.querySelector("[data-search-input]");
    if (!existing) {
      inner.innerHTML =
        '<div class="sol-page-head"><h1>Search</h1></div>' +
        '<form class="sol-search" role="search" data-search-form>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
        '<input type="search" data-search-input placeholder="Titles, genres, authors…" aria-label="Search stories" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false">' +
        "</form>" +
        '<div class="sol-chip-row scroll" data-search-genres></div>' +
        '<div data-search-results></div>';
      var input = inner.querySelector("[data-search-input]");
      input.value = query;
      /* phones: open the keyboard right away when the tab is tapped */
      setTimeout(function () { if (P.current() === "search" && !query) input.focus({ preventScroll: true }); }, 60);
    }
    inner.querySelector("[data-search-genres]").innerHTML = chips;
    paintResults(inner);
  }

  P.register("search", { title: "Search", render: render, live: true });
  var page = document.querySelector('.sol-page[data-page="search"]');
  var inner = page.querySelector(".sol-page-inner");

  var timer;
  page.addEventListener("input", function (e) {
    if (!e.target.matches("[data-search-input]")) return;
    query = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(function () { paintResults(inner); }, 120);
  });
  page.addEventListener("submit", function (e) {
    if (!e.target.closest("[data-search-form]")) return;
    e.preventDefault();
    remember(query);
    var input = inner.querySelector("[data-search-input]");
    if (input) input.blur();
  });
  page.addEventListener("click", function (e) {
    var t = e.target, el;
    if ((el = t.closest("[data-search-open]"))) {
      if (query.trim()) remember(query);
      showBook(el.getAttribute("data-search-open"));
    } else if ((el = t.closest("[data-search-genre]"))) {
      var g = el.getAttribute("data-search-genre");
      genre = genre === g ? "" : g;
      render(page);
    } else if ((el = t.closest("[data-search-term]"))) {
      query = el.getAttribute("data-search-term");
      inner.querySelector("[data-search-input]").value = query;
      paintResults(inner);
    } else if (t.closest("[data-search-clear]")) {
      try { localStorage.removeItem(RECENT_KEY); } catch (e2) {}
      paintResults(inner);
    }
  });

  /* the search box on the phone home page jumps here */
  var homeSearch = document.getElementById("bookSearch");
  if (homeSearch) {
    homeSearch.addEventListener("focus", function () {
      if (!window.matchMedia("(max-width:700px)").matches) return;
      query = homeSearch.value || "";
      homeSearch.blur();
      P.go("search");
    });
  }
})();
