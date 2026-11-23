/* =========================================================
   READER EXTRAS
   1. Character codex   - tap a character's name for a spoiler-safe card
   2. "Previously on…"  - recap when a reader comes back after a break
   3. Popular highlights + "Most saved lines" board + quote cards
   Needs: window.SolReader (script.js), js/bookmarks.js (loaded before this),
   and the SQL in supabase/reader-extras.sql.
========================================================= */
(function () {
    "use strict";

    /* ---------- settings you can tweak ---------- */
    var RECAP_AFTER_DAYS = 3;       // show "Previously on…" after this many days away
    var RECAP_SHOW = 3;             // how many previous chapters the recap covers
    var POPULAR_MIN_READERS = 3;    // underline a passage once this many readers saved it
    var BOARD_SIZE = 5;             // lines shown in "Most saved lines"
    var BOARD_MIN_SAVES = 2;        // a line needs this many saves to make the board

    var REACH_KEY = "solReached.v1";
    var LAST_KEY = "solLastRead.v1";
    var DONE_KEY = "solChapterDone.v1";

    var content = document.getElementById("storyContent");
    var section = document.getElementById("readerSection");
    var canHighlight = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";

    /* ---------- small helpers ---------- */

    function rs() { return window.SolReader ? window.SolReader.state() : { book: null, chapter: null }; }
    function db() { return window.SolReader && window.SolReader.db ? window.SolReader.db() : null; }
    function same(a, b) { return String(a) === String(b); }
    function norm(t) { return (t || "").replace(/\s+/g, " ").trim(); }
    function clip(t, n) {
        t = norm(t);
        return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + "\u2026" : t;
    }
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }
    function icon(paths, size) {
        var s = size || 18;
        return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
    }
    var I = {
        tree: '<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
        history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
        close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
        back: '<path d="m15 18-6-6 6-6"/>',
        chev: '<path d="m9 18 6-6-6-6"/>',
        lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
        share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
        mark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
        spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4"/><path d="M21 5h-4"/>'
    };

    function rpc(name, args) {
        var client = db();
        if (!client) return Promise.resolve(null);
        return Promise.resolve(client.rpc(name, args)).then(function (res) {
            if (res && res.error) { try { console.warn(name + " failed:", res.error); } catch (e) {} return null; }
            return res ? res.data : null;
        }, function (err) {
            try { console.warn(name + " failed:", err); } catch (e) {}
            return null;
        });
    }

    function readJSON(key) {
        try { var v = JSON.parse(localStorage.getItem(key) || "{}"); return v && typeof v === "object" ? v : {}; }
        catch (e) { return {}; }
    }
    function writeJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

    /* ---------- toast ---------- */
    var toastEl, toastTimer;
    function toast(msg) {
        if (!toastEl) {
            toastEl = el("div", "bm-toast");
            toastEl.setAttribute("role", "status");
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = msg;
        toastEl.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 3200);
    }

    /* ---------- chapter text <-> DOM ranges (no DOM changes: uses the CSS Highlight API) ---------- */

    var idx = { nodes: [], full: "" };

    function indexText() {
        idx.nodes = [];
        var pos = 0, n, w = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null);
        while ((n = w.nextNode())) {
            idx.nodes.push({ node: n, s: pos, e: pos + n.nodeValue.length });
            pos += n.nodeValue.length;
        }
        idx.full = content.textContent;
    }

    function locate(off, atEnd) {
        var a = idx.nodes;
        if (!a.length) return null;
        var lo = 0, hi = a.length;
        while (lo < hi) {
            var mid = (lo + hi) >> 1;
            var ok = atEnd ? a[mid].e >= off : a[mid].e > off;
            if (ok) hi = mid; else lo = mid + 1;
        }
        if (lo >= a.length) lo = a.length - 1;
        var it = a[lo];
        return { node: it.node, offset: Math.max(0, Math.min(it.node.nodeValue.length, off - it.s)) };
    }

    function rangeFor(s, e) {
        var a = locate(s, false), b = locate(e, true);
        if (!a || !b) return null;
        var r = document.createRange();
        try { r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset); } catch (err) { return null; }
        return r;
    }

    function caretAt(x, y) {
        if (document.caretPositionFromPoint) {
            var p = document.caretPositionFromPoint(x, y);
            return p ? { node: p.offsetNode, offset: p.offset } : null;
        }
        if (document.caretRangeFromPoint) {
            var r = document.caretRangeFromPoint(x, y);
            return r ? { node: r.startContainer, offset: r.startOffset } : null;
        }
        return null;
    }

    function offsetAtPoint(x, y) {
        var c = caretAt(x, y);
        if (!c || !c.node || !content.contains(c.node)) return null;
        var pre = document.createRange();
        pre.selectNodeContents(content);
        try { pre.setEnd(c.node, c.offset); } catch (e) { return null; }
        return pre.toString().length;
    }

    function hitList(list, x, y) {
        if (!list.length) return null;
        var off = offsetAtPoint(x, y);
        if (off == null) return null;
        for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (off < m.s - 1 || off > m.e + 1) continue;
            var r = rangeFor(m.s, m.e);
            if (!r) continue;
            var rects = r.getClientRects();
            for (var k = 0; k < rects.length; k++) {
                var q = rects[k];
                if (x >= q.left - 2 && x <= q.right + 2 && y >= q.top - 2 && y <= q.bottom + 2) return m;
            }
        }
        return null;
    }

    function paint(name, list) {
        if (!canHighlight) return;
        try {
            if (!list.length) { CSS.highlights.delete(name); return; }
            var ranges = [];
            list.forEach(function (m) { var r = rangeFor(m.s, m.e); if (r) ranges.push(r); });
            CSS.highlights.set(name, makeHighlight(ranges));
        } catch (e) {}
    }
    function makeHighlight(ranges) {
        var h = new Highlight();
        ranges.forEach(function (r) { h.add(r); });
        return h;
    }

    /* =========================================================
       1. CHARACTER CODEX
    ========================================================= */

    var cast = [];                 // characters unlocked so far (server-filtered)
    var castKey = "";
    var nameMatches = [];          // [{s, e, ch}]
    var nameRegex = null;
    var castToken = 0;

    function reachedFor(bid) { return Number(readJSON(REACH_KEY)[bid]) || 0; }
    function setReached(bid, n) {
        var all = readJSON(REACH_KEY);
        if ((Number(all[bid]) || 0) < n) { all[bid] = n; writeJSON(REACH_KEY, all); }
    }
    /* chapters this reader has read to the end (per book): the cast only
       ever shows what the story has revealed up to the scene on screen */
    function doneFor(bid) { return Number(readJSON(DONE_KEY)[bid]) || 0; }
    function setDone(bid, n) {
        var all = readJSON(DONE_KEY);
        if ((Number(all[bid]) || 0) >= n) return false;
        all[bid] = n;
        writeJSON(DONE_KEY, all);
        return true;
    }
    /* spoiler line = the chapter on screen, not the furthest one ever opened.
       The current chapter's secrets unlock only once its last lines are read. */
    function upTo() {
        var st = rs();
        if (!st.book || !st.chapter) return 0;
        var n = Number(st.chapter.chapter_number) || 1;
        return doneFor(String(st.book.id)) >= n ? n : n - 1;
    }

    function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

    function buildNameIndex() {
        nameMatches = [];
        nameRegex = null;
        var map = {}, names = [];
        cast.forEach(function (ch) {
            [ch.name].concat(ch.aliases || []).forEach(function (n) {
                n = (n || "").trim();
                if (n.length < 2 || map[n]) return;
                map[n] = ch;
                names.push(n);
            });
        });
        if (!names.length) return;
        names.sort(function (a, b) { return b.length - a.length; });
        try {
            nameRegex = new RegExp("(?<![\\p{L}\\p{N}_])(?:" + names.map(escapeRe).join("|") + ")(?![\\p{L}\\p{N}_])", "gu");
        } catch (e) { return; }
        var m;
        while ((m = nameRegex.exec(idx.full))) {
            nameMatches.push({ s: m.index, e: m.index + m[0].length, ch: map[m[0]] });
            if (m[0].length === 0) nameRegex.lastIndex++;
        }
    }

    function loadCast(done) {
        var st = rs();
        if (!st.book || !st.chapter) return;
        var bid = String(st.book.id), n = upTo();
        var key = bid + ":" + n;
        if (key === castKey) { done(); return; }
        var token = ++castToken;
        rpc("get_codex", { p_book_id: bid, p_up_to: n }).then(function (data) {
            if (token !== castToken) return;
            cast = Array.isArray(data) ? data : [];
            castKey = key;
            done();
        });
    }

    function paintNames() {
        buildNameIndex();
        paint("cx-names", nameMatches);
    }

    /* ----- the sheet ----- */

    var layer, sheetBody, backBtn, sheetState = { view: "cast", id: null };

    function ensureSheet() {
        if (layer) return;
        layer = el("div", "cx-layer");
        layer.innerHTML =
            '<div class="cx-backdrop"></div>' +
            '<section class="cx-sheet" role="dialog" aria-modal="true" aria-label="Characters">' +
            '<div class="cx-grip"></div>' +
            '<button class="cx-back" type="button" aria-label="Back to family tree">' + icon(I.back, 18) + "</button>" +
            '<button class="cx-close" type="button" aria-label="Close">' + icon(I.close, 18) + "</button>" +
            '<div class="cx-body"></div></section>';
        document.body.appendChild(layer);
        sheetBody = layer.querySelector(".cx-body");
        backBtn = layer.querySelector(".cx-back");
        layer.querySelector(".cx-backdrop").addEventListener("click", closeSheet);
        layer.querySelector(".cx-close").addEventListener("click", closeSheet);
        backBtn.addEventListener("click", function () { renderFamily(); });
        sheetBody.addEventListener("scroll", function () {
            layer.querySelector(".cx-sheet").classList.toggle("scrolled", sheetBody.scrollTop > 60);
        }, { passive: true });
    }

    function openSheet() {
        ensureSheet();
        void layer.offsetWidth;
        layer.classList.add("open");
        document.body.classList.add("cx-lock");
    }
    function closeSheet() {
        if (!layer) return;
        layer.classList.remove("open");
        document.body.classList.remove("cx-lock");
    }

    function validColor(c) { return /^#[0-9a-f]{3,8}$/i.test(c || "") ? c : "#d4af37"; }

    function monoOf(ch) { return (ch.name || "?").trim().charAt(0).toUpperCase(); }

    /* paints a big monogram in the character's colour, then swaps in the photo if there is one */
    function paintArt(wrap, ch) {
        wrap.style.setProperty("--accent", validColor(ch.accent));
        wrap.appendChild(el("span", "cx-mono", monoOf(ch)));
        if (ch.portrait) {
            var img = new Image();
            img.alt = "";
            img.decoding = "async";
            img.onload = function () { wrap.classList.add("has-photo"); wrap.appendChild(img); };
            img.src = ch.portrait;
        }
        return wrap;
    }

    function portrait(ch, size) { return paintArt(el("div", "cx-portrait cx-" + size), ch); }

    function byId(id) {
        for (var i = 0; i < cast.length; i++) if (same(cast[i].id, id)) return cast[i];
        return null;
    }

    function throughLine() {
        var p = el("p", "cx-through");
        p.innerHTML = icon(I.lock, 13);
        var n = upTo();
        p.appendChild(document.createTextNode(n > 0
            ? " Spoiler-safe through Chapter " + n + ". Finish a chapter to unlock what it reveals."
            : " Spoiler-safe. Finish this chapter to start meeting the characters."));
        return p;
    }

    function setSheetAccent(color) {
        if (layer) layer.querySelector(".cx-sheet").style.setProperty("--sheet-accent", color);
    }

    function castTile(ch, i) {
        var b = el("button", "cx-tile");
        b.type = "button";
        b.style.setProperty("--accent", validColor(ch.accent));
        b.style.setProperty("--i", Math.min(i, 12));
        b.appendChild(paintArt(el("div", "cx-art"), ch));
        b.appendChild(el("span", "cx-tile-no", (i < 9 ? "0" : "") + (i + 1)));
        var cap = el("span", "cx-tile-cap");
        cap.appendChild(el("span", "cx-tile-name", ch.name));
        if (ch.title) cap.appendChild(el("span", "cx-tile-sub", ch.title));
        b.appendChild(cap);
        b.addEventListener("click", function () { renderCard(ch, true); });
        return b;
    }

    function renderCast() {
        ensureSheet();
        sheetState = { view: "cast", id: null };
        backBtn.classList.remove("show");
        setSheetAccent("#ff6a4d");
        sheetBody.innerHTML = "";
        var top = el("header", "cx-top");
        top.appendChild(el("p", "cx-eyebrow", "THE CAST"));
        top.appendChild(el("h2", "cx-title", "Characters"));
        if (cast.length) top.appendChild(el("p", "cx-count", cast.length + (cast.length === 1 ? " character" : " characters") + " you\u2019ve met so far"));
        sheetBody.appendChild(top);
        if (!cast.length) {
            sheetBody.appendChild(el("p", "cx-empty", upTo() > 0
                ? "Character profiles for this book are coming soon."
                : "No characters yet — they appear here as the story introduces them."));
        } else {
            var grid = el("div", "cx-grid");
            cast.forEach(function (ch, i) { grid.appendChild(castTile(ch, i)); });
            sheetBody.appendChild(grid);
        }
        sheetBody.appendChild(throughLine());
        sheetBody.scrollTop = 0;
    }

    function byName(name) {
        for (var i = 0; i < cast.length; i++) if (cast[i].name === name) return cast[i];
        return null;
    }
    /* family tree chart: houses are boxes (parents row over children row), solid
       arrows = parent -> child, dashed labelled lines = links between people.
       To keep lines short, each house is placed under the people it links to.
       Tap a person to light up only their lines; drag or scroll to move; -/+ to zoom. */
    var FT = { w: 150, h: 54, gap: 12, pad: 14, title: 30, rowGap: 46, houseGap: 40, rowSpace: 70, maxW: 1100 };
    function drawFamily(rows) {
        var NS = "http://www.w3.org/2000/svg";
        var houses = [], byHouse = {}, nodes = [];
        function house(key, name) {
            if (!byHouse[key]) { byHouse[key] = { name: name || key, gens: [[], []] }; houses.push(byHouse[key]); }
            return byHouse[key];
        }
        function addNode(name, note, houseKey, gen, houseName) {
            var n = { name: name, note: note, house: houseKey, i: nodes.length };
            house(houseKey, houseName).gens[gen].push(n);
            nodes.push(n);
            return n;
        }
        function find(name, houseKey) {
            for (var i = 0; i < nodes.length; i++)
                if (nodes[i].name === name && (!houseKey || nodes[i].house === houseKey)) return nodes[i];
            return null;
        }
        rows.forEach(function (r) { if (r.kind === "member") addNode(r.name, r.note, r.house, r.gen ? 1 : 0); });
        var links = rows.filter(function (r) { return r.kind !== "member"; });
        // someone in a link who sits in no house gets a small box of their own, placed near who they link to
        links.forEach(function (r) {
            [r.name, r.related].forEach(function (nm) {
                if (nm && !find(nm)) addNode(nm, null, "solo:" + nm, 1, "Unknown bloodline");
            });
        });
        houses.forEach(function (h) {
            var cols = Math.max(h.gens[0].length, h.gens[1].length, 1);
            h.w = cols * (FT.w + FT.gap) - FT.gap + FT.pad * 2;
            var used = h.gens.filter(function (g) { return g.length; }).length;
            h.h = FT.title + used * FT.h + (used - 1) * FT.rowGap + FT.pad;
            h.members = h.gens[0].concat(h.gens[1]);
        });
        function placeNodes(h) {
            var ry = h.y + FT.title;
            h.gens.forEach(function (g) {
                if (!g.length) return;
                var rowW = g.length * (FT.w + FT.gap) - FT.gap, sx = h.x + (h.w - rowW) / 2;
                g.forEach(function (n, k) { n.x = sx + k * (FT.w + FT.gap); n.y = ry; });
                ry += FT.h + FT.rowGap;
            });
        }
        // where a house would like to sit: under the middle of the placed people it links to
        // (anyPlace: count links to people not placed yet too, to tell "linked" houses apart)
        function wish(h, anyPlace) {
            var xs = [];
            links.forEach(function (r) {
                var a = find(r.name, r.kind === "tie" ? r.house : null) || find(r.name), b = find(r.related);
                if (!a || !b) return;
                if (a.house === h.key && (anyPlace || b.x != null) && b.house !== h.key) xs.push(b.x + FT.w / 2);
                if (b.house === h.key && (anyPlace || a.x != null) && a.house !== h.key) xs.push(a.x + FT.w / 2);
            });
            return xs.length ? xs.reduce(function (s, v) { return s + v; }, 0) / xs.length : null;
        }
        Object.keys(byHouse).forEach(function (k) { byHouse[k].key = k; });
        var left = houses.slice(), y = 0, W = 0;
        var maxW = Math.max(FT.maxW, Math.max.apply(null, houses.map(function (h) { return h.w; })));
        while (left.length) {
            // next row: houses linked to what is already placed, ordered left to right by where they want to be
            var cand = left.map(function (h) { return { h: h, x: wish(h) }; }).filter(function (c) { return c.x != null; });
            if (!cand.length) cand = [{ h: left[0], x: 0 }];
            cand.sort(function (a, b) { return a.x - b.x; });
            var cursor = 0, rowH = 0, placed = [];
            cand.forEach(function (c) {
                var x = Math.max(cursor, Math.min(c.x - c.h.w / 2, maxW - c.h.w));
                if (x + c.h.w > maxW + 1) return;
                c.h.x = x; c.h.y = y; placeNodes(c.h);
                cursor = x + c.h.w + FT.houseGap; rowH = Math.max(rowH, c.h.h); W = Math.max(W, x + c.h.w);
                placed.push(c.h);
            });
            // fill the rest of the row only with houses linked to nothing placed;
            // a linked house waits for the next row so its lines run straight down
            left.forEach(function (h) {
                if (h.x != null || wish(h, true) != null || cursor + h.w > maxW) return;
                h.x = cursor; h.y = y; placeNodes(h);
                cursor += h.w + FT.houseGap; rowH = Math.max(rowH, h.h); W = Math.max(W, h.x + h.w);
                placed.push(h);
            });
            left = left.filter(function (h) { return placed.indexOf(h) < 0; });
            y += rowH + FT.rowSpace;
        }
        var H = y - FT.rowSpace + 8;

        var stage = el("div", "ft-stage");
        stage.style.width = W + "px";
        stage.style.height = H + "px";
        var svg = document.createElementNS(NS, "svg");
        svg.setAttribute("width", W); svg.setAttribute("height", H);
        svg.setAttribute("class", "ft-lines");
        svg.setAttribute("aria-hidden", "true");
        svg.innerHTML = '<defs><marker id="ftArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#8a8478"/></marker></defs>';
        stage.appendChild(svg);
        var lineEls = [];   // {el, a, b} so a selected person can light up their own lines
        function path(d, cls, a, b) {
            var p = document.createElementNS(NS, "path");
            p.setAttribute("d", d); p.setAttribute("class", cls);
            svg.appendChild(p);
            lineEls.push({ el: p, a: a, b: b });
        }
        var pills = [];
        function pill(text, px, py, a, b) {
            houses.forEach(function (h) {   // keep labels off house titles: lift into the gap above
                if (px > h.x - 40 && px < h.x + h.w + 40 && py > h.y - 12 && py < h.y + FT.title + 4) py = h.y - 18;
            });
            for (var k = 0; k < pills.length; k++)   // don't stack labels on each other
                if (Math.abs(pills[k].x - px) < 90 && Math.abs(pills[k].y - py) < 22) { py = pills[k].y + 24; k = -1; }
            var t = el("span", "ft-pill", text);
            t.style.left = px + "px"; t.style.top = py + "px";
            pills.push({ x: px, y: py, el: t });
            lineEls.push({ el: t, a: a, b: b });
        }
        houses.forEach(function (h) {
            var box = el("div", "ft-house");
            box.style.cssText = "left:" + h.x + "px;top:" + h.y + "px;width:" + h.w + "px;height:" + h.h + "px";
            box.appendChild(el("span", "ft-house-name", h.name));
            stage.appendChild(box);
        });
        var parentIdx = {};
        links.forEach(function (r) {
            if (r.kind === "parent") {
                var p = find(r.name, r.house), c = find(r.related, r.house);
                if (!p || !c) return;
                if (parentIdx[r.name] == null) parentIdx[r.name] = Object.keys(parentIdx).length % 3;
                var px = p.x + FT.w / 2, cx = c.x + FT.w / 2, top = p.y + FT.h;
                var mid = top + FT.rowGap / 2 - 4 + parentIdx[r.name] * 5;
                path("M" + px + " " + top + "V" + mid + "H" + cx + "V" + (c.y - 2), "ft-parent", p, c);
                if (r.note) pill(r.note, cx, mid + (c.y - mid) / 2, p, c);
                return;
            }
            var a = find(r.name, r.house) || find(r.name), b = null, best = Infinity;
            if (!a) return;
            nodes.forEach(function (n) {   // a person in two houses: use the nearer box
                if (n.name !== r.related || n === a) return;
                var d = Math.abs(n.x - a.x) + Math.abs(n.y - a.y);
                if (d < best) { best = d; b = n; }
            });
            if (!b) return;
            var up = a.y <= b.y ? a : b, dn = up === a ? b : a;
            var ux = up.x + FT.w / 2, dx = dn.x + FT.w / 2, d, mx, my;
            if (Math.abs(up.y - dn.y) < 10) {
                // same row: a low arch over the tops of both boxes
                var ty = up.y, lift = Math.min(60, 26 + Math.abs(ux - dx) / 8);
                d = "M" + ux + " " + ty + "C" + ux + " " + (ty - lift) + " " + dx + " " + (ty - lift) + " " + dx + " " + ty;
                mx = (ux + dx) / 2; my = ty - lift * 0.75;
            } else {
                // bottom of the upper box to the top of the lower box, leaving and arriving straight
                var y1 = up.y + FT.h, y2 = dn.y, k2 = Math.max(30, (y2 - y1) / 2);
                d = "M" + ux + " " + y1 + "C" + ux + " " + (y1 + k2) + " " + dx + " " + (y2 - k2) + " " + dx + " " + y2;
                mx = (ux + dx) / 2; my = (y1 + y2) / 2;
            }
            path(d, "ft-tie", a, b);
            pill(r.note || "", mx, my, a, b);
        });

        var sel = null;
        function select(n) {
            sel = sel === n ? null : n;
            stage.classList.toggle("ft-focus", !!sel);
            lineEls.forEach(function (l) { l.el.classList.toggle("on", !!sel && (l.a === sel || l.b === sel)); });
            nodes.forEach(function (m) {
                var linked = sel && (m === sel || lineEls.some(function (l) { return (l.a === sel && l.b === m) || (l.b === sel && l.a === m); }));
                m.el.classList.toggle("on", !!linked);
                m.el.setAttribute("aria-pressed", String(m === sel));
            });
        }
        nodes.forEach(function (n) {
            var ch = byName(n.name);
            var b = el("button", "ft-node" + (ch ? " ft-has-card" : ""));
            b.type = "button";
            b.style.left = n.x + "px"; b.style.top = n.y + "px";
            b.setAttribute("aria-pressed", "false");
            b.appendChild(el("b", "", n.name));
            if (n.note) b.appendChild(el("span", "", n.note));
            b.addEventListener("click", function () { if (!stage.dragged) select(n); });
            n.el = b;
            stage.appendChild(b);
            if (ch) {
                var go = el("button", "ft-open", "View card");
                go.type = "button";
                go.style.left = (n.x + FT.w / 2) + "px"; go.style.top = (n.y + FT.h) + "px";
                go.addEventListener("click", function () { renderCard(ch, true); });
                stage.appendChild(go);
                n.go = go;
            }
        });
        // the "View card" button shows under the selected person only
        var baseSelect = select;
        select = function (n) {
            baseSelect(n);
            nodes.forEach(function (m) { if (m.go) m.go.classList.toggle("show", m === sel); });
        };
        pills.forEach(function (p) { stage.appendChild(p.el); });   // labels sit above the boxes

        /* viewport: scroll with a finger, drag with a mouse, zoom with the buttons */
        var view = el("div", "ft-view");
        view.appendChild(stage);
        var zoom = 1;
        function setZoom(z) {
            var cx = (view.scrollLeft + view.clientWidth / 2) / zoom, cy = (view.scrollTop + view.clientHeight / 2) / zoom;
            zoom = Math.max(0.35, Math.min(1.5, z));
            stage.style.zoom = zoom;
            view.scrollLeft = cx * zoom - view.clientWidth / 2;
            view.scrollTop = cy * zoom - view.clientHeight / 2;
        }
        function fit() { return Math.min(1, (view.clientWidth - 8) / W); }
        var drag = null;
        view.addEventListener("pointerdown", function (e) {
            if (e.pointerType !== "mouse" || e.button !== 0) return;   // fingers scroll natively
            drag = { x: e.clientX, y: e.clientY, l: view.scrollLeft, t: view.scrollTop };
            stage.dragged = false;
        });
        view.addEventListener("pointermove", function (e) {
            if (!drag) return;
            var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            if (!stage.dragged && Math.abs(dx) + Math.abs(dy) > 5) {
                stage.dragged = true; view.classList.add("dragging");
                view.setPointerCapture(e.pointerId);   // only once it's a real drag, so plain clicks still reach the boxes
            }
            if (stage.dragged) { view.scrollLeft = drag.l - dx; view.scrollTop = drag.t - dy; }
        });
        function endDrag() {
            if (!drag) return;
            drag = null; view.classList.remove("dragging");
            setTimeout(function () { stage.dragged = false; }, 0);   // let the click after a drag be ignored first
        }
        view.addEventListener("pointerup", endDrag);
        view.addEventListener("pointercancel", endDrag);

        var bar = el("div", "ft-bar");
        function zbtn(label, aria, fn) {
            var b = el("button", "ft-zoom", label);
            b.type = "button"; b.setAttribute("aria-label", aria);
            b.addEventListener("click", fn);
            bar.appendChild(b);
        }
        zbtn("−", "Zoom out", function () { setZoom(zoom - 0.15); });
        zbtn("Fit", "Fit the whole tree", function () { setZoom(fit()); view.scrollLeft = 0; view.scrollTop = 0; });
        zbtn("+", "Zoom in", function () { setZoom(zoom + 0.15); });

        var wrap = el("div", "ft-wrap");
        wrap.appendChild(bar);
        wrap.appendChild(view);
        // start readable: whole width if the text stays legible, else 70% and scroll
        requestAnimationFrame(function () { setZoom(Math.max(fit(), 0.7)); view.scrollLeft = 0; view.scrollTop = 0; });
        return wrap;
    }
    /* family tree: the sheet's home view; server-filtered to the reader's chapter like the cards.
       Books without a tree get the cast grid instead, so their cards stay reachable. */
    function renderFamily(done) {
        var st = rs();
        if (!st.book) return;
        ensureSheet();
        var token = castToken;
        rpc("get_family", { p_book_id: String(st.book.id), p_up_to: upTo() }).then(function (rows) {
            if (token !== castToken) return;
            if (!Array.isArray(rows) || !rows.length) { renderCast(); if (typeof done === "function") done(); return; }
            sheetState = { view: "family", id: null };
            backBtn.classList.remove("show");
            setSheetAccent("#ff6a4d");
            sheetBody.innerHTML = "";
            var top = el("header", "cx-top cx-ft-top");
            top.appendChild(el("p", "cx-eyebrow", "BLOODLINES"));
            top.appendChild(el("h2", "cx-title", "Family tree"));
            sheetBody.appendChild(top);
            var main = el("div", "cx-main cx-ft");
            main.appendChild(el("p", "ft-hint", "Tap a person to light up their links \u00b7 drag or scroll to move around"));
            main.appendChild(drawFamily(rows));
            sheetBody.appendChild(main);
            sheetBody.appendChild(throughLine());
            sheetBody.scrollTop = 0;
            if (typeof done === "function") done();
        });
    }

    function renderCard(ch, fromCast) {
        ensureSheet();
        sheetState = { view: "card", id: ch.id };
        backBtn.classList.toggle("show", !!fromCast || cast.length > 1);
        var accent = validColor(ch.accent);
        setSheetAccent(accent);
        sheetBody.innerHTML = "";

        /* profile header: picture + labelled info box */
        var head = el("header", "cx-profile");
        head.style.setProperty("--accent", accent);
        head.appendChild(paintArt(el("div", "cx-photo"), ch));
        var info = el("dl", "cx-info");
        function row(label, value) {
            if (!value) return;
            var r = el("div", "cx-row");
            r.appendChild(el("dt", "", label));
            r.appendChild(el("dd", "", value));
            info.appendChild(r);
        }
        var aka = (ch.aliases || []).filter(function (a) { return a && String(a).trim(); });
        row("Name", ch.name);
        row(aka.length > 1 ? "Nicknames" : "Nickname", aka.join(", "));
        row("Role", ch.title);
        head.appendChild(info);
        sheetBody.appendChild(head);

        var main = el("div", "cx-main");
        main.style.setProperty("--accent", accent);
        var n = 0;
        function add(node) { node.style.setProperty("--i", n++); main.appendChild(node); }
        function card(title) {
            var c = el("section", "cx-card");
            c.appendChild(el("h3", "cx-card-h", title));
            add(c);
            return c;
        }

        var facts = ch.facts || [];
        var traits = facts.filter(function (f) { return f.kind === "trait"; });
        var about = facts.filter(function (f) { return f.kind === "about"; });
        var rels = facts.filter(function (f) { return f.kind === "relationship"; });

        if (about.length) {
            var bg = card("Background");
            about.forEach(function (f, i) { bg.appendChild(el("p", i === 0 ? "cx-lead" : "cx-about", f.text)); });
        }
        if (traits.length) {
            var tc = card("Traits");
            var tl = el("ul", "cx-traits");
            traits.forEach(function (f) { tl.appendChild(el("li", "cx-trait", f.text)); });
            tc.appendChild(tl);
        }
        if (rels.length) {
            var rc = card("Relationships");
            var list = el("div", "cx-rels");
            rels.forEach(function (f) {
                var other = f.related ? byId(f.related) : null;
                var row = el(other ? "button" : "div", "cx-rel");
                if (other) {
                    row.type = "button";
                    row.appendChild(portrait(other, "sm"));
                }
                var t = el("span", "cx-rel-text");
                if (other) t.appendChild(el("b", "", other.name));
                t.appendChild(el("span", "", f.text));
                row.appendChild(t);
                if (other) {
                    var go = el("span", "cx-rel-go");
                    go.innerHTML = icon(I.chev, 16);
                    row.appendChild(go);
                    row.addEventListener("click", function () { renderCard(other, true); });
                }
                list.appendChild(row);
            });
            rc.appendChild(list);
        }
        if (!traits.length && !about.length && !rels.length) {
            add(el("p", "cx-empty", "Nothing is known about them yet."));
        }
        if (Number(ch.locked) > 0) {
            var lk = el("p", "cx-locked");
            lk.innerHTML = icon(I.lock, 14);
            lk.appendChild(document.createTextNode(" " + ch.locked + " more detail" + (Number(ch.locked) === 1 ? "" : "s") + " unlock as you read"));
            add(lk);
        }
        sheetBody.appendChild(main);
        sheetBody.appendChild(throughLine());
        sheetBody.scrollTop = 0;
    }

    function openFamily() {
        if (!rs().chapter) { toast("Open a chapter first."); return; }
        loadCast(function () { renderFamily(openSheet); });   // cast first, so tree boxes can open cards
    }

    /* =========================================================
       2. "PREVIOUSLY ON…" RECAP
    ========================================================= */

    var sessionBook = null;
    var rcLayer = null;

    function lastRead() { return readJSON(LAST_KEY); }

    function closeRecap() { if (rcLayer) rcLayer.classList.remove("open"); }

    function showRecap(rows, awayDays) {
        var st = rs();
        if (!rcLayer) {
            rcLayer = el("div", "rc-layer");
            rcLayer.innerHTML =
                '<div class="rc-backdrop"></div>' +
                '<section class="rc-card" role="dialog" aria-modal="true" aria-label="Previously on">' +
                '<p class="rc-eyebrow">Previously on\u2026</p><h2 class="rc-book"></h2><p class="rc-away"></p>' +
                '<div class="rc-timeline"></div>' +
                '<button class="read-button large rc-go" type="button">Continue reading</button></section>';
            document.body.appendChild(rcLayer);
            rcLayer.querySelector(".rc-backdrop").addEventListener("click", closeRecap);
            rcLayer.querySelector(".rc-go").addEventListener("click", closeRecap);
        }
        rcLayer.querySelector(".rc-book").textContent = st.book ? st.book.title : "";
        var away = rcLayer.querySelector(".rc-away");
        away.textContent = awayDays >= 1 ? "Welcome back. It's been " + Math.floor(awayDays) + " day" + (Math.floor(awayDays) === 1 ? "" : "s") + " \u2014 here's where you left off." : "A quick refresher before you dive back in.";
        var tl = rcLayer.querySelector(".rc-timeline");
        tl.innerHTML = "";
        rows.forEach(function (r) {
            var item = el("div", "rc-item");
            var label = "Chapter " + r.chapter_number;
            var named = r.title && !/^\s*chapter\s*\d+\s*$/i.test(r.title);
            item.appendChild(el("p", "rc-chap", label));
            if (named) item.appendChild(el("h3", "rc-title", r.title));
            item.appendChild(el("p", "rc-text", r.recap));
            tl.appendChild(item);
        });
        void rcLayer.offsetWidth;
        rcLayer.classList.add("open");
        rcLayer.querySelector(".rc-go").focus({ preventScroll: true });
    }

    function fetchRecaps(bid, n) {
        return rpc("get_recaps", { p_book_id: bid, p_before: n, p_limit: RECAP_SHOW }).then(function (rows) {
            return Array.isArray(rows) ? rows.slice().sort(function (a, b) { return a.chapter_number - b.chapter_number; }) : [];
        });
    }

    function manualRecap() {
        var st = rs();
        if (!st.book || !st.chapter) { toast("Open a chapter first."); return; }
        var n = Number(st.chapter.chapter_number) || 1;
        if (n <= 1) { toast("You're at the very beginning \u2014 nothing to recap yet."); return; }
        fetchRecaps(String(st.book.id), n).then(function (rows) {
            if (!rows.length) { toast("No recap for this chapter yet."); return; }
            showRecap(rows, 0);
        });
    }

    function trackSession() {
        var st = rs();
        if (!st.book || !st.chapter) return;
        var bid = String(st.book.id), n = Number(st.chapter.chapter_number) || 1;
        var all = lastRead();
        if (sessionBook !== bid) {
            sessionBook = bid;
            var prev = Number(all[bid]) || 0;
            var away = prev ? (Date.now() - prev) / 86400000 : 0;
            if (prev && away >= RECAP_AFTER_DAYS && n > 1) {
                fetchRecaps(bid, n).then(function (rows) { if (rows.length) showRecap(rows, away); });
            }
        }
        all[bid] = Date.now();
        writeJSON(LAST_KEY, all);
    }

    function stampLastRead() {
        var st = rs();
        if (!st.book || !section || section.classList.contains("hidden")) return;
        var all = lastRead();
        all[String(st.book.id)] = Date.now();
        writeJSON(LAST_KEY, all);
    }

    /* =========================================================
       3. POPULAR HIGHLIGHTS, BOARD AND QUOTE CARDS
    ========================================================= */

    var popRows = {};          // chapterId -> rows from the server
    var popSegs = [];          // [{s, e, count}]
    var popToken = 0;

    function computeSegments(rows) {
        var full = idx.full, len = full.length;
        var perUser = {};
        rows.forEach(function (r) {
            var t = r.text || "";
            if (!t) return;
            var s = -1;
            if (typeof r.line === "number" && full.substr(r.line, t.length) === t) s = r.line;
            else s = full.indexOf(t);
            if (s < 0) return;
            (perUser[r.u] = perUser[r.u] || []).push([s, s + t.length]);
        });
        var diff = new Int32Array(len + 2);
        Object.keys(perUser).forEach(function (u) {
            var iv = perUser[u].sort(function (a, b) { return a[0] - b[0]; });
            var cur = iv[0].slice();
            var merged = [];
            for (var i = 1; i < iv.length; i++) {
                if (iv[i][0] <= cur[1]) cur[1] = Math.max(cur[1], iv[i][1]);
                else { merged.push(cur); cur = iv[i].slice(); }
            }
            merged.push(cur);
            merged.forEach(function (m) { diff[m[0]]++; diff[Math.min(len, m[1])]--; });
        });
        var segs = [], run = 0, start = -1, peak = 0;
        for (var p = 0; p <= len; p++) {
            run += diff[p];
            if (run >= POPULAR_MIN_READERS) {
                if (start < 0) { start = p; peak = 0; }
                if (run > peak) peak = run;
            } else if (start >= 0) {
                if (p - start >= 12) segs.push({ s: start, e: p, count: peak });
                start = -1;
            }
        }
        return segs;
    }

    function paintPopular() {
        var st = rs();
        popSegs = [];
        if (st.chapter && popRows[st.chapter.id]) popSegs = computeSegments(popRows[st.chapter.id]);
        paint("pop-lines", popSegs);
    }

    function loadPopular() {
        var st = rs();
        if (!st.book || !st.chapter) return;
        var bid = String(st.book.id), cid = String(st.chapter.id);
        if (popRows[cid]) { paintPopular(); return; }
        var token = ++popToken;
        rpc("get_popular_highlights", { p_book_id: bid, p_chapter_id: cid }).then(function (rows) {
            if (token !== popToken) return;
            popRows[cid] = Array.isArray(rows) ? rows : [];
            paintPopular();
        });
    }

    /* ----- popover when tapping a popular line ----- */
    var pop = null;

    function hidePop() { if (pop) pop.classList.remove("show"); }

    function showPop(seg, x, y) {
        if (!pop) {
            pop = el("div", "pl-pop");
            document.body.appendChild(pop);
            document.addEventListener("click", function (e) {
                if (pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest("#storyContent"))) hidePop();
            });
        }
        pop.innerHTML = "";
        pop.appendChild(el("span", "pl-count", "Saved by " + seg.count + " readers"));
        var add = el("button", "pl-btn");
        add.type = "button";
        add.innerHTML = icon(I.mark, 15) + "<span>Bookmark</span>";
        add.addEventListener("click", function () {
            hidePop();
            if (window.SolBookmarks && window.SolBookmarks.saveRange) window.SolBookmarks.saveRange(seg.s, seg.e);
        });
        var sh = el("button", "pl-btn");
        sh.type = "button";
        sh.innerHTML = icon(I.share, 15) + "<span>Share</span>";
        sh.addEventListener("click", function () {
            hidePop();
            var st = rs();
            shareQuote({
                text: idx.full.slice(seg.s, seg.e),
                chapter: st.chapter ? st.chapter.chapter_number : "",
                book: st.book ? st.book.title : ""
            });
        });
        pop.appendChild(add);
        pop.appendChild(sh);
        pop.classList.add("show");
        var w = pop.offsetWidth, h = pop.offsetHeight;
        var left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
        var top = y - h - 18;
        if (top < 8) top = y + 22;
        pop.style.left = left + "px";
        pop.style.top = top + "px";
    }

    /* ----- quote card (PNG for TikTok / Instagram) ----- */

    function wrapLines(ctx, text, maxW) {
        var words = text.split(" "), lines = [], line = "";
        words.forEach(function (w) {
            var test = line ? line + " " + w : w;
            if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
            else line = test;
        });
        if (line) lines.push(line);
        return lines;
    }

    function spaced(ctx, text, x, y, gap) {
        if ("letterSpacing" in ctx) { ctx.letterSpacing = gap + "px"; ctx.fillText(text, x, y); ctx.letterSpacing = "0px"; return; }
        ctx.fillText(text, x, y);
    }

    function makeQuoteCard(o) {
        var W = 1080, H = 1350;
        var fontsReady = document.fonts && document.fonts.load
            ? Promise.all([
                document.fonts.load('italic 400 56px "Inter"'),
                document.fonts.load('600 30px "Inter"')
              ]).catch(function () {})
            : Promise.resolve();
        return fontsReady.then(function () {
            var c = document.createElement("canvas");
            c.width = W; c.height = H;
            var ctx = c.getContext("2d");

            var bg = ctx.createLinearGradient(0, 0, W, H);
            bg.addColorStop(0, "#0b0b0b"); bg.addColorStop(1, "#2b0606");
            ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
            var glow = ctx.createRadialGradient(180, 120, 20, 180, 120, 760);
            glow.addColorStop(0, "rgba(163,0,0,.45)"); glow.addColorStop(1, "rgba(163,0,0,0)");
            ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

            ctx.strokeStyle = "rgba(212,175,55,.85)"; ctx.lineWidth = 2;
            ctx.strokeRect(54, 54, W - 108, H - 108);
            ctx.strokeStyle = "rgba(212,175,55,.3)"; ctx.lineWidth = 1;
            ctx.strokeRect(70, 70, W - 140, H - 140);

            ctx.textAlign = "center";
            ctx.fillStyle = "#e5c158";
            ctx.font = '600 28px "Inter", Arial, sans-serif';
            spaced(ctx, "SOL", W / 2, 150, 8);

            ctx.font = '400 240px "Inter", Arial, sans-serif';
            ctx.fillStyle = "rgba(212,175,55,.9)";
            ctx.fillText("\u201C", W / 2, 400);

            var text = clip(o.text, 340);
            var maxW = W - 240, maxH = 620, size = 62, lines, lh;
            ctx.fillStyle = "#f3ede1";
            do {
                ctx.font = 'italic 400 ' + size + 'px "Inter", Arial, sans-serif';
                lh = Math.round(size * 1.38);
                lines = wrapLines(ctx, text, maxW);
                size -= 3;
            } while (lines.length * lh > maxH && size > 30);
            var blockH = lines.length * lh;
            var y = 450 + (maxH - blockH) / 2 + lh * 0.8;
            lines.forEach(function (ln, i) { ctx.fillText(ln, W / 2, y + i * lh); });

            var g = ctx.createLinearGradient(W / 2 - 120, 0, W / 2 + 120, 0);
            g.addColorStop(0, "rgba(212,175,55,0)"); g.addColorStop(.5, "rgba(212,175,55,1)"); g.addColorStop(1, "rgba(212,175,55,0)");
            ctx.fillStyle = g; ctx.fillRect(W / 2 - 120, 1130, 240, 2);

            ctx.fillStyle = "#e5c158";
            ctx.font = 'italic 400 38px "Inter", Arial, sans-serif';
            ctx.fillText(o.book || "", W / 2, 1188);
            ctx.fillStyle = "rgba(245,245,247,.7)";
            ctx.font = '600 22px "Inter", Arial, sans-serif';
            spaced(ctx, o.chapter ? "CHAPTER " + o.chapter : "", W / 2, 1236, 6);
            ctx.fillStyle = "rgba(245,245,247,.45)";
            ctx.font = '400 22px Inter, Arial, sans-serif';
            ctx.fillText(location.host, W / 2, 1282);
            return c;
        });
    }

    function shareQuote(o) {
        makeQuoteCard(o).then(function (canvas) {
            canvas.toBlob(function (blob) {
                if (!blob) { toast("Couldn't make the quote card."); return; }
                var file;
                try { file = new File([blob], "sols-collection-quote.png", { type: "image/png" }); } catch (e) { file = null; }
                if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
                    navigator.share({ files: [file], title: o.book || "Sol" }).catch(function () {});
                    return;
                }
                var a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "sols-collection-quote.png";
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
                toast("Quote card saved.");
            }, "image/png");
        });
    }

    /* ----- "Most saved lines" board in the book modal ----- */

    function renderBoard(book) {
        var anchor = document.getElementById("bookmarksPanel");
        var old = document.getElementById("topLinesPanel");
        if (old) old.remove();
        if (!anchor || !book) return;
        rpc("get_top_saved_lines", { p_book_id: String(book.id), p_limit: BOARD_SIZE, p_min: BOARD_MIN_SAVES }).then(function (rows) {
            var again = document.getElementById("topLinesPanel");
            if (again) again.remove();
            if (!Array.isArray(rows) || !rows.length) return;
            if (!document.getElementById("bmList")) return;
            var panel = el("section", "bm-panel tl-panel");
            panel.id = "topLinesPanel";
            var head = el("div", "bm-panel-head");
            var h = el("h3", "");
            h.innerHTML = icon(I.spark, 16);
            h.appendChild(document.createTextNode("Most saved lines"));
            head.appendChild(h);
            panel.appendChild(head);
            var list = el("ol", "tl-list");
            rows.forEach(function (r, i) {
                var li = el("li", "tl-item");
                li.appendChild(el("span", "tl-rank", String(i + 1)));
                var open = el("button", "tl-open");
                open.type = "button";
                open.appendChild(el("span", "tl-text", clip(r.text, 200)));
                var meta = el("span", "tl-meta");
                meta.appendChild(el("b", "bm-chip", "Chapter " + r.chapter_number));
                meta.appendChild(el("span", "bm-date", "saved by " + r.saves + " readers"));
                open.appendChild(meta);
                open.addEventListener("click", function () {
                    if (!window.SolReader) return;
                    window.SolReader.closeModal("bookModal");
                    window.SolReader.open(book.id, r.chapter_number);
                });
                var sh = el("button", "tl-share");
                sh.type = "button";
                sh.setAttribute("aria-label", "Share this line as a picture");
                sh.title = "Share as a picture";
                sh.innerHTML = icon(I.share, 16);
                sh.addEventListener("click", function () {
                    shareQuote({ text: r.text, chapter: r.chapter_number, book: book.title });
                });
                li.appendChild(open);
                li.appendChild(sh);
                list.appendChild(li);
            });
            panel.appendChild(list);
            anchor.parentNode.insertBefore(panel, anchor.nextSibling);
        });
    }

    function hookBookModal() {
        var sb = window.SolBookmarks;
        if (!sb || sb.__extrasHooked || typeof sb.renderModal !== "function") return;
        var orig = sb.renderModal;
        sb.renderModal = function (book) {
            orig.apply(sb, arguments);
            renderBoard(book);
        };
        sb.__extrasHooked = true;
    }

    /* =========================================================
       WIRING
    ========================================================= */

    function injectButtons() {
        var anchor = document.getElementById("bookmarkHere");
        if (!anchor || document.getElementById("cxTreeBtn")) return;

        var tree = el("button", "toolbar-btn bm-toolbar-btn");
        tree.id = "cxTreeBtn";
        tree.type = "button";
        tree.title = "Family tree";
        tree.setAttribute("aria-label", "Family tree");
        tree.innerHTML = icon(I.tree, 18);
        tree.addEventListener("click", openFamily);

        var rec = el("button", "toolbar-btn bm-toolbar-btn");
        rec.id = "rcBtn";
        rec.type = "button";
        rec.title = "Previously on\u2026";
        rec.setAttribute("aria-label", "Previously on");
        rec.innerHTML = icon(I.history, 18);
        rec.addEventListener("click", manualRecap);

        anchor.insertAdjacentElement("afterend", tree);
        tree.insertAdjacentElement("afterend", rec);
    }

    function onRender() {
        var st = rs();
        if (!st.book || !st.chapter || !content) return;
        var bid = String(st.book.id), n = Number(st.chapter.chapter_number) || 1;
        setReached(bid, n);
        endSeen = false;
        setTimeout(checkChapterEnd, 1200);   /* a short chapter may fit on one screen */
        indexText();
        trackSession();
        loadCast(paintNames);
        loadPopular();
        hidePop();
    }

    /* the reader reached the last lines of the chapter: unlock what it revealed */
    var endSeen = false, endTick = false;
    function checkChapterEnd() {
        endTick = false;
        if (endSeen || !content || !section || section.classList.contains("hidden")) return;
        var st = rs();
        if (!st.book || !st.chapter || !content.textContent.trim()) return;
        var r = content.getBoundingClientRect();
        if (r.height < 40 || r.bottom > (window.innerHeight || document.documentElement.clientHeight) + 60) return;
        endSeen = true;
        if (!setDone(String(st.book.id), Number(st.chapter.chapter_number) || 1)) return;
        castKey = "";
        loadCast(function () {
            paintNames();
            if (layer && layer.classList.contains("open") && sheetState.view === "cast") renderCast();
        });
    }

    function bindContentEvents() {
        if (!content) return;

        document.addEventListener("scroll", function () {
            if (endSeen || endTick) return;
            endTick = true;
            requestAnimationFrame(checkChapterEnd);
        }, { capture: true, passive: true });

        content.addEventListener("click", function (e) {
            var sel = window.getSelection && window.getSelection();
            if (sel && !sel.isCollapsed) return;
            if (e.target.closest && e.target.closest("mark.bm-hl")) return;
            var hit = hitList(nameMatches, e.clientX, e.clientY);
            if (hit) { hidePop(); renderCard(hit.ch, false); openSheet(); return; }
            var seg = hitList(popSegs, e.clientX, e.clientY);
            if (seg) showPop(seg, e.clientX, e.clientY); else hidePop();
        });

        if (!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) {
            var ticking = false, lx = 0, ly = 0;
            content.addEventListener("mousemove", function (e) {
                lx = e.clientX; ly = e.clientY;
                if (ticking) return;
                ticking = true;
                requestAnimationFrame(function () {
                    ticking = false;
                    var over = hitList(nameMatches, lx, ly) || hitList(popSegs, lx, ly);
                    content.style.cursor = over ? "pointer" : "";
                });
            });
        }
    }

    function init() {
        injectButtons();
        hookBookModal();
        bindContentEvents();
        document.addEventListener("sol:chapter-rendered", onRender);
        document.addEventListener("keydown", function (e) {
            if (e.key !== "Escape") return;
            hidePop(); closeSheet(); closeRecap();
        });
        document.addEventListener("visibilitychange", function () { if (document.hidden) stampLastRead(); });
        window.addEventListener("pagehide", stampLastRead);
        if (section) {
            new MutationObserver(function () {
                if (section.classList.contains("hidden")) {
                    sessionBook = null;
                    closeSheet(); closeRecap(); hidePop();
                    cast = []; castKey = ""; nameMatches = []; popSegs = [];
                    if (canHighlight) { try { CSS.highlights.delete("cx-names"); CSS.highlights.delete("pop-lines"); } catch (e) {} }
                }
            }).observe(section, { attributes: true, attributeFilter: ["class"] });
        }
        /* chapter may already be on screen */
        if (rs().chapter) onRender();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();