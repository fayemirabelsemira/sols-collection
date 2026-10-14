/* =========================================================
   AUTHOR WORKSPACE (Wattpad-style)
   - Write / edit novels and chapters while logged in as owner
   - Drafts stay private; Publish makes them readable
   - Uses SECURITY DEFINER RPCs from sql/02_author_workspace.sql
   Load AFTER script.js (needs supabaseClient, currentUser, solToast,
   openModal, closeModal, loadBooks).
========================================================= */
(function () {
  "use strict";

  var sb = typeof supabaseClient !== "undefined" ? supabaseClient : null;
  if (!sb) return;

  var state = {
    canWrite: false,
    books: [],
    bookId: null,
    chapters: [],
    chapterId: null,
    dirty: false,
    view: "books"
  };

  var modal, bodyEl, titleEl;

  function ensureModal() {
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "authorModal";
    modal.className = "modal author-modal";
    modal.innerHTML =
      '<div class="modal-overlay" data-close-author></div>' +
      '<div class="modal-box author-box" role="dialog" aria-modal="true" aria-labelledby="authorTitle">' +
      '  <button class="modal-close" type="button" data-close-author aria-label="Close">×</button>' +
      '  <div class="author-head">' +
      '    <p class="section-label">WRITER STUDIO</p>' +
      '    <h2 id="authorTitle">Your novels</h2>' +
      '    <div class="author-head-actions" id="authorHeadActions"></div>' +
      "  </div>" +
      '  <div class="author-body" id="authorBody"></div>' +
      "</div>";

    document.body.appendChild(modal);

    bodyEl = modal.querySelector("#authorBody");
    titleEl = modal.querySelector("#authorTitle");

    modal.querySelectorAll("[data-close-author]").forEach(function (el) {
      el.addEventListener("click", closeAuthor);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("active")) {
        if (state.dirty && !confirm("You have unsaved changes. Close anyway?")) return;
        closeAuthor();
      }
    });

    return modal;
  }

  function openAuthor() {
    ensureModal();
    modal.classList.add("active");
    document.body.classList.add("modal-open");
    state.view = "books";
    state.bookId = null;
    state.chapterId = null;
    state.dirty = false;
    loadBooks();
  }

  function closeAuthor() {
    if (!modal) return;
    if (state.dirty && !confirm("You have unsaved changes. Close anyway?")) return;
    modal.classList.remove("active");
    document.body.classList.remove("modal-open");
    state.dirty = false;
  }

  function setTitle(t) {
    if (titleEl) titleEl.textContent = t;
  }

  function headActions(html) {
    var el = document.getElementById("authorHeadActions");
    if (el) el.innerHTML = html || "";
  }

  function toast(msg, opts) {
    if (window.solToast) window.solToast(msg, opts);
    else alert(msg);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function checkCanWrite() {
    var user = typeof currentUser !== "undefined" ? currentUser : null;
    if (!user) {
      state.canWrite = false;
      updateNav();
      return false;
    }
    try {
      var res = await sb.rpc("author_can_write");
      state.canWrite = !!(res && res.data === true);
    } catch (e) {
      state.canWrite = false;
    }
    updateNav();
    return state.canWrite;
  }

  function updateNav() {
    var btn = document.getElementById("authorNavButton");
    var mobile = document.getElementById("mobileAuthorButton");
    if (btn) btn.classList.toggle("hidden", !state.canWrite);
    if (mobile) mobile.classList.toggle("hidden", !state.canWrite);
  }

  async function loadBooks() {
    state.view = "books";
    setTitle("Your novels");
    headActions(
      '<button type="button" class="author-btn primary" data-action="new-book">+ New novel</button>'
    );
    bodyEl.innerHTML = '<p class="author-loading">Loading your novels…</p>';

    try {
      var res = await sb.rpc("author_list_my_books");
      if (res.error) throw res.error;
      state.books = res.data || [];
      renderBooks();
    } catch (e) {
      console.error(e);
      bodyEl.innerHTML =
        '<p class="author-empty">Couldn’t load novels. Make sure the author SQL is installed.</p>';
    }
  }

  function renderBooks() {
    if (!state.books.length) {
      bodyEl.innerHTML =
        '<div class="author-empty">' +
        "<p>No novels yet.</p>" +
        '<button type="button" class="author-btn primary" data-action="new-book">Create your first novel</button>' +
        "</div>";
      return;
    }

    var html = '<ul class="author-book-list">';
    state.books.forEach(function (b) {
      html +=
        '<li class="author-book-item">' +
        '<button type="button" class="author-book-open" data-action="open-book" data-id="' +
        esc(b.id) +
        '">' +
        '<span class="ab-title">' +
        esc(b.title) +
        "</span>" +
        '<span class="ab-meta">' +
        esc(b.genre || "Romance") +
        " · " +
        (b.published_count || 0) +
        " published" +
        (b.draft_count ? " · " + b.draft_count + " draft" + (b.draft_count === 1 ? "" : "s") : "") +
        "</span>" +
        "</button>" +
        '<button type="button" class="author-btn ghost" data-action="edit-book" data-id="' +
        esc(b.id) +
        '">Edit info</button>' +
        "</li>";
    });
    html += "</ul>";
    bodyEl.innerHTML = html;
  }

  function openBookForm(book) {
    state.view = "book-form";
    state.dirty = false;
    var isNew = !book;
    setTitle(isNew ? "New novel" : "Edit novel");
    headActions(
      '<button type="button" class="author-btn ghost" data-action="back-books">← Back</button>'
    );

    bodyEl.innerHTML =
      '<form class="author-form" id="authorBookForm">' +
      '<label>Title<input name="title" required maxlength="200" value="' +
      esc(book ? book.title : "") +
      '"></label>' +
      '<label>Author name<input name="author" maxlength="120" value="' +
      esc(book ? book.author || "" : "LadyySol") +
      '"></label>' +
      '<label>Genre<input name="genre" maxlength="80" value="' +
      esc(book ? book.genre || "Romance" : "Romance") +
      '"></label>' +
      '<label>Full-book price (₱)<input name="price" type="number" min="1" step="1" value="' +
      esc(book && book.price != null ? book.price : 150) +
      '"></label>' +
      '<label>Cover image URL<input name="cover_url" type="url" placeholder="https://…" value="' +
      esc(book && book.cover_url ? book.cover_url : "") +
      '"></label>' +
      '<label>Description<textarea name="description" rows="5" maxlength="4000">' +
      esc(book ? book.description || "" : "") +
      "</textarea></label>" +
      '<div class="author-form-actions">' +
      '<button type="submit" class="author-btn primary">' +
      (isNew ? "Create novel" : "Save changes") +
      "</button>" +
      "</div></form>";

    var form = document.getElementById("authorBookForm");
    form.addEventListener("input", function () {
      state.dirty = true;
    });
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = "Saving…";

      try {
        var res = await sb.rpc("author_upsert_book", {
          p_id: book ? book.id : null,
          p_title: String(fd.get("title") || "").trim(),
          p_author: String(fd.get("author") || "").trim(),
          p_genre: String(fd.get("genre") || "").trim(),
          p_description: String(fd.get("description") || ""),
          p_cover_url: String(fd.get("cover_url") || "").trim(),
          p_price: Number(fd.get("price")) || 150
        });
        if (res.error) throw res.error;
        state.dirty = false;
        toast(isNew ? "Novel created." : "Novel updated.");
        if (typeof window.loadBooks === "function") {
          try {
            await window.loadBooks();
          } catch (err) {}
        }
        if (isNew && res.data && res.data.id) {
          openChapters(res.data.id);
        } else {
          loadBooks();
        }
      } catch (err) {
        console.error(err);
        toast((err && err.message) || "Couldn’t save the novel.");
        btn.disabled = false;
        btn.textContent = isNew ? "Create novel" : "Save changes";
      }
    });
  }

  async function openChapters(bookId) {
    state.view = "chapters";
    state.bookId = bookId;
    state.chapterId = null;
    state.dirty = false;

    var book = state.books.find(function (b) {
      return String(b.id) === String(bookId);
    });
    setTitle(book ? book.title : "Chapters");
    headActions(
      '<button type="button" class="author-btn ghost" data-action="back-books">← Novels</button>' +
        '<button type="button" class="author-btn primary" data-action="new-chapter">+ New chapter</button>'
    );
    bodyEl.innerHTML = '<p class="author-loading">Loading chapters…</p>';

    try {
      var res = await sb.rpc("author_list_chapters", { p_book_id: bookId });
      if (res.error) throw res.error;
      state.chapters = res.data || [];
      renderChapters();
    } catch (e) {
      console.error(e);
      bodyEl.innerHTML = '<p class="author-empty">Couldn’t load chapters.</p>';
    }
  }

  function renderChapters() {
    if (!state.chapters.length) {
      bodyEl.innerHTML =
        '<div class="author-empty">' +
        "<p>No chapters yet. Write the first one.</p>" +
        '<button type="button" class="author-btn primary" data-action="new-chapter">Write chapter 1</button>' +
        "</div>";
      return;
    }

    var html = '<ul class="author-chapter-list">';
    state.chapters.forEach(function (c) {
      var draft = c.status === "draft";
      html +=
        '<li class="author-chapter-item' +
        (draft ? " is-draft" : "") +
        '">' +
        '<button type="button" class="author-chapter-open" data-action="edit-chapter" data-id="' +
        esc(c.id) +
        '">' +
        '<span class="ac-num">Ch. ' +
        esc(c.chapter_number) +
        "</span>" +
        '<span class="ac-title">' +
        esc(c.title || "Untitled") +
        "</span>" +
        '<span class="ac-badge">' +
        (draft ? "DRAFT" : c.is_free ? "FREE" : "₱" + (c.price || 0)) +
        "</span>" +
        "</button>" +
        '<div class="ac-actions">' +
        (draft
          ? '<button type="button" class="author-btn small primary" data-action="publish" data-id="' +
            esc(c.id) +
            '">Publish</button>'
          : '<button type="button" class="author-btn small ghost" data-action="unpublish" data-id="' +
            esc(c.id) +
            '">Unpublish</button>') +
        '<button type="button" class="author-btn small danger" data-action="delete-chapter" data-id="' +
        esc(c.id) +
        '">Delete</button>' +
        "</div></li>";
    });
    html += "</ul>";
    bodyEl.innerHTML = html;
  }

  async function openEditor(chapterId) {
    state.view = "editor";
    state.chapterId = chapterId || null;
    state.dirty = false;

    var existing = null;
    if (chapterId) {
      bodyEl.innerHTML = '<p class="author-loading">Opening chapter…</p>';
      try {
        var res = await sb.rpc("author_get_chapter", { p_chapter_id: chapterId });
        if (res.error) throw res.error;
        existing = (res.data && res.data[0]) || res.data || null;
        if (Array.isArray(existing)) existing = existing[0];
      } catch (e) {
        console.error(e);
        toast("Couldn’t load chapter.");
        openChapters(state.bookId);
        return;
      }
    }

    var nextNum = 1;
    if (!existing) {
      state.chapters.forEach(function (c) {
        if (c.chapter_number >= nextNum) nextNum = c.chapter_number + 1;
      });
    }

    setTitle(existing ? "Edit chapter " + existing.chapter_number : "New chapter");
    headActions(
      '<button type="button" class="author-btn ghost" data-action="back-chapters">← Chapters</button>'
    );

    var isFree = existing ? !!existing.is_free : nextNum <= 5;
    var status = existing ? existing.status : "draft";

    bodyEl.innerHTML =
      '<form class="author-form author-editor" id="authorChapterForm">' +
      '<div class="author-row">' +
      '<label class="narrow">Chapter #<input name="chapter_number" type="number" min="1" required value="' +
      esc(existing ? existing.chapter_number : nextNum) +
      '"></label>' +
      '<label>Title<input name="title" maxlength="200" value="' +
      esc(existing ? existing.title || "" : "") +
      '" placeholder="Chapter title"></label>' +
      "</div>" +
      '<label>Story<textarea name="content" id="authorContent" rows="16" placeholder="Write your chapter here…">' +
      esc(existing ? existing.content || "" : "") +
      "</textarea></label>" +
      '<div class="author-row author-opts">' +
      '<label class="check"><input type="checkbox" name="is_free"' +
      (isFree ? " checked" : "") +
      "> Free chapter</label>" +
      '<label class="narrow">Price ₱<input name="price" type="number" min="0" step="1" value="' +
      esc(existing && existing.price != null ? existing.price : isFree ? 0 : 10) +
      '"></label>' +
      '<label class="narrow">Status<select name="status">' +
      '<option value="draft"' +
      (status === "draft" ? " selected" : "") +
      ">Draft</option>" +
      '<option value="published"' +
      (status === "published" ? " selected" : "") +
      ">Published</option>" +
      "</select></label>" +
      "</div>" +
      '<div class="author-form-actions sticky-actions">' +
      '<button type="button" class="author-btn ghost" data-action="save-draft">Save draft</button>' +
      '<button type="submit" class="author-btn primary">Save &amp; publish</button>' +
      "</div></form>";

    var form = document.getElementById("authorChapterForm");
    var freeBox = form.querySelector('[name="is_free"]');
    var priceInput = form.querySelector('[name="price"]');

    freeBox.addEventListener("change", function () {
      if (freeBox.checked) priceInput.value = "0";
      else if (Number(priceInput.value) === 0) priceInput.value = "10";
    });

    form.addEventListener("input", function () {
      state.dirty = true;
    });

    form.querySelector('[data-action="save-draft"]').addEventListener("click", function () {
      form.querySelector('[name="status"]').value = "draft";
      form.requestSubmit();
    });

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var statusVal = String(fd.get("status") || "draft");
      if (e.submitter && e.submitter.type === "submit") {
        statusVal = "published";
        form.querySelector('[name="status"]').value = "published";
      }

      var payload = {
        p_id: existing ? existing.id : null,
        p_book_id: state.bookId,
        p_chapter_number: Number(fd.get("chapter_number")) || null,
        p_title: String(fd.get("title") || "").trim(),
        p_content: String(fd.get("content") || ""),
        p_is_free: !!form.querySelector('[name="is_free"]').checked,
        p_price: Number(fd.get("price")),
        p_status: statusVal
      };

      var buttons = form.querySelectorAll("button");
      buttons.forEach(function (b) {
        b.disabled = true;
      });

      try {
        var res = await sb.rpc("author_upsert_chapter", payload);
        if (res.error) throw res.error;
        state.dirty = false;
        toast(statusVal === "published" ? "Chapter published." : "Draft saved.");
        if (typeof window.loadBooks === "function") {
          try {
            await window.loadBooks();
          } catch (err) {}
        }
        openChapters(state.bookId);
      } catch (err) {
        console.error(err);
        toast((err && err.message) || "Couldn’t save the chapter.");
        buttons.forEach(function (b) {
          b.disabled = false;
        });
      }
    });

    var ta = document.getElementById("authorContent");
    if (ta) setTimeout(function () {
      ta.focus();
    }, 50);
  }

  async function setStatus(id, status) {
    try {
      var res = await sb.rpc("author_set_chapter_status", {
        p_chapter_id: id,
        p_status: status
      });
      if (res.error) throw res.error;
      toast(status === "published" ? "Published." : "Moved to drafts.");
      if (typeof window.loadBooks === "function") {
        try {
          await window.loadBooks();
        } catch (err) {}
      }
      openChapters(state.bookId);
    } catch (e) {
      console.error(e);
      toast((e && e.message) || "Couldn’t update status.");
    }
  }

  async function deleteChapter(id) {
    if (!confirm("Delete this chapter permanently? This cannot be undone.")) return;
    try {
      var res = await sb.rpc("author_delete_chapter", { p_chapter_id: id });
      if (res.error) throw res.error;
      toast("Chapter deleted.");
      if (typeof window.loadBooks === "function") {
        try {
          await window.loadBooks();
        } catch (err) {}
      }
      openChapters(state.bookId);
    } catch (e) {
      console.error(e);
      toast((e && e.message) || "Couldn’t delete.");
    }
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-action]");
    if (!t || !modal || !modal.contains(t)) return;

    var action = t.getAttribute("data-action");
    var id = t.getAttribute("data-id");

    if (action === "new-book") openBookForm(null);
    else if (action === "back-books") {
      if (state.dirty && !confirm("Discard unsaved changes?")) return;
      state.dirty = false;
      loadBooks();
    } else if (action === "open-book") openChapters(id);
    else if (action === "edit-book") {
      var book = state.books.find(function (b) {
        return String(b.id) === String(id);
      });
      openBookForm(book || null);
    } else if (action === "new-chapter") openEditor(null);
    else if (action === "back-chapters") {
      if (state.dirty && !confirm("Discard unsaved changes?")) return;
      state.dirty = false;
      openChapters(state.bookId);
    } else if (action === "edit-chapter") openEditor(id);
    else if (action === "publish") setStatus(id, "published");
    else if (action === "unpublish") setStatus(id, "draft");
    else if (action === "delete-chapter") deleteChapter(id);
  });

  function injectNav() {
    var nav = document.querySelector(".main-nav");
    if (nav && !document.getElementById("authorNavButton")) {
      var btn = document.createElement("button");
      btn.id = "authorNavButton";
      btn.type = "button";
      btn.className = "nav-button hidden";
      btn.textContent = "Write";
      btn.addEventListener("click", function () {
        if (!state.canWrite) {
          toast("Log in with your writer account first.");
          if (typeof openModal === "function") openModal("loginModal");
          return;
        }
        openAuthor();
      });
      var logout = document.getElementById("logoutButton");
      if (logout) nav.insertBefore(btn, logout);
      else nav.appendChild(btn);
    }

    var mobile = document.getElementById("mobileMenu");
    if (mobile && !document.getElementById("mobileAuthorButton")) {
      var mbtn = document.createElement("button");
      mbtn.id = "mobileAuthorButton";
      mbtn.type = "button";
      mbtn.className = "hidden";
      mbtn.textContent = "Write";
      mbtn.addEventListener("click", function () {
        var mm = document.getElementById("mobileMenu");
        if (mm) mm.classList.remove("active");
        if (!state.canWrite) {
          toast("Log in with your writer account first.");
          if (typeof openModal === "function") openModal("loginModal");
          return;
        }
        openAuthor();
      });
      mobile.appendChild(mbtn);
    }
  }

  function hookBookModal() {
    var orig = window.showBook;
    if (typeof orig !== "function" || orig.__authorHooked) return;

    window.showBook = async function (bookId) {
      await orig.apply(this, arguments);
      tryInjectEditButton(bookId);
    };
    window.showBook.__authorHooked = true;
  }

  async function tryInjectEditButton(bookId) {
    var actions = document.querySelector(".book-modal-actions");
    if (!actions) return;

    var old = document.getElementById("authorEditBookBtn");
    if (old) old.remove();

    if (!state.canWrite) return;

    var owned = state.books.some(function (b) {
      return String(b.id) === String(bookId);
    });
    if (!owned && state.books.length === 0) {
      try {
        var res = await sb.rpc("author_list_my_books");
        state.books = (res && res.data) || [];
        owned = state.books.some(function (b) {
          return String(b.id) === String(bookId);
        });
      } catch (e) {}
    }
    if (!owned) return;

    var btn = document.createElement("button");
    btn.id = "authorEditBookBtn";
    btn.type = "button";
    btn.className = "read-button large author-edit-in-modal";
    btn.textContent = "Edit in Writer Studio";
    btn.addEventListener("click", function () {
      if (typeof closeModal === "function") closeModal("bookModal");
      openAuthor();
      setTimeout(function () {
        openChapters(bookId);
      }, 50);
    });
    actions.appendChild(btn);
  }

  function init() {
    injectNav();
    hookBookModal();
    checkCanWrite();

    if (sb.auth && sb.auth.onAuthStateChange) {
      sb.auth.onAuthStateChange(function () {
        setTimeout(checkCanWrite, 80);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.SolAuthor = {
    open: openAuthor,
    refresh: checkCanWrite
  };
})();