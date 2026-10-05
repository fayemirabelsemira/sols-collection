/* =========================================================
   BOOKMARKS
   - Long-press a line in the reader (or tap the toolbar
     button) to bookmark it.
   - Bookmarks are listed in the book modal; tapping one
     opens the chapter and scrolls to the line.
   - Stored in localStorage (key: solBookmarks.v1).
   Needs window.SolReader (bottom of script.js).
========================================================= */
(function () {
    "use strict";

    var STORE_KEY = "solBookmarks.v1";
    var HINT_KEY = "solBookmarkHint";
    var LONG_PRESS_MS = 480;
    var MOVE_TOLERANCE = 10;
    var COLLAPSED_COUNT = 4;
    var SNIPPET_LEN = 120;
    var BLOCK_TAGS = { P: 1, DIV: 1, BLOCKQUOTE: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1 };

    var content = document.getElementById("storyContent");
    var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var pendingJump = null;      // { chapterId, line, text, expires }
    var showingAll = false;
    var modalBook = null;
    var observer = null;

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

    function norm(t) { return (t || "").replace(/\s+/g, " ").trim(); }

    function snippetOf(el) {
        var t = norm(el.textContent);
        return t.length > SNIPPET_LEN ? t.slice(0, SNIPPET_LEN).replace(/\s+\S*$/, "") + "…" : t;
    }

    function prefixOf(t) { return norm(t).replace(/…$/, "").slice(0, 40); }

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

    function linesIn(root) {
        return Array.prototype.slice.call(root.querySelectorAll(".bm-line"));
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

    /* ---------- wrap chapter text into numbered, bookmarkable lines ----------
       Works whether the chapter is <p> blocks or plain text with newlines. */

    function decorate() {
        if (!content) return;
        var st = readerState();
        if (!st.chapter) return;
        if (content.querySelector(".bm-line")) return;       // already done
        if (norm(content.textContent).length < 80) return;   // loading / error text

        /* If the chapter is wrapped in a single <div>, work inside it */
        var root = content;
        for (var depth = 0; depth < 3; depth++) {
            var kids = Array.prototype.slice.call(root.childNodes);
            var elements = kids.filter(function (n) { return n.nodeType === 1; });
            var strayText = kids.some(function (n) { return n.nodeType === 3 && n.textContent.trim(); });
            if (elements.length === 1 && !strayText && elements[0].tagName === "DIV") root = elements[0];
            else break;
        }

        if (observer) observer.disconnect();

        var frag = document.createDocumentFragment();
        var current = null;
        var count = 0;

        function close() { current = null; }
        function open() {
            if (!current) {
                current = document.createElement("span");
                current.className = "bm-line";
                frag.appendChild(current);
            }
            return current;
        }

        Array.prototype.slice.call(root.childNodes).forEach(function (node) {
            if (node.nodeType === 3) {
                node.textContent.split(/(\n+)/).forEach(function (piece) {
                    if (!piece) return;
                    if (/^\n+$/.test(piece)) {
                        close();
                        frag.appendChild(document.createTextNode(piece));
                    } else if (!piece.trim() && !current) {
                        frag.appendChild(document.createTextNode(piece));
                    } else {
                        open().appendChild(document.createTextNode(piece));
                    }
                });
            } else if (node.nodeType === 1) {
                if (node.tagName === "BR") {
                    close();
                    frag.appendChild(node);
                } else if (BLOCK_TAGS[node.tagName]) {
                    close();
                    if (norm(node.textContent)) node.classList.add("bm-line");
                    frag.appendChild(node);
                } else {
                    open().appendChild(node);
                }
            } else {
                frag.appendChild(node);
            }
        });

        root.textContent = "";
        root.appendChild(frag);

        linesIn(content).forEach(function (el, i) {
            el.setAttribute("data-bm-line", i);
            count++;
        });

        content.setAttribute("data-bm-chapter", st.chapter.id);
        refreshMarks();
        reobserve();

        if (pendingJump && pendingJump.chapterId === st.chapter.id && Date.now() < pendingJump.expires) {
            var job = pendingJump;
            pendingJump = null;
            setTimeout(function () { jumpToLine(job); }, 60);
            setTimeout(function () { ensureVisible(job); }, 700);
        } else if (count) {
            maybeShowHint();
        }
    }

    function reobserve() {
        if (observer && content) observer.observe(content, { childList: true });
    }

    /* ---------- marks in the reader ---------- */

    function currentChapterBookmarks() {
        var st = readerState();
        if (!st.book || !st.chapter) return [];
        return load().filter(function (b) {
            return b.bookId === st.book.id && b.chapterId === st.chapter.id;
        });
    }

    /* Find the line for a bookmark; fall back to a text match if the chapter was edited */
    function resolveLine(bm, lines) {
        var at = lines[bm.line];
        var want = prefixOf(bm.text);
        if (at && (!want || norm(at.textContent).indexOf(want) === 0)) return at;
        for (var i = 0; i < lines.length; i++) {
            if (want && norm(lines[i].textContent).indexOf(want) === 0) return lines[i];
        }
        return at || null;
    }

    function refreshMarks() {
        if (!content) return;
        var lines = linesIn(content);
        lines.forEach(function (el) { el.classList.remove("is-bookmarked"); });
        currentChapterBookmarks().forEach(function (bm) {
            var el = resolveLine(bm, lines);
            if (el) el.classList.add("is-bookmarked");
        });
    }

    function findBookmark(line) {
        var lines = linesIn(content);
        var found = null;
        currentChapterBookmarks().forEach(function (bm) {
            if (resolveLine(bm, lines) === line) found = bm;
        });
        return found;
    }

    function addBookmark(line) {
        var st = readerState();
        if (!st.book || !st.chapter) return null;
        var bm = {
            id: uid(),
            bookId: st.book.id,
            chapterId: st.chapter.id,
            chapterNumber: st.chapter.chapter_number,
            chapterTitle: st.chapter.title || "",
            line: Number(line.getAttribute("data-bm-line")),
            text: snippetOf(line),
            created: Date.now()
        };
        var list = load();
        list.push(bm);
        if (!save(list)) {
            toast("Couldn't save. Browser storage is full or blocked.");
            return null;
        }
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
        return removed;
    }

    function restoreBookmark(bm) {
        var list = load();
        list.push(bm);
        save(list);
        refreshMarks();
        if (modalBook) renderModal(modalBook);
    }

    function toggleLine(line) {
        var existing = findBookmark(line);
        if (existing) {
            removeBookmark(existing.id);
            refreshMarks();
            toast("Bookmark removed", "Undo", function () { restoreBookmark(existing); });
        } else {
            var bm = addBookmark(line);
            if (!bm) return;
            refreshMarks();
            toast("Bookmarked · Chapter " + bm.chapterNumber, "Undo", function () {
                removeBookmark(bm.id);
                refreshMarks();
            });
        }
    }

    /* ---------- long-press (touch and mouse) ---------- */

    function bindLongPress() {
        if (!content) return;
        var timer = null, startX = 0, startY = 0, pressed = null, fired = false;

        function cancel() {
            clearTimeout(timer);
            timer = null;
            if (pressed) { pressed.classList.remove("is-pressing"); pressed = null; }
        }

        content.addEventListener("pointerdown", function (e) {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            var line = e.target.closest && e.target.closest(".bm-line");
            if (!line) return;
            cancel();
            fired = false;
            startX = e.clientX;
            startY = e.clientY;
            pressed = line;
            line.classList.add("is-pressing");
            timer = setTimeout(function () {
                fired = true;
                var target = pressed;
                cancel();
                if (navigator.vibrate) { try { navigator.vibrate(14); } catch (err) {} }
                if (target) toggleLine(target);
            }, LONG_PRESS_MS);
        });

        content.addEventListener("pointermove", function (e) {
            if (!timer) return;
            if (Math.abs(e.clientX - startX) > MOVE_TOLERANCE || Math.abs(e.clientY - startY) > MOVE_TOLERANCE) cancel();
        });

        ["pointerup", "pointercancel", "pointerleave"].forEach(function (name) {
            content.addEventListener(name, cancel);
        });

        content.addEventListener("contextmenu", function (e) {
            if (fired || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) e.preventDefault();
        });

        content.addEventListener("click", function (e) {
            if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; }
        }, true);
    }

    /* ---------- toolbar: bookmark the line at the top of the screen ---------- */

    function topVisibleLine() {
        var scroller = document.querySelector(".story-reader");
        var top = scroller ? scroller.getBoundingClientRect().top : 0;
        var lines = linesIn(content);
        for (var i = 0; i < lines.length; i++) {
            var r = lines[i].getBoundingClientRect();
            if (r.bottom > top + 12) return lines[i];
        }
        return lines[0] || null;
    }

    function bindToolbarButton() {
        var btn = document.getElementById("bookmarkHere");
        if (!btn) return;
        btn.addEventListener("click", function () {
            var line = topVisibleLine();
            if (!line) { toast("Open a chapter first."); return; }
            if (findBookmark(line)) {
                toast("This line is already bookmarked.");
                return;
            }
            toggleLine(line);
        });
    }

    /* ---------- first-time hint ---------- */

    function maybeShowHint() {
        var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
        try { if (localStorage.getItem(HINT_KEY)) return; } catch (e) { return; }
        setTimeout(function () {
            toast(coarse ? "Tip: press and hold any line to bookmark it." : "Tip: click and hold any line to bookmark it.");
            try { localStorage.setItem(HINT_KEY, "1"); } catch (e) {}
        }, 1400);
    }

    /* ---------- jump to a saved line ---------- */

    function lineFor(job) {
        var lines = linesIn(content);
        return resolveLine({ line: job.line, text: job.text }, lines);
    }

    function jumpToLine(job) {
        var el = lineFor(job);
        if (!el) return;
        el.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "instant" });
        el.classList.remove("bm-flash");
        void el.offsetWidth;
        el.classList.add("bm-flash");
        setTimeout(function () { el.classList.remove("bm-flash"); }, 2400);
    }

    /* The reader may scroll itself after opening; re-center if we got moved */
    function ensureVisible(job) {
        var el = lineFor(job);
        if (!el) return;
        var r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) {
            el.scrollIntoView({ block: "center", behavior: "instant" });
        }
    }

    function openBookmark(bm) {
        if (!window.SolReader) return;
        pendingJump = {
            chapterId: bm.chapterId,
            line: bm.line,
            text: bm.text,
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

    var TRASH_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    var RIBBON_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>';

    function renderModal(book) {
        modalBook = book || modalBook;
        var listEl = document.getElementById("bmList");
        var countEl = document.getElementById("bmCount");
        var moreBtn = document.getElementById("bmMore");
        if (!listEl || !modalBook) return;

        var all = load()
            .filter(function (b) { return b.bookId === modalBook.id; })
            .sort(function (a, b) { return b.created - a.created; });

        listEl.innerHTML = "";
        countEl.textContent = all.length ? String(all.length) : "";

        if (!all.length) {
            var empty = el("li", "bm-empty");
            empty.innerHTML = RIBBON_SVG;
            empty.appendChild(el("p", "", "Nothing saved yet. While reading, press and hold any line to keep it here."));
            listEl.appendChild(empty);
            moreBtn.classList.add("hidden");
            return;
        }

        var shown = showingAll ? all : all.slice(0, COLLAPSED_COUNT);

        shown.forEach(function (bm) {
            var li = el("li", "bm-item");

            var open = el("button", "bm-open");
            open.type = "button";
            open.appendChild(el("span", "bm-text", "\u201C" + bm.text + "\u201D"));
            var meta = el("span", "bm-meta");
            var ch = el("b", "", "Chapter " + bm.chapterNumber);
            meta.appendChild(ch);
            meta.appendChild(document.createTextNode("  " + ago(bm.created)));
            open.appendChild(meta);
            open.addEventListener("click", function () { openBookmark(bm); });

            var del = el("button", "bm-remove");
            del.type = "button";
            del.setAttribute("aria-label", "Remove bookmark from chapter " + bm.chapterNumber);
            del.innerHTML = TRASH_SVG;
            del.addEventListener("click", function () {
                var removed = removeBookmark(bm.id);
                renderModal();
                if (removed) toast("Bookmark removed", "Undo", function () { restoreBookmark(removed); });
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

    /* ---------- init ---------- */

    function init() {
        if (content) {
            observer = new MutationObserver(function () { decorate(); });
            observer.observe(content, { childList: true });
            bindLongPress();
        }
        bindToolbarButton();
        bindModal();
    }

    window.SolBookmarks = { renderModal: function (book) { showingAll = false; renderModal(book); } };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();