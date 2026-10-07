/* =========================================================
   Sol's Collection: chapter comments (replies, likes, delete)
   Needs: supabase-comments.sql run once in Supabase.
   Uses the existing supabaseClient, currentUser and openModal
   from script.js (this file loads after it).
========================================================= */
(function () {
    "use strict";

    var sb = (typeof supabaseClient !== "undefined") ? supabaseClient : null;
    var section = document.getElementById("commentsSection");

    if (!sb || !section) return;

    var listEl = document.getElementById("commentsList");
    var composerEl = document.getElementById("commentComposer");
    var countEl = document.getElementById("commentsCount");
    var moreBtn = document.getElementById("commentsLoadMore");

    var PAGE_SIZE = 15;
    var MAX_LEN = 1000;
    var COLLAPSE_AFTER = 2;

    var state = {
        bookId: null,
        chapterId: null,
        sort: "new",
        offset: 0,
        token: 0,
        total: 0,
        likedIds: new Set(),
        isAdmin: false,
        adminFor: null,
        lastUserId: null
    };

    /* ---------- icons (Lucide) ---------- */
    function icon(inner) {
        return '<svg class="c-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>";
    }
    var ICON_HEART = icon('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>');
    var ICON_REPLY = icon('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>');
    var ICON_TRASH = icon('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>');

    /* ---------- helpers ---------- */
    function me() {
        return (typeof currentUser !== "undefined") ? currentUser : null;
    }

    function esc(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function timeAgo(iso) {
        var seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
        if (seconds < 45) return "just now";
        var m = Math.floor(seconds / 60);
        if (m < 60) return (m || 1) + "m ago";
        var h = Math.floor(m / 60);
        if (h < 24) return h + "h ago";
        var d = Math.floor(h / 24);
        if (d < 30) return d + "d ago";
        return new Date(iso).toLocaleDateString();
    }

    function friendlyError(error) {
        if (error && error.code === "P0001" && error.message) return error.message;
        return "Couldn't post your comment. Please try again.";
    }

    function isMissingTable(error) {
        var text = ((error && (error.message || "")) + " " + (error && error.code || "")).toLowerCase();
        return text.indexOf("42p01") !== -1 ||
            text.indexOf("does not exist") !== -1 ||
            text.indexOf("schema cache") !== -1;
    }

    function setCount() {
        countEl.textContent = state.total > 0 ? "(" + state.total + ")" : "";
    }

    /* ---------- admin check ---------- */
    async function checkAdmin() {
        var user = me();

        if (!user) {
            state.isAdmin = false;
            state.adminFor = null;
            return;
        }

        if (state.adminFor === user.id) return;

        try {
            var res = await sb.rpc("is_comment_admin");
            state.isAdmin = res && res.data === true;
        } catch (e) {
            state.isAdmin = false;
        }

        state.adminFor = user.id;
    }

    /* ---------- composer (top-level box and reply boxes) ---------- */
    function buildComposer(parentId, prefill, onCancel) {
        var box = document.createElement("div");
        box.className = "comment-form";
        box.innerHTML =
            '<textarea class="comment-input" maxlength="' + MAX_LEN + '" rows="' + (parentId ? 2 : 3) + '" ' +
            'placeholder="' + (parentId ? "Write a reply..." : "Share your thoughts on this chapter...") + '"></textarea>' +
            '<div class="comment-form-row">' +
            '<span class="comment-counter">0/' + MAX_LEN + "</span>" +
            '<span class="comment-error" role="alert"></span>' +
            '<div class="comment-form-buttons">' +
            (parentId ? '<button type="button" class="comment-cancel">Cancel</button>' : "") +
            '<button type="button" class="comment-post">' + (parentId ? "Reply" : "Post Comment") + "</button>" +
            "</div></div>";

        var ta = box.querySelector(".comment-input");
        var counter = box.querySelector(".comment-counter");
        var errEl = box.querySelector(".comment-error");
        var postBtn = box.querySelector(".comment-post");
        var cancelBtn = box.querySelector(".comment-cancel");

        if (prefill) ta.value = prefill;
        counter.textContent = ta.value.length + "/" + MAX_LEN;

        ta.addEventListener("input", function () {
            counter.textContent = ta.value.length + "/" + MAX_LEN;
            errEl.textContent = "";
        });

        ta.addEventListener("keydown", function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") submit();
        });

        if (cancelBtn) cancelBtn.addEventListener("click", function () {
            if (onCancel) onCancel();
        });

        postBtn.addEventListener("click", submit);

        async function submit() {
            var text = ta.value.trim();

            if (!text) return;

            if (!me()) {
                openModal("loginModal");
                return;
            }

            postBtn.disabled = true;
            errEl.textContent = "";

            var res = await sb.from("comments")
                .insert({
                    book_id: String(state.bookId),
                    chapter_id: String(state.chapterId),
                    parent_id: parentId || null,
                    body: text
                })
                .select()
                .single();

            postBtn.disabled = false;

            if (res.error) {
                console.error("Comment error:", res.error);
                errEl.textContent = friendlyError(res.error);
                return;
            }

            ta.value = "";
            counter.textContent = "0/" + MAX_LEN;

            addNewComment(res.data);

            if (parentId && onCancel) onCancel();
        }

        return box;
    }

    function renderComposer() {
        composerEl.innerHTML = "";

        if (!me()) {
            composerEl.innerHTML =
                '<div class="comment-login">' +
                "<span>Log in to join the discussion.</span>" +
                '<button type="button" class="comment-post" data-action="login">Log in</button>' +
                "</div>";
            return;
        }

        composerEl.appendChild(buildComposer(null, "", null));
    }

    /* ---------- one comment ---------- */
    function commentHTML(c, isReply) {
        var user = me();
        var liked = state.likedIds.has(c.id);
        var canDelete = user && (c.user_id === user.id || state.isAdmin);
        var name = c.author_name || "Reader";
        var initial = esc(name.trim().charAt(0).toUpperCase() || "R");

        return (
            '<article class="comment' + (isReply ? " reply" : "") + '" data-id="' + esc(c.id) + '" data-user="' + esc(c.user_id) + '" data-author="' + esc(name) + '">' +
            '<div class="comment-avatar" aria-hidden="true">' + initial + "</div>" +
            '<div class="comment-main">' +
            '<div class="comment-meta">' +
            '<strong class="comment-author">' + esc(name) + "</strong>" +
            '<time datetime="' + esc(c.created_at) + '" title="' + esc(new Date(c.created_at).toLocaleString()) + '">' + esc(timeAgo(c.created_at)) + "</time>" +
            "</div>" +
            '<p class="comment-body">' + esc(c.body) + "</p>" +
            '<div class="comment-actions">' +
            '<button type="button" class="comment-action comment-like' + (liked ? " liked" : "") + '" data-action="like" aria-pressed="' + liked + '" aria-label="Like">' +
            ICON_HEART + '<span class="like-count">' + (c.like_count || 0) + "</span></button>" +
            '<button type="button" class="comment-action" data-action="reply">' + ICON_REPLY + "<span>Reply</span></button>" +
            (canDelete ? '<button type="button" class="comment-action danger" data-action="delete">' + ICON_TRASH + "<span>Delete</span></button>" : "") +
            "</div>" +
            '<div class="reply-slot"></div>' +
            (isReply ? "" : '<div class="comment-replies"></div><button type="button" class="comment-more-replies hidden" data-action="toggle-replies"></button>') +
            "</div></article>"
        );
    }

    function toNode(html) {
        var wrap = document.createElement("div");
        wrap.innerHTML = html;
        return wrap.firstElementChild;
    }

    function updateRepliesToggle(topEl) {
        var wrap = topEl.querySelector(".comment-replies");
        var btn = topEl.querySelector(".comment-more-replies");
        if (!wrap || !btn) return;

        var n = wrap.querySelectorAll(".comment.reply").length;
        var hiddenCount = n - COLLAPSE_AFTER;

        if (hiddenCount <= 0) {
            wrap.classList.remove("collapsed");
            btn.classList.add("hidden");
            return;
        }

        btn.classList.remove("hidden");

        if (wrap.classList.contains("collapsed")) {
            btn.textContent = "Show " + hiddenCount + " more " + (hiddenCount === 1 ? "reply" : "replies");
        } else {
            btn.textContent = "Hide replies";
        }
    }

    function showEmptyIfNeeded() {
        if (listEl.querySelector(".comment")) return;
        if (listEl.querySelector(".comments-empty")) return;
        listEl.innerHTML = '<p class="comments-empty">No comments yet. Be the first to share your thoughts.</p>';
    }

    function addNewComment(c) {
        var empty = listEl.querySelector(".comments-empty");
        if (empty) empty.remove();

        state.total += 1;
        setCount();

        if (c.parent_id) {
            var parentEl = listEl.querySelector('.comment[data-id="' + c.parent_id + '"]');
            if (!parentEl) return;

            var wrap = parentEl.querySelector(".comment-replies");
            wrap.appendChild(toNode(commentHTML(c, true)));
            wrap.classList.remove("collapsed");
            updateRepliesToggle(parentEl);
            return;
        }

        var node = toNode(commentHTML(c, false));
        listEl.insertBefore(node, listEl.firstChild);
    }

    /* ---------- loading ---------- */
    async function loadCount(token) {
        var res = await sb.from("comments")
            .select("id", { count: "exact", head: true })
            .eq("chapter_id", String(state.chapterId));

        if (token !== state.token) return;

        state.total = res.error ? 0 : (res.count || 0);
        setCount();
    }

    async function loadLikes(rows) {
        var user = me();
        if (!user || !rows.length) return;

        var res = await sb.from("comment_likes")
            .select("comment_id")
            .eq("user_id", user.id)
            .in("comment_id", rows.map(function (r) { return r.id; }));

        if (res.error) return;

        (res.data || []).forEach(function (r) { state.likedIds.add(r.comment_id); });
    }

    async function loadPage(token, reset) {
        moreBtn.classList.add("hidden");

        var q = sb.from("comments")
            .select("*")
            .eq("chapter_id", String(state.chapterId))
            .is("parent_id", null);

        if (state.sort === "top") {
            q = q.order("like_count", { ascending: false }).order("created_at", { ascending: false });
        } else {
            q = q.order("created_at", { ascending: false });
        }

        var res = await q.range(state.offset, state.offset + PAGE_SIZE - 1);

        if (token !== state.token) return;

        if (res.error) {
            console.error("Comments load error:", res.error);
            listEl.innerHTML = '<p class="comments-empty">' +
                (isMissingTable(res.error) ? "Comments are not available yet." : "Couldn't load comments. Please try again later.") +
                "</p>";
            return;
        }

        var rows = res.data || [];
        var replies = [];

        state.offset += rows.length;

        if (rows.length) {
            var rr = await sb.from("comments")
                .select("*")
                .in("parent_id", rows.map(function (r) { return r.id; }))
                .order("created_at", { ascending: true })
                .limit(500);

            if (token !== state.token) return;

            replies = rr.error ? [] : (rr.data || []);
        }

        await loadLikes(rows.concat(replies));

        if (token !== state.token) return;

        if (reset) listEl.innerHTML = "";

        rows.forEach(function (c) {
            var node = toNode(commentHTML(c, false));
            var wrap = node.querySelector(".comment-replies");

            replies.filter(function (r) { return r.parent_id === c.id; })
                .forEach(function (r) { wrap.appendChild(toNode(commentHTML(r, true))); });

            if (wrap.querySelectorAll(".comment.reply").length > COLLAPSE_AFTER) {
                wrap.classList.add("collapsed");
            }

            listEl.appendChild(node);
            updateRepliesToggle(node);
        });

        if (reset && !rows.length) showEmptyIfNeeded();

        moreBtn.classList.toggle("hidden", rows.length < PAGE_SIZE);
    }

    async function reload() {
        var token = ++state.token;

        state.offset = 0;
        state.likedIds = new Set();

        listEl.innerHTML = '<p class="comments-empty">Loading comments...</p>';
        moreBtn.classList.add("hidden");

        await checkAdmin();

        if (token !== state.token) return;

        renderComposer();

        await Promise.all([loadCount(token), loadPage(token, true)]);
    }

    /* Called by script.js every time a chapter opens */
    function open(bookId, chapterId) {
        state.bookId = bookId;
        state.chapterId = chapterId;
        state.lastUserId = me() ? me().id : null;

        section.classList.remove("hidden");

        reload();
    }

    /* ---------- actions ---------- */
    function setLikeUI(btn, liked, count) {
        btn.classList.toggle("liked", liked);
        btn.setAttribute("aria-pressed", liked ? "true" : "false");
        btn.querySelector(".like-count").textContent = count;
    }

    async function toggleLike(btn) {
        var user = me();

        if (!user) {
            openModal("loginModal");
            return;
        }

        var el = btn.closest(".comment");
        var id = el.dataset.id;
        var wasLiked = state.likedIds.has(id);
        var current = parseInt(btn.querySelector(".like-count").textContent, 10) || 0;
        var next = Math.max(0, current + (wasLiked ? -1 : 1));

        btn.disabled = true;

        if (wasLiked) state.likedIds.delete(id); else state.likedIds.add(id);
        setLikeUI(btn, !wasLiked, next);

        var res = wasLiked
            ? await sb.from("comment_likes").delete().eq("comment_id", id).eq("user_id", user.id)
            : await sb.from("comment_likes").insert({ comment_id: id });

        btn.disabled = false;

        if (res.error && res.error.code !== "23505") {
            console.error("Like error:", res.error);

            if (wasLiked) state.likedIds.add(id); else state.likedIds.delete(id);
            setLikeUI(btn, wasLiked, current);
        }
    }

    function openReplyBox(btn) {
        if (!me()) {
            openModal("loginModal");
            return;
        }

        var el = btn.closest(".comment");
        var isReply = el.classList.contains("reply");
        var topEl = isReply ? el.closest(".comment:not(.reply)") : el;
        var parentId = topEl.dataset.id;
        var slot = el.querySelector(":scope > .comment-main > .reply-slot");

        /* only one reply box open at a time */
        listEl.querySelectorAll(".reply-slot").forEach(function (s) { s.innerHTML = ""; });

        var prefill = isReply ? "@" + el.dataset.author + " " : "";

        var box = buildComposer(parentId, prefill, function () { slot.innerHTML = ""; });

        slot.appendChild(box);

        var ta = box.querySelector(".comment-input");
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
    }

    async function deleteComment(btn) {
        var el = btn.closest(".comment");
        var isTop = !el.classList.contains("reply");

        var ok = confirm(isTop
            ? "Delete this comment? Its replies will be deleted too."
            : "Delete this reply?");

        if (!ok) return;

        btn.disabled = true;

        var res = await sb.from("comments").delete().eq("id", el.dataset.id).select("id");

        btn.disabled = false;

        if (res.error || !res.data || !res.data.length) {
            console.error("Delete error:", res.error);
            (window.solToast || window.alert)("Couldn't delete this comment.");
            return;
        }

        var topEl = isTop ? null : el.closest(".comment:not(.reply)");

        el.remove();

        if (topEl) updateRepliesToggle(topEl);

        showEmptyIfNeeded();

        loadCount(state.token);
    }

    /* ---------- events ---------- */
    section.addEventListener("click", function (e) {
        var sortBtn = e.target.closest("[data-comment-sort]");

        if (sortBtn) {
            state.sort = sortBtn.getAttribute("data-comment-sort");

            section.querySelectorAll("[data-comment-sort]").forEach(function (b) {
                b.classList.toggle("active", b === sortBtn);
            });

            reload();
            return;
        }

        var btn = e.target.closest("[data-action]");
        if (!btn) return;

        var action = btn.getAttribute("data-action");

        if (action === "login") openModal("loginModal");
        else if (action === "like") toggleLike(btn);
        else if (action === "reply") openReplyBox(btn);
        else if (action === "delete") deleteComment(btn);
        else if (action === "toggle-replies") {
            var topEl = btn.closest(".comment");
            topEl.querySelector(".comment-replies").classList.toggle("collapsed");
            updateRepliesToggle(topEl);
        }
    });

    moreBtn.addEventListener("click", function () {
        loadPage(state.token, false);
    });

    /* Re-render when the reader logs in or out (ignore token refreshes) */
    sb.auth.onAuthStateChange(function (event, session) {
        setTimeout(function () {
            if (!state.chapterId) return;

            var id = (session && session.user) ? session.user.id : null;

            if (id === state.lastUserId) return;

            state.lastUserId = id;
            state.adminFor = null;

            reload();
        }, 60);
    });

    window.SolComments = { open: open, reload: reload };
})();