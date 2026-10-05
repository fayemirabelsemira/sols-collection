/* =========================================================
   BOOKMARKS (select text -> bookmark it)
   - Select (or copy-select) any passage in a chapter, then tap
     the little bookmark button that appears, or the bookmark
     icon in the reader toolbar.
   - Saved passages are highlighted in the chapter. Tap a
     highlight to remove it.
   - Bookmarks are listed in the book modal (above Start
     Reading); tapping one opens the chapter and jumps to it.
   - Saved on the device (localStorage) and, when the reader is
     logged in, synced to the Supabase `bookmarks` table.
   Needs window.SolReader (bottom of script.js).
   File must be saved as js/bookmarks.js (all lowercase).
========================================================= */
(function () {
    "use strict";

    var STORE_KEY = "solBookmarks.v1";
    var HINT_KEY = "solBookmarkHint2";
    var COLLAPSED_COUNT = 4;
    var MAX_LEN = 800;

    var content = document.getElementById("storyContent");
    var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var pendingJump = null;      // { chapterId, id, expires }
    var showingAll = false;
    var modalBook = null;
    var observer = null;
    var lastSel = null;          // most recent text selection in the chapter

    /* ---------- storage ---------- */

    function load() {
        try {
            var raw = localStorage.getItem(STORE_KEY);
            var list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (e) { return []; }
    }

    function save(list) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); return true; }
        catch (e) { return false; }
    }

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    /* ---------- helpers ---------- */

    function same(a, b) { return String(a) === String(b); }

    function norm(t) { return (t || "").replace(/\s+/g, " ").trim(); }

    function ago(ts) {
        var days = Math.floor((Date.now() - ts) / 86400000);
        if (days <= 0) return "today";
        if (days === 1) return "yesterday";
        if (days < 7) return days + " days ago";
        return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }

    function readerState() {
        return window.SolReader ? window.SolReader.state() : { book: null, chapter: null };
    }

    function isCoarse() {
        return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    }

    /* ---------- toast ---------- */

    var toastEl, toastTimer;

    function toast(message, actionLabel, onAction) {
        if (!toastEl) {
            toastEl = document.createElement("div");
            toastEl.className = "bm-toast";
            toastEl.setAttribute("role", "status");
            toastEl.setAttribute("aria-live", "polite");
            document.body.appendChild(toastEl);
        }
        toastEl.innerHTML = "";
        var span = document.createElement("span");
        span.textContent = message;
        toastEl.appendChild(span);
        if (actionLabel && onAction) {
            var b = document.createElement("button");
            b.type = "button";
            b.textContent = actionLabel;
            b.addEventListener("click", function () {
                hideToast();
                onAction();
            });
            toastEl.appendChild(b);
        }
        toastEl.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(hideToast, actionLabel ? 5000 : 3200);
    }

    function hideToast() {
        clearTimeout(toastTimer);
        if (toastEl) toastEl.classList.remove("show");
    }

    /* ---------- bookmarks for the chapter on screen ---------- */

    function currentChapterBookmarks() {
        var st = readerState();
        if (!st.book || !st.chapter) return [];
        return load().filter(function (b) {
            return same(b.bookId, st.book.id) && same(b.chapterId, st.chapter.id);
        });
    }

    /* Where is this bookmark in the chapter text? Returns [start, end] or null.
       `line` holds the start offset; the saved text is used to double-check it
       (and to find the passage again if the chapter was edited). */
    function resolveRange(bm, full) {
        var t = bm.text || "";
        if (!t) return null;
        if (typeof bm.line === "number" && full.substr(bm.line, t.length) === t) {
            return [bm.line, bm.line + t.length];
        }
        var i = full.indexOf(t);
        if (i !== -1) return [i, i + t.length];
        var cut = t.replace(/\u2026$/, "").trim();      // old bookmarks ended with an ellipsis
        if (cut.length >= 12) {
            i = full.indexOf(cut);
            if (i !== -1) return [i, i + cut.length];
        }
        return null;
    }

    /* ---------- highlight saved passages ---------- */

    function withoutObserving(fn) {
        if (observer) observer.disconnect();
        try { fn(); }
        finally { if (observer && content) observer.observe(content, { childList: true }); }
    }

    function clearMarks() {
        var marks = content.querySelectorAll("mark.bm-hl");
        Array.prototype.forEach.call(marks, function (m) {
            var p = m.parentNode;
            if (!p) return;
            while (m.firstChild) p.insertBefore(m.firstChild, m);
            p.removeChild(m);
            p.normalize();
        });
    }

    function wrapSpans(spans) {
        var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null);
        var nodes = [], pos = 0, n;
        while ((n = walker.nextNode())) {
            nodes.push({ node: n, s: pos, e: pos + n.nodeValue.length });
            pos += n.nodeValue.length;
        }

        nodes.forEach(function (item) {
            var hits = spans.filter(function (sp) { return sp.s < item.e && sp.e > item.s; });
            if (!hits.length) return;

            var cuts = [item.s, item.e];
            hits.forEach(function (sp) {
                if (sp.s > item.s && sp.s < item.e) cuts.push(sp.s);
                if (sp.e > item.s && sp.e < item.e) cuts.push(sp.e);
            });
            cuts = cuts.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });

            var frag = document.createDocumentFragment();
            for (var i = 0; i < cuts.length - 1; i++) {
                var a = cuts[i], b = cuts[i + 1];
                var piece = item.node.nodeValue.slice(a - item.s, b - item.s);
                var ids = hits.filter(function (sp) { return sp.s <= a && sp.e >= b; })
                              .map(function (sp) { return sp.id; });
                if (ids.length) {
                    var mk = document.createElement("mark");
                    mk.className = "bm-hl";
                    mk.setAttribute("data-bm-ids", ids.join(" "));
                    mk.textContent = piece;
                    frag.appendChild(mk);
                } else {
                    frag.appendChild(document.createTextNode(piece));
                }
            }
            item.node.parentNode.replaceChild(frag, item.node);
        });
    }

    function applyHighlights() {
        if (!content) return;
        var st = readerState();
        if (!st.chapter) return;
        if (norm(content.textContent).length < 80) return;   // still loading / error text

        var count = 0;
        withoutObserving(function () {
            clearMarks();
            var full = content.textContent;
            var spans = [];
            currentChapterBookmarks().forEach(function (bm) {
                var r = resolveRange(bm, full);
                if (r) spans.push({ s: r[0], e: r[1], id: bm.id });
            });
            count = spans.length;
            if (spans.length) wrapSpans(spans);
        });

        content.setAttribute("data-bm-chapter", st.chapter.id);
        updateToolbarState();
        try { document.dispatchEvent(new CustomEvent("sol:chapter-rendered")); } catch (e) {}

        if (pendingJump && same(pendingJump.chapterId, st.chapter.id) && Date.now() < pendingJump.expires) {
            var job = pendingJump;
            pendingJump = null;
            setTimeout(function () { jumpTo(job); }, 80);
            setTimeout(function () { ensureVisible(job); }, 800);
            setTimeout(function () { ensureVisible(job); }, 1600);
        } else if (!count) {
            maybeShowHint();
        }
    }

    function updateToolbarState() {
        var btn = document.getElementById("bookmarkHere");
        if (!btn) return;
        var has = currentChapterBookmarks().length > 0;
        btn.classList.toggle("has-marks", has);
    }

    /* ---------- add / remove ---------- */

    function persistFailed() {
        toast("Couldn't save. Browser storage is full or blocked.");
    }

    function addBookmark(sel) {
        var st = readerState();
        if (!st.book || !st.chapter) return null;
        var full = content.textContent;
        var text = full.slice(sel.start, sel.end);
        if (!text.trim()) return null;

        var bm = {
            id: uid(),
            bookId: st.book.id,
            chapterId: st.chapter.id,
            chapterNumber: st.chapter.chapter_number,
            chapterTitle: st.chapter.title || "",
            line: sel.start,
            text: text,
            created: Date.now()
        };
        var list = load();
        list.push(bm);
        if (!save(list)) { persistFailed(); return null; }
        push({ id: bm.id, op: "up", bm: bm });
        return bm;
    }

    function removeBookmark(id) {
        var list = load();
        var removed = null;
        var next = list.filter(function (b) {
            if (b.id === id) { removed = b; return false; }
            return true;
        });
        save(next);
        if (removed) push({ id: removed.id, op: "del" });
        return removed;
    }

    function restoreBookmarks(items) {
        var list = load();
        items.forEach(function (bm) {
            list.push(bm);
            push({ id: bm.id, op: "up", bm: bm });
        });
        save(list);
        applyHighlights();
        if (modalBook) renderModal(modalBook);
    }

    function bookmarkSelection(sel) {
        if (!sel) return;
        var full = content.textContent;
        var dupe = currentChapterBookmarks().some(function (b) {
            var r = resolveRange(b, full);
            return r && r[0] === sel.start && r[1] === sel.end;
        });
        if (dupe) {
            toast("That passage is already bookmarked.");
            clearSelection();
            return;
        }
        var bm = addBookmark(sel);
        clearSelection();
        if (!bm) return;
        applyHighlights();
        toast("Bookmarked \u00B7 Chapter " + bm.chapterNumber, "Undo", function () {
            removeBookmark(bm.id);
            applyHighlights();
        });
    }

    function removeMany(ids) {
        var removed = [];
        ids.forEach(function (id) {
            var r = removeBookmark(id);
            if (r) removed.push(r);
        });
        applyHighlights();
        if (modalBook) renderModal(modalBook);
        if (removed.length) {
            toast("Bookmark removed", "Undo", function () { restoreBookmarks(removed); });
        }
    }

    /* ---------- reading the text selection ---------- */

    function clearSelection() {
        var s = window.getSelection && window.getSelection();
        if (s && s.removeAllRanges) s.removeAllRanges();
        lastSel = null;
        hideFloat();
    }

    function readSelection() {
        var s = window.getSelection && window.getSelection();
        if (!content || !s || !s.rangeCount || s.isCollapsed) return null;
        var range = s.getRangeAt(0);
        if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return null;

        var pre = document.createRange();
        pre.selectNodeContents(content);
        pre.setEnd(range.startContainer, range.startOffset);
        var start = pre.toString().length;
        var end = start + range.toString().length;

        var full = content.textContent;
        var raw = full.slice(start, end);
        start += raw.length - raw.replace(/^\s+/, "").length;     // trim edges
        end -= raw.length - raw.replace(/\s+$/, "").length;
        if (end - start > MAX_LEN) end = start + MAX_LEN;
        if (end - start < 2) return null;

        var st = readerState();
        var rects = range.getClientRects();
        return {
            start: start,
            end: end,
            chapterId: st.chapter ? st.chapter.id : null,
            first: rects.length ? rects[0] : null,
            last: rects.length ? rects[rects.length - 1] : null
        };
    }

    /* ---------- floating bookmark button ---------- */

    var BOOKMARK_PLUS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><path d="M12 7v6"/><path d="M9 10h6"/></svg>';
    var BOOKMARK_MINUS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><path d="M9 10h6"/></svg>';

    var floatEl = null, floatMode = null, floatIds = [], floatBusy = false, busyTimer = null;

    function ensureFloat() {
        if (floatEl) return floatEl;
        floatEl = document.createElement("button");
        floatEl.type = "button";
        floatEl.className = "bm-float";

        function hold(e) {
            e.preventDefault();               // keep the text selected
            floatBusy = true;
            clearTimeout(busyTimer);
            busyTimer = setTimeout(function () { floatBusy = false; }, 700);
        }
        floatEl.addEventListener("mousedown", hold);
        floatEl.addEventListener("touchstart", hold, { passive: false });
        floatEl.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (floatMode === "add") {
                var s = readSelection() || recentSelection();
                if (s) bookmarkSelection(s);
                else hideFloat();
            } else if (floatMode === "remove") {
                var ids = floatIds.slice();
                hideFloat();
                removeMany(ids);
            }
        });
        document.body.appendChild(floatEl);
        return floatEl;
    }

    function placeFloat(first, last) {
        var el = ensureFloat();
        var W = 42;
        var coarse = isCoarse();
        var top, left;
        if (coarse) {
            top = last.bottom + 34;           // below the selection handles
            left = last.right - W / 2;
        } else {
            top = first.top - W - 10;
            left = first.left + first.width / 2 - W / 2;
            if (top < 8) top = last.bottom + 10;
        }
        top = Math.max(8, Math.min(window.innerHeight - W - 12, top));
        left = Math.max(8, Math.min(window.innerWidth - W - 8, left));
        el.style.top = top + "px";
        el.style.left = left + "px";
    }

    function showFloat(mode, first, last, ids) {
        if (!first) return;
        var el = ensureFloat();
        floatMode = mode;
        floatIds = ids || [];
        el.innerHTML = mode === "remove" ? BOOKMARK_MINUS : BOOKMARK_PLUS;
        el.setAttribute("aria-label", mode === "remove" ? "Remove bookmark" : "Bookmark selected text");
        el.title = mode === "remove" ? "Remove bookmark" : "Bookmark selected text";
        el.classList.toggle("is-remove", mode === "remove");
        placeFloat(first, last || first);
        el.classList.add("show");
    }

    function hideFloat() {
        floatMode = null;
        floatIds = [];
        if (floatEl) floatEl.classList.remove("show");
    }

    function recentSelection() {
        var st = readerState();
        if (!lastSel || !st.chapter || !same(lastSel.chapterId, st.chapter.id)) return null;
        return Date.now() - lastSel.at < 15000 ? lastSel : null;
    }

    function onSelectionSettled() {
        var s = readSelection();
        if (s) {
            s.at = Date.now();
            lastSel = s;
            showFloat("add", s.first, s.last);
        } else if (!floatBusy && floatMode === "add") {
            hideFloat();
        }
    }

    function bindSelection() {
        if (!content) return;
        var timer = null;
        document.addEventListener("selectionchange", function () {
            clearTimeout(timer);
            timer = setTimeout(onSelectionSettled, 160);
        });

        /* tap a highlighted passage -> offer to remove it */
        content.addEventListener("click", function (e) {
            var s = window.getSelection && window.getSelection();
            if (s && !s.isCollapsed) return;
            var mk = e.target.closest && e.target.closest("mark.bm-hl");
            if (!mk) { if (floatMode === "remove") hideFloat(); return; }
            var ids = (mk.getAttribute("data-bm-ids") || "").split(" ").filter(Boolean);
            var r = mk.getBoundingClientRect();
            showFloat("remove", r, r, ids);
        });

        var scroller = document.querySelector(".story-reader");
        if (scroller) {
            var ticking = false;
            scroller.addEventListener("scroll", function () {
                if (!floatMode || ticking) return;
                ticking = true;
                requestAnimationFrame(function () {
                    ticking = false;
                    if (floatMode === "add") onSelectionSettled();
                    else hideFloat();
                });
            }, { passive: true });
        }
        window.addEventListener("resize", hideFloat);
    }

    /* ---------- toolbar icon ---------- */

    function bindToolbarButton() {
        var btn = document.getElementById("bookmarkHere");
        if (!btn) return;
        btn.addEventListener("mousedown", function (e) { e.preventDefault(); });   // keep the selection
        btn.addEventListener("click", function () {
            var st = readerState();
            if (!st.chapter) { toast("Open a chapter first."); return; }
            var s = readSelection() || recentSelection();
            if (!s) {
                toast(isCoarse()
                    ? "Press and hold a passage to select it, then tap the bookmark icon."
                    : "Select a passage in the chapter first, then click the bookmark icon.");
                return;
            }
            bookmarkSelection(s);
        });
    }

    /* ---------- first-time hint ---------- */

    var hintQueued = false;

    function maybeShowHint() {
        if (hintQueued) return;
        try { if (localStorage.getItem(HINT_KEY)) return; } catch (e) { return; }
        hintQueued = true;
        setTimeout(function () {
            toast("Tip: select any text, then tap the bookmark icon to save it.");
            try { localStorage.setItem(HINT_KEY, "1"); } catch (e) {}
        }, 1600);
    }

    /* ---------- jump to a saved passage ---------- */

    function markFor(job) {
        if (!content) return null;
        return content.querySelector('mark.bm-hl[data-bm-ids~="' + job.id + '"]');
    }

    function jumpTo(job) {
        var el = markFor(job);
        if (!el) return;
        el.scrollIntoView({ block: "center", behavior: "auto" });
        el.classList.remove("bm-flash");
        void el.offsetWidth;
        el.classList.add("bm-flash");
        setTimeout(function () { el.classList.remove("bm-flash"); }, 2400);
    }

    /* The reader may scroll itself after opening; re-center if we got moved */
    function ensureVisible(job) {
        var el = markFor(job);
        if (!el) return;
        var r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) {
            el.scrollIntoView({ block: "center", behavior: "auto" });
        }
    }

    function openBookmark(bm) {
        if (!window.SolReader) return;
        pendingJump = {
            chapterId: bm.chapterId,
            id: bm.id,
            expires: Date.now() + 120000
        };
        window.SolReader.closeModal("bookModal");
        window.SolReader.open(bm.bookId, bm.chapterNumber);
    }

    /* ---------- book modal list ---------- */

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    var CLOSE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    var CHEVRON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
    var RIBBON_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>';

    function clip(t, n) {
        t = norm(t);
        return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + "\u2026" : t;
    }

    function renderModal(book) {
        modalBook = book || modalBook;
        var listEl = document.getElementById("bmList");
        var countEl = document.getElementById("bmCount");
        var moreBtn = document.getElementById("bmMore");
        if (!listEl || !modalBook) return;

        var all = load()
            .filter(function (b) { return same(b.bookId, modalBook.id); })
            .sort(function (a, b) { return b.created - a.created; });

        listEl.innerHTML = "";
        countEl.textContent = all.length ? String(all.length) : "";

        if (!all.length) {
            var empty = el("li", "bm-empty");
            empty.innerHTML = RIBBON_SVG;
            empty.appendChild(el("p", "", "No bookmarks yet. Select a passage while reading and tap the bookmark icon to keep it here."));
            listEl.appendChild(empty);
            moreBtn.classList.add("hidden");
            return;
        }

        var shown = showingAll ? all : all.slice(0, COLLAPSED_COUNT);

        shown.forEach(function (bm) {
            var li = el("li", "bm-item");

            var open = el("button", "bm-open");
            open.type = "button";
            var meta = el("span", "bm-meta");
            meta.appendChild(el("b", "bm-chip", "Chapter " + bm.chapterNumber));
            meta.appendChild(el("span", "bm-date", ago(bm.created)));
            open.appendChild(meta);
            open.appendChild(el("span", "bm-text", clip(bm.text, 170)));
            var go = el("span", "bm-go");
            go.innerHTML = CHEVRON_SVG;
            open.appendChild(go);
            open.addEventListener("click", function () { openBookmark(bm); });

            var del = el("button", "bm-remove");
            del.type = "button";
            del.setAttribute("aria-label", "Remove bookmark from chapter " + bm.chapterNumber);
            del.innerHTML = CLOSE_SVG;
            del.addEventListener("click", function () {
                var removed = removeBookmark(bm.id);
                renderModal();
                if (removed) toast("Bookmark removed", "Undo", function () { restoreBookmarks([removed]); });
            });

            li.appendChild(open);
            li.appendChild(del);
            listEl.appendChild(li);
        });

        if (all.length > COLLAPSED_COUNT) {
            moreBtn.classList.remove("hidden");
            moreBtn.textContent = showingAll ? "Show fewer" : "Show all " + all.length;
            moreBtn.setAttribute("aria-expanded", showingAll ? "true" : "false");
        } else {
            moreBtn.classList.add("hidden");
        }
    }

    function bindModal() {
        var moreBtn = document.getElementById("bmMore");
        if (moreBtn) {
            moreBtn.addEventListener("click", function () {
                showingAll = !showingAll;
                renderModal();
            });
        }
    }

    /* ---------- account sync (Supabase table: bookmarks) ---------- */

    var QUEUE_KEY = "solBookmarks.queue.v1";
    var OWNER_KEY = "solBookmarks.owner.v1";
    var TABLE = "bookmarks";
    var syncing = false, lastSync = 0, warned = false;

    function getUser() { return window.SolReader && window.SolReader.user ? window.SolReader.user() : null; }
    function getDb() { return window.SolReader && window.SolReader.db ? window.SolReader.db() : null; }

    function loadQueue() {
        try { var q = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); return Array.isArray(q) ? q : []; }
        catch (e) { return []; }
    }
    function saveQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) {} }
    function getOwner() { try { return localStorage.getItem(OWNER_KEY); } catch (e) { return null; } }
    function setOwner(id) {
        try { if (id) localStorage.setItem(OWNER_KEY, id); else localStorage.removeItem(OWNER_KEY); } catch (e) {}
    }

    function enqueue(entry) {
        var q = loadQueue().filter(function (x) { return x.id !== entry.id; });
        q.push(entry);
        saveQueue(q);
    }

    function toRow(bm, userId) {
        return {
            user_id: userId,
            client_id: bm.id,
            book_id: String(bm.bookId),
            chapter_id: String(bm.chapterId),
            chapter_number: bm.chapterNumber,
            chapter_title: bm.chapterTitle || "",
            line: bm.line,
            text: bm.text,
            created_at: new Date(bm.created).toISOString()
        };
    }

    function fromRow(r) {
        return {
            id: r.client_id,
            bookId: r.book_id,
            chapterId: r.chapter_id,
            chapterNumber: r.chapter_number,
            chapterTitle: r.chapter_title || "",
            line: r.line,
            text: r.text,
            created: Date.parse(r.created_at) || Date.now(),
            synced: true
        };
    }

    function warnOnce(err) {
        try { console.warn("Bookmark sync failed:", err); } catch (e) {}
        if (!warned) {
            warned = true;
            toast("Saved on this device. Couldn't sync to your account yet.");
        }
    }

    async function runOp(entry, user, client) {
        if (entry.op === "up") {
            var r = await client.from(TABLE).upsert(toRow(entry.bm, user.id), { onConflict: "user_id,client_id" });
            return r.error;
        }
        var d = await client.from(TABLE).delete().eq("user_id", user.id).eq("client_id", entry.id);
        return d.error;
    }

    function markSynced(id) {
        var list = load();
        list.forEach(function (b) { if (b.id === id) b.synced = true; });
        save(list);
    }

    /* Send one change to the account; if it fails, queue it for the next sync */
    async function push(entry) {
        var user = getUser(), client = getDb();
        if (!user || !client) return;           // guest: stays on device, uploaded at login
        try {
            var err = await runOp(entry, user, client);
            if (err) throw err;
            if (entry.op === "up") markSynced(entry.id);
        } catch (e) {
            enqueue(entry);
            warnOnce(e);
        }
    }

    async function sync(force) {
        var user = getUser(), client = getDb();
        if (!user || !client || syncing) return;
        if (!force && Date.now() - lastSync < 30000) return;
        syncing = true;
        try {
            /* a different account on this device: don't leak the previous reader's bookmarks */
            var owner = getOwner();
            if (owner && owner !== user.id) { save([]); saveQueue([]); }
            setOwner(user.id);

            /* 1. send changes that failed earlier */
            var left = [];
            var q = loadQueue();
            for (var i = 0; i < q.length; i++) {
                var err = await runOp(q[i], user, client);
                if (err) left.push(q[i]);
            }
            saveQueue(left);

            /* 2. read the account's bookmarks */
            var res = await client.from(TABLE).select("*").eq("user_id", user.id);
            if (res.error) throw res.error;
            var remote = res.data || [];

            var remoteIds = {}, localIds = {}, pendingUp = {}, pendingDel = {};
            remote.forEach(function (r) { remoteIds[r.client_id] = true; });
            left.forEach(function (x) { if (x.op === "up") pendingUp[x.id] = true; else pendingDel[x.id] = true; });

            var local = load();
            var merged = [], toUpload = [];
            local.forEach(function (b) {
                localIds[b.id] = true;
                if (remoteIds[b.id]) { b.synced = true; merged.push(b); }
                else if (pendingUp[b.id]) { merged.push(b); }
                else if (!b.synced) { b.synced = true; merged.push(b); toUpload.push(b); }   // saved as guest / never uploaded
                /* else: was synced before but is gone from the account, deleted on another device */
            });
            remote.forEach(function (r) {
                if (!localIds[r.client_id] && !pendingDel[r.client_id]) merged.push(fromRow(r));
            });

            /* 3. upload what the account doesn't have yet */
            if (toUpload.length) {
                var up = await client.from(TABLE).upsert(
                    toUpload.map(function (b) { return toRow(b, user.id); }),
                    { onConflict: "user_id,client_id" }
                );
                if (up.error) throw up.error;
            }

            save(merged);
            lastSync = Date.now();
            applyHighlights();
            if (modalBook) renderModal(modalBook);
        } catch (e) {
            warnOnce(e);
        } finally {
            syncing = false;
        }
    }

    /* called from script.js whenever the login state changes */
    function onAuth(user) {
        if (!user) {
            lastSync = 0;
            if (getOwner()) {                   // logged out: clear this reader's cached bookmarks
                save([]); saveQueue([]); setOwner(null);
                applyHighlights();
                if (modalBook) renderModal(modalBook);
            }
            return;
        }
        sync(false);
    }

    /* ---------- init ---------- */

    function init() {
        if (content) {
            observer = new MutationObserver(function () { applyHighlights(); });
            observer.observe(content, { childList: true });
            bindSelection();
            applyHighlights();
        }
        bindToolbarButton();
        bindModal();
    }

    window.SolBookmarks = {
        renderModal: function (book) { showingAll = false; renderModal(book); sync(false); },
        onAuth: onAuth,
        sync: function () { return sync(true); },
        /* used by js/reader-extras.js (popular highlights -> "Bookmark") */
        saveRange: function (start, end) {
            bookmarkSelection({ start: start, end: Math.min(end, start + MAX_LEN) });
        }
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();