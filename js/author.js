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
    /* paid chapters are only for the Sol account; every other writer publishes free */
    canSell: false,
    books: [],
    bookId: null,
    chapters: [],
    chapterId: null,
    dirty: false,
    view: "books"
  };

  var modal, bodyEl, titleEl;

  /* remember where the writer is, so a refresh brings them back to the same screen */
  var VIEW_KEY = "sol_author_view";
  function saveView(v) {
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify(v));
    } catch (e) {}
  }
  function readView() {
    try {
      return JSON.parse(sessionStorage.getItem(VIEW_KEY) || "null");
    } catch (e) {
      return null;
    }
  }
  function clearView() {
    try {
      sessionStorage.removeItem(VIEW_KEY);
    } catch (e) {}
  }
  function persistEditor() {
    if (ed) saveView({ view: "editor", bookId: state.bookId, chapterId: ed.id || null, mode: ed.mode || "write" });
  }

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
        if (state.view === "editor") {
          closePops();
          return;
        }
        if (state.dirty && !confirm("You have unsaved changes. Close anyway?")) return;
        closeAuthor();
      }
    });

    return modal;
  }

  function openAuthor() {
    ensureModal();
    leaveEditor();
    modal.classList.add("active");
    document.body.classList.add("modal-open");
    state.view = "books";
    state.bookId = null;
    state.chapterId = null;
    state.dirty = false;
    return loadBooks();
  }

  function closeAuthor() {
    if (!modal) return;
    if (state.dirty && !confirm("You have unsaved changes. Close anyway?")) return;
    leaveEditor();
    modal.classList.remove("active");
    document.body.classList.remove("modal-open");
    state.dirty = false;
    clearView();
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
    state.canSell = false;
    if (state.canWrite) {
      try {
        var sell = await sb.rpc("author_can_sell");
        /* before sql/07 is installed only the Sol account can write, so it may sell */
        state.canSell = sell && sell.error ? true : !!(sell && sell.data === true);
      } catch (e) {
        state.canSell = true;
      }
    }
    updateNav();
    document.dispatchEvent(new CustomEvent("sol:canwrite", { detail: state.canWrite }));
    if (state.canWrite) maybeRestore();
    return state.canWrite;
  }

  /* after a refresh: reopen the studio on the screen the writer was on */
  var restoreTried = false;
  async function maybeRestore() {
    if (restoreTried) return;
    restoreTried = true;
    var s = readView();
    if (!s) return;
    if (modal && modal.classList.contains("active")) return;
    try {
      await openAuthor();
      if (!s.bookId || (s.view !== "chapters" && s.view !== "editor")) return;
      var known = state.books.some(function (b) {
        return String(b.id) === String(s.bookId);
      });
      if (!known) return;
      await openChapters(s.bookId);
      if (s.view === "editor") await openEditor(s.chapterId || null, { preview: s.mode === "preview", split: s.mode === "split" });
    } catch (e) {
      console.error(e);
    }
  }

  function updateNav() {
    var btn = document.getElementById("authorNavButton");
    var mobile = document.getElementById("mobileAuthorButton");
    if (btn) btn.classList.remove("hidden");
    if (mobile) mobile.classList.remove("hidden");
  }

  async function loadBooks() {
    leaveEditor();
    state.view = "books";
    saveView({ view: "books" });
    setTitle("Your novels");
    headActions(
      (state.canSell ? '<button type="button" class="author-btn ghost" data-action="open-reports">Reports</button>' : "") +
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

  /* status, 18+, warnings, schedule (saved by author_set_book_details) */
  function detailsFields(book) {
    /* the Writer Studio list may not include these columns: use the catalog copy */
    var full = book && window.SolApp ? window.SolApp.bookById(book.id) : null;
    if (full) book = Object.assign({}, full, book);
    var st = (book && book.status) || "ongoing";
    function opt(v, label) {
      return '<option value="' + v + '"' + (st === v ? " selected" : "") + ">" + label + "</option>";
    }
    var w = book && Array.isArray(book.content_warnings) ? book.content_warnings.join(", ") : "";
    return '<fieldset class="author-details-fields"><legend>Story details</legend>' +
      '<label>Status<select name="status">' + opt("ongoing", "Ongoing") + opt("completed", "Completed") + opt("hiatus", "On hiatus") + "</select></label>" +
      '<label>Update schedule<input name="schedule" maxlength="80" placeholder="e.g. Every Friday" value="' +
      esc(book && book.update_schedule ? book.update_schedule : "") + '"></label>' +
      '<label class="author-check"><input type="checkbox" name="is_mature"' + (book && book.is_mature ? " checked" : "") +
      "> 18+ (readers confirm their age before chapter 1)</label>" +
      '<label>Content warnings <small>(comma separated)</small><input name="warnings" maxlength="400" placeholder="e.g. violence, abuse, death" value="' +
      esc(w) + '"></label></fieldset>';
  }

  /* ---------- image upload (covers + chapter pictures) ----------
     Images go to the "sol-images" Storage bucket (sql/08), in a folder named
     after the writer. They are shrunk in the browser first, which also drops
     the photo's hidden data (camera, GPS location). */
  var IMG_BUCKET = "sol-images";
  var IMG_MAX_BYTES = 10 * 1024 * 1024;

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("That file isn’t an image we can read.")); };
      img.src = url;
    });
  }

  async function shrinkImage(file, maxSide) {
    var img = await loadImage(file);
    var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(1, Math.round(img.naturalWidth * scale));
    var h = Math.max(1, Math.round(img.naturalHeight * scale));
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    var blob = await new Promise(function (r) { c.toBlob(r, "image/webp", 0.86); });
    if (!blob || blob.type !== "image/webp") blob = await new Promise(function (r) { c.toBlob(r, "image/jpeg", 0.86); });
    if (!blob) throw new Error("Couldn’t prepare that image.");
    return blob;
  }

  async function uploadImage(file, kind) {
    var user = typeof currentUser !== "undefined" ? currentUser : null;
    if (!user) throw new Error("Log in first.");
    if (!file || !/^image\/(jpeg|png|webp|gif|avif|heic|heif)$/i.test(file.type || "")) throw new Error("Choose a JPG, PNG or WebP image.");
    if (file.size > IMG_MAX_BYTES) throw new Error("That image is over 10 MB.");
    var blob = await shrinkImage(file, kind === "cover" ? 1200 : 1600);
    var ext = blob.type === "image/webp" ? "webp" : "jpg";
    var path = user.id + "/" + kind + "/" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
    var up = await sb.storage.from(IMG_BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
    if (up.error) {
      if (/bucket not found|not found/i.test(up.error.message || "")) throw new Error("Image uploads switch on once sql/08 is installed.");
      if (/row-level security|policy|unauthorized/i.test(up.error.message || "")) throw new Error("Your account can’t upload images yet.");
      throw up.error;
    }
    return sb.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  function imageFiles(dt) {
    if (!dt) return [];
    return Array.prototype.filter.call(dt.files || [], function (f) { return /^image\//.test(f.type || ""); });
  }

  /* cover field: drop zone + "choose image" + a link box */
  function coverField(book) {
    var url = book && book.cover_url ? book.cover_url : "";
    return '<div class="author-cover-field">' +
      '<span class="author-cover-label">Cover image</span>' +
      '<div class="author-drop" id="authorCoverDrop" tabindex="0" role="button" aria-label="Cover image: drop an image here or choose a file">' +
      '<span class="author-drop-preview" id="authorCoverPreview">' + (url ? '<img alt="" src="' + esc(url) + '">' : "") + "</span>" +
      '<span class="author-drop-text"><strong>Drag an image here</strong><span>or <u>choose a file</u> · JPG, PNG or WebP</span></span>' +
      '<input type="file" id="authorCoverFile" accept="image/jpeg,image/png,image/webp" hidden>' +
      "</div>" +
      '<label class="author-cover-url">or paste a link<input name="cover_url" type="url" placeholder="https://…" value="' + esc(url) + '"></label>' +
      "</div>";
  }

  function wireCoverField(form) {
    var drop = form.querySelector("#authorCoverDrop");
    var input = form.querySelector("#authorCoverFile");
    var urlIn = form.querySelector('[name="cover_url"]');
    var prev = form.querySelector("#authorCoverPreview");
    var submit = form.querySelector('[type="submit"]');
    if (!drop || !input || !urlIn) return;

    function show(src) {
      prev.innerHTML = "";
      if (!src || !/^https:\/\//i.test(src)) return;
      var img = document.createElement("img");
      img.alt = "";
      img.src = src;
      prev.appendChild(img);
    }
    async function take(file) {
      if (!file) return;
      drop.classList.add("is-busy");
      submit.disabled = true;
      var local = URL.createObjectURL(file);
      prev.innerHTML = '<img alt="" src="' + esc(local) + '">';
      try {
        var url = await uploadImage(file, "cover");
        urlIn.value = url;
        state.dirty = true;
        show(url);
        toast("Cover uploaded. Save to keep it.");
      } catch (e) {
        show(urlIn.value);
        toast((e && e.message) || "Couldn’t upload the image.");
      } finally {
        URL.revokeObjectURL(local);
        drop.classList.remove("is-busy");
        submit.disabled = false;
      }
    }
    drop.addEventListener("click", function () { input.click(); });
    drop.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
    input.addEventListener("change", function () { take(input.files && input.files[0]); input.value = ""; });
    ["dragenter", "dragover"].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("is-over"); });
    });
    ["dragleave", "dragend"].forEach(function (t) {
      drop.addEventListener(t, function () { drop.classList.remove("is-over"); });
    });
    drop.addEventListener("drop", function (e) {
      e.preventDefault();
      drop.classList.remove("is-over");
      var f = imageFiles(e.dataTransfer)[0];
      if (f) take(f); else toast("Drop an image file (JPG, PNG or WebP).");
    });
    urlIn.addEventListener("change", function () { show(urlIn.value.trim()); });
  }

  function openBookForm(book) {
    leaveEditor();
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
      esc(book ? book.author || "" : state.canSell ? "LadyySol" : myPenName()) +
      '"></label>' +
      '<label>Genre<input name="genre" maxlength="80" value="' +
      esc(book ? book.genre || "Romance" : "Romance") +
      '"></label>' +
      (state.canSell
        ? '<label>Full-book price (₱)<input name="price" type="number" min="1" step="1" value="' +
          esc(book && book.price != null ? book.price : 150) +
          '"></label>'
        : '<p class="author-note">Your story is free for everyone to read.</p>') +
      coverField(book) +
      '<label>Description<textarea name="description" rows="5" maxlength="4000">' +
      esc(book ? book.description || "" : "") +
      "</textarea></label>" +
      detailsFields(book) +
      '<div class="author-form-actions">' +
      '<button type="submit" class="author-btn primary">' +
      (isNew ? "Create novel" : "Save changes") +
      "</button>" +
      "</div></form>";

    var form = document.getElementById("authorBookForm");
    form.addEventListener("input", function () {
      state.dirty = true;
    });
    wireCoverField(form);
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
          p_price: state.canSell ? Number(fd.get("price")) || 150 : 0
        });
        if (res.error) throw res.error;
        var savedId = (res.data && res.data.id) || (book && book.id);
        if (savedId && form.querySelector('[name="status"]')) {
          var det = await sb.rpc("author_set_book_details", {
            p_book_id: savedId,
            p_status: String(fd.get("status") || "ongoing"),
            p_is_mature: fd.get("is_mature") === "on",
            p_warnings: String(fd.get("warnings") || "").split(",").map(function (w) { return w.trim(); }).filter(Boolean),
            p_schedule: String(fd.get("schedule") || "").trim()
          });
          if (det.error) {
            console.warn("Story details not saved:", det.error);
            toast("Saved, but status / warnings need sql/03_app_features.sql first.");
          }
        }
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
    leaveEditor();
    state.view = "chapters";
    saveView({ view: "chapters", bookId: bookId });
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
        '" data-ch="' +
        esc(c.id) +
        '"><div class="ac-row">' +
        '<button type="button" class="ac-toggle" data-action="toggle-chapter" data-id="' +
        esc(c.id) +
        '" aria-expanded="false" aria-label="Show chapter details" title="Show details">' +
        ICON_CHEV +
        "</button>" +
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
        '</div></div><div class="ac-details" hidden></div></li>';
    });
    html += "</ul>";
    bodyEl.innerHTML = html;
  }

  /* ---------- chapter row dropdown: excerpt + quick actions ---------- */

  function detailsHtml(c, text, words) {
    var draft = c.status === "draft";
    text = String(text || "").replace(/\*/g, "");
    var excerpt = text ? text.slice(0, 320) + (text.length > 320 ? "…" : "") : "";
    var when = "";
    try {
      when = c.updated_at ? new Date(c.updated_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "";
    } catch (e) {}
    var meta = [];
    if (words != null) meta.push(words.toLocaleString() + (words === 1 ? " word" : " words"));
    meta.push(draft ? "Draft" : "Published");
    if (when) meta.push("Edited " + when);
    return (
      '<p class="ac-excerpt">' + (excerpt ? esc(excerpt) : "<em>No text yet.</em>") + "</p>" +
      '<p class="ac-meta">' + esc(meta.join(" · ")) + "</p>" +
      '<div class="ac-quick">' +
      '<button type="button" class="author-btn small" data-action="edit-chapter" data-id="' + esc(c.id) + '">Edit</button>' +
      '<button type="button" class="author-btn small" data-action="preview-chapter" data-id="' + esc(c.id) + '">Preview</button>' +
      (draft
        ? '<button type="button" class="author-btn small primary" data-action="publish" data-id="' + esc(c.id) + '">Publish</button>'
        : '<button type="button" class="author-btn small ghost" data-action="unpublish" data-id="' + esc(c.id) + '">Unpublish</button>') +
      "</div>"
    );
  }

  async function toggleChapter(id) {
    var li = bodyEl.querySelector('.author-chapter-item[data-ch="' + String(id).replace(/"/g, "") + '"]');
    if (!li) return;
    var det = li.querySelector(".ac-details");
    var btn = li.querySelector(".ac-toggle");
    var open = det.hidden;
    det.hidden = !open;
    li.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("title", open ? "Hide details" : "Show details");
    if (!open || det.getAttribute("data-loaded")) return;

    var c = state.chapters.find(function (x) {
      return String(x.id) === String(id);
    });
    if (!c) return;

    /* show the short preview we already have, then swap in the real numbers */
    det.innerHTML = detailsHtml(c, plainText(c.content_preview), null);
    try {
      var res = await sb.rpc("author_get_chapter", { p_chapter_id: id });
      if (res.error) throw res.error;
      var row = (res.data && res.data[0]) || res.data || null;
      if (Array.isArray(row)) row = row[0];
      if (row) {
        var text = plainText(row.content);
        det.innerHTML = detailsHtml(c, text, countWords(text));
        det.setAttribute("data-loaded", "1");
      }
    } catch (e) {
      console.error(e);
    }
  }

  /* =========================================================
     FULL-PAGE CHAPTER EDITOR  (Wattpad-style, dark)
     - top bar: back, cover, book + chapter title, status/word count,
       Publish, Cancel, and a ⋯ menu (settings, unpublish, delete)
     - faded book-cover banner at the top of the page
     - live word count, autosave (drafts), bold / italic

     STORAGE FORMAT: chapters stay "text with newlines" (the reader shows
     them with white-space:pre-wrap) plus inline <strong>/<em>/<u>.
     Old plain-text chapters open and save unchanged.
  ========================================================= */

  var ed = null; /* the editor session that is open right now */

  var ICON_PREV = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  var ICON_NEXT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
  var ICON_DOWN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  var ICON_BACK =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  var ICON_MORE =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
  var ICON_GEAR =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

  var ICON_CHEV =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  var ICON_PALETTE =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.5-1-1.7-1-3 0-1 .8-2 2-2h2.5a3.5 3.5 0 0 0 3.5-3.5C21 6.5 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/></svg>';

  /* page backgrounds for the writing page (same palette family as the reader) */
  var THEMES = [
    { id: "night", name: "Dark", color: "#08050b" },
    { id: "paper", name: "Paper", color: "#fbf9f4" },
    { id: "beige", name: "Beige", color: "#f4ecd8" },
    { id: "midnight", name: "Midnight", color: "#0e1a33" },
    { id: "forest", name: "Forest", color: "#10231a" },
    { id: "sunset", name: "Sunset", color: "#2a1230" }
  ];
  var THEME_KEY = "sol_author_theme";

  function getTheme() {
    var t = null;
    try {
      t = localStorage.getItem(THEME_KEY);
    } catch (e) {}
    return THEMES.some(function (x) { return x.id === t; }) ? t : "night";
  }

  function applyTheme(id, save) {
    if (!modal) return;
    modal.setAttribute("data-ae-theme", id);
    if (save) {
      try {
        localStorage.setItem(THEME_KEY, id);
      } catch (e) {}
    }
    if (ed) {
      ed.root.querySelectorAll(".ae-swatch").forEach(function (b) {
        var on = b.getAttribute("data-theme") === id;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
  }

  /* plain text of stored chapter html, without ever running it */
  function plainText(html) {
    var doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  }

  /* only ever use a cover URL that is a normal web / data image address */
  function safeCover(url) {
    url = String(url || "").trim();
    return /^(https?:\/\/|\/|images\/|data:image\/)/i.test(url) ? url : "";
  }

  function currentBookInfo() {
    return (
      state.books.find(function (b) {
        return String(b.id) === String(state.bookId);
      }) || {}
    );
  }

  /* ---------- editor DOM  <->  stored text ---------- */

  function escText(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* Tags we keep exactly as they are (and never re-flow with newlines). */
  var OPAQUE = /^(p|h[1-6]|blockquote|ul|ol|hr|img|a|s|sub|sup)$/;

  function toStored(root) {
    var out = "";

    function endsNl() {
      return out.charAt(out.length - 1) === "\n";
    }

    function inlineStyle(el) {
      var st = (el.getAttribute("style") || "").toLowerCase();
      return {
        b: /font-weight\s*:\s*(bold|[6-9]00)/.test(st),
        i: /font-style\s*:\s*italic/.test(st),
        u: /text-decoration[^;]*underline/.test(st)
      };
    }

    function walk(node) {
      node.childNodes.forEach(function (n) {
        if (n.nodeType === 3) {
          out += escText(n.nodeValue.replace(/ /g, " "));
          return;
        }
        if (n.nodeType !== 1) return;
        if (n.classList && n.classList.contains("ae-img-uploading")) return;
        var tag = n.tagName.toLowerCase();

        if (tag === "br") {
          out += "\n";
        } else if (OPAQUE.test(tag)) {
          out += n.outerHTML.replace(/ /g, " ");
        } else if (tag === "div" || tag === "li") {
          if (out && !endsNl()) out += "\n";
          walk(n);
          if (out && !endsNl()) out += "\n";
        } else {
          var st = inlineStyle(n);
          var bold = tag === "strong" || tag === "b" || st.b;
          var ital = tag === "em" || tag === "i" || st.i;
          var under = tag === "u" || st.u;
          if (bold) out += "<strong>";
          if (ital) out += "<em>";
          if (under) out += "<u>";
          walk(n);
          if (under) out += "</u>";
          if (ital) out += "</em>";
          if (bold) out += "</strong>";
        }
      });
    }

    walk(root);

    /* tidy: drop empty tags the browser leaves behind, trim edge blank lines */
    var prev;
    do {
      prev = out;
      out = out.replace(/<(strong|em|u)>(\s*)<\/\1>/g, "$2");
    } while (out !== prev);
    out = out.replace(/^\n+/, "").replace(/\s+$/, "");

    if (typeof sanitizeChapterHtml === "function") out = sanitizeChapterHtml(out);
    return out;
  }

  function toEditorHtml(stored) {
    if (!stored) return "";
    return typeof sanitizeChapterHtml === "function" ? sanitizeChapterHtml(stored) : esc(stored);
  }

  function countWords(text) {
    var m = String(text || "").trim().match(/\S+/g);
    return m ? m.length : 0;
  }

  function fmtTime(d) {
    try {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  /* ---------- local safety copy (survives refresh / crash) ---------- */

  function bkKey(session) {
    return "sol_author_draft:" + (session.id || "new:" + state.bookId);
  }
  function readBackup(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (e) {
      return null;
    }
  }
  function clearBackup(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  }
  function writeBackup() {
    if (!ed) return;
    try {
      var f = readFields();
      localStorage.setItem(
        bkKey(ed),
        JSON.stringify({ t: Date.now(), title: f.title, content: f.content, number: f.number })
      );
    } catch (e) {}
  }

  /* ---------- reading the page ---------- */

  function readFields() {
    var r = ed.root;
    var free = r.querySelector("#aeFree").checked;
    return {
      number: Number(r.querySelector("#aeNumber").value) || 0,
      title: r.querySelector("#aeTitle").value.trim(),
      content: toStored(ed.body),
      text: ed.body.innerText || "",
      isFree: free,
      price: free ? 0 : Math.max(0, Number(r.querySelector("#aePrice").value) || 0),
      version: ed.version
    };
  }

  function extractId(data) {
    if (!data) return null;
    if (typeof data === "string") return data;
    if (Array.isArray(data)) return extractId(data[0]);
    if (typeof data === "object") return data.id || data.chapter_id || null;
    return null;
  }

  /* ---------- status line / buttons ---------- */

  function setSaveText(txt) {
    var el = ed && ed.root.querySelector("#aeSaved");
    if (el) el.textContent = txt;
  }

  function refreshUi() {
    if (!ed) return;
    var r = ed.root;
    var published = ed.status === "published";
    r.querySelector("#aeState").textContent = published ? "Published" : "Draft";
    r.querySelector("#aeState").classList.toggle("is-live", published);
    r.querySelector("#aePublish").textContent = published ? "Publish Changes" : "Publish";
    r.querySelector('[data-action="ed-unpublish"]').hidden = !(published && ed.id);
    r.querySelector('[data-action="ed-save-draft"]').hidden = published;
    r.querySelector('[data-action="ed-delete"]').hidden = !ed.id;

    var num = r.querySelector("#aeNumber").value || "?";
    var title = r.querySelector("#aeTitle").value.trim();
    r.querySelector("#aeTopTitle").textContent = title ? "Ch. " + num + " · " + title : "Chapter " + num;
    refreshNav(num);
    r.querySelector("#aeChip").firstChild.nodeValue =
      "Ch. " + num + " · " + (r.querySelector("#aeFree").checked ? "Free" : "₱" + (r.querySelector("#aePrice").value || 0)) + " ";
  }

  function refreshWords() {
    if (!ed) return;
    var n = countWords(ed.body.innerText);
    ed.root.querySelector("#aeWords").textContent = n.toLocaleString() + (n === 1 ? " word" : " words");
    var empty = !ed.body.textContent.trim() && !ed.body.querySelector("img,hr");
    ed.body.classList.toggle("is-empty", empty);
  }

  function refreshFormatButtons() {
    if (!ed) return;
    var sel = window.getSelection();
    var inside = sel && sel.rangeCount && ed.body.contains(sel.anchorNode);
    ["bold", "italic"].forEach(function (cmd) {
      var btn = ed.root.querySelector('[data-fmt="' + cmd + '"]');
      var on = false;
      try {
        on = !!(inside && document.queryCommandState(cmd));
      } catch (e) {}
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function closePops() {
    if (!ed) return false;
    var any = false;
    var menu = ed.root.querySelector("#aeMenu");
    var sheet = ed.root.querySelector("#aeSheet");
    if (!menu.hidden) {
      menu.hidden = true;
      ed.root.querySelector("#aeMenuBtn").setAttribute("aria-expanded", "false");
      any = true;
    }
    if (!sheet.hidden) {
      sheet.hidden = true;
      any = true;
    }
    var toc = ed.root.querySelector("#aeToc");
    if (toc && !toc.hidden) {
      toc.hidden = true;
      ed.root.querySelector("#aeTocBtn").setAttribute("aria-expanded", "false");
      any = true;
    }
    var themes = ed.root.querySelector("#aeThemes");
    if (themes && !themes.hidden) {
      themes.hidden = true;
      any = true;
    }
    return any;
  }

  /* ---------- Write / Preview ---------- */

  /* Split view: drag the divider (or use arrow keys) to size the panes;
     the size is remembered. The preview follows the writing pane's scroll. */
  var SPLIT_KEY = "solEditorSplit";
  function initSplit(root) {
    var page = root.querySelector(".ae-page");
    var div = root.querySelector("#aeDivider");
    var write = root.querySelector("#aeWrite");
    var pv = root.querySelector("#aePreview");
    var pct = 50;
    try { pct = Number(localStorage.getItem(SPLIT_KEY)) || 50; } catch (e) {}
    function apply(v, save) {
      pct = Math.max(15, Math.min(85, v));
      page.style.setProperty("--ae-left", pct + "%");
      div.setAttribute("aria-valuenow", String(Math.round(pct)));
      if (save) { try { localStorage.setItem(SPLIT_KEY, String(Math.round(pct))); } catch (e) {} }
    }
    apply(pct, false);
    div.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      div.setPointerCapture(e.pointerId);
      root.classList.add("is-resizing");
      var box = page.getBoundingClientRect();
      function move(ev) { apply(((ev.clientX - box.left) / box.width) * 100, false); }
      function up() {
        div.removeEventListener("pointermove", move);
        div.removeEventListener("pointerup", up);
        div.removeEventListener("pointercancel", up);
        root.classList.remove("is-resizing");
        apply(pct, true);
      }
      div.addEventListener("pointermove", move);
      div.addEventListener("pointerup", up);
      div.addEventListener("pointercancel", up);
    });
    div.addEventListener("dblclick", function () { apply(50, true); });
    div.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { apply(pct - 5, true); e.preventDefault(); }
      else if (e.key === "ArrowRight") { apply(pct + 5, true); e.preventDefault(); }
    });
    write.addEventListener("scroll", function () {
      if (!ed || ed.mode !== "split") return;
      var max = write.scrollHeight - write.clientHeight;
      pv.scrollTop = max > 0 ? (write.scrollTop / max) * (pv.scrollHeight - pv.clientHeight) : 0;
    }, { passive: true });
    /* phone rotated / window narrowed: drop back to Write */
    window.addEventListener("resize", function () {
      if (ed && ed.mode === "split" && !canSplit()) setMode("write");
    });
  }

  /* Split (Write | Preview side by side) needs room; phones keep the tabs. */
  function canSplit() { return window.matchMedia("(min-width: 900px)").matches; }

  function renderPreview() {
    if (!ed) return;
    var r = ed.root;
    {
      var f = readFields();
      var hasText = f.text.trim().length > 0;
      var shown = hasText
        ? typeof formatChapterContent === "function"
          ? formatChapterContent(f.content)
          : toEditorHtml(f.content)
        : "<em>Nothing to preview yet.</em>";
      r.querySelector("#aePreview").innerHTML =
        '<p class="ae-pv-num">Chapter ' + esc(f.number || "?") + "</p>" +
        '<h1 class="ae-pv-title">' + esc(f.title || "Untitled") + "</h1>" +
        '<div class="ae-pv-body">' + shown + "</div>" +
        '<p class="ae-pv-foot">This is how readers will see it.</p>';
    }
  }

  var pvTimer = null;
  function livePreview() {
    if (!ed || ed.mode !== "split") return;
    clearTimeout(pvTimer);
    pvTimer = setTimeout(renderPreview, 250);
  }

  function setMode(mode) {
    if (!ed) return;
    var r = ed.root;
    closePops();
    if (mode === "split" && !canSplit()) mode = "write";
    if (mode === "preview" || mode === "split") renderPreview();
    ed.mode = mode;
    r.classList.toggle("is-preview", mode === "preview");
    r.classList.toggle("is-split", mode === "split");
    r.querySelectorAll(".ae-mode-btn").forEach(function (b) {
      var on = b.getAttribute("data-mode") === mode;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var sc = r.querySelector("#aeScroll");
    if (sc) sc.scrollTop = 0;
    persistEditor();
    if (mode !== "preview") ed.body.focus({ preventScroll: true });
  }

  /* ---------- saving ---------- */

  function onEdit() {
    if (!ed) return;
    ed.version++;
    state.dirty = true;
    setSaveText(ed.status === "published" ? "Changes not published yet" : "Unsaved changes");
    refreshWords();

    clearTimeout(ed.backupTimer);
    ed.backupTimer = setTimeout(writeBackup, 500);

    /* Drafts autosave to the server. A PUBLISHED chapter is never
       autosaved (that would change what readers see): it only keeps a
       copy on this device until the writer presses Publish Changes. */
    clearTimeout(ed.saveTimer);
    if (ed.status === "draft" && !ed.noAuto) {
      ed.saveTimer = setTimeout(function () {
        saveChapter("draft", { auto: true });
      }, 2500);
    }
  }

  function saveChapter(status, opts) {
    if (!ed) return Promise.resolve(false);
    var session = ed;
    session.queue = (session.queue || Promise.resolve()).then(function () {
      return doSave(session, status, opts || {});
    });
    return session.queue;
  }

  async function doSave(session, status, opts) {
    if (ed !== session) return false;
    clearTimeout(session.saveTimer);

    var f = readFields();
    if (f.number < 1) {
      if (!opts.auto) toast("Chapter number must be 1 or more.");
      return false;
    }
    if (status === "published" && !f.text.trim()) {
      toast("Write something before you publish.");
      return false;
    }
    /* never create an empty draft row by autosave */
    if (opts.auto && !f.text.trim() && !f.title) return false;

    var publishBtn = session.root.querySelector("#aePublish");
    if (!opts.auto) publishBtn.disabled = true;
    setSaveText(status === "published" ? "Publishing…" : "Saving…");

    try {
      /* never wait forever: if the request stalls, keep the text and say so */
      var res = await Promise.race([
        sb.rpc("author_upsert_chapter", {
          p_id: session.id,
          p_book_id: state.bookId,
          p_chapter_number: f.number,
          p_title: f.title,
          p_content: f.content,
          p_is_free: f.isFree,
          p_price: f.price,
          p_status: status
        }),
        new Promise(function (_, reject) {
          setTimeout(function () {
            reject(new Error("Saving is taking too long. Your text is still here - please try again."));
          }, 25000);
        })
      ]);
      if (res.error) throw res.error;
      if (ed !== session) return true;

      var wasNew = !session.id;
      var id = extractId(res.data);
      if (!id && wasNew) {
        /* the server didn't hand back an id: find the row we just made */
        try {
          var list = await sb.rpc("author_list_chapters", { p_book_id: state.bookId });
          var hit = ((list && list.data) || []).find(function (c) {
            return Number(c.chapter_number) === f.number;
          });
          id = hit && hit.id;
        } catch (e) {}
      }
      if (wasNew) clearBackup(bkKey(session));
      if (id) session.id = id;
      else if (!session.id) session.noAuto = true; /* can't safely autosave without an id */
      if (ed === session) persistEditor();

      session.status = status;
      if (session.version === f.version) {
        state.dirty = false;
        clearBackup(bkKey(session));
        setSaveText("Saved " + fmtTime(new Date()));
      } else {
        /* the writer kept typing while we saved */
        onEdit();
      }
      refreshUi();

      if (!opts.auto && typeof window.loadBooks === "function") {
        try {
          window.loadBooks();
        } catch (e) {}
      }
      return true;
    } catch (err) {
      console.error(err);
      if (ed === session) {
        setSaveText(opts.auto ? "Autosave failed - copy kept on this device" : "Not saved");
        writeBackup();
        if (!opts.auto) toast((err && err.message) || "Couldn’t save the chapter.");
      }
      return false;
    } finally {
      if (ed === session) publishBtn.disabled = false;
    }
  }

  async function edPublish() {
    if (!ed) return;
    var was = ed.status;
    var ok = await saveChapter("published");
    if (ok) toast(was === "published" ? "Changes published." : "Chapter published.");
  }

  /* unsaved work before leaving this chapter: drafts autosave, published asks */
  async function okToLeave() {
    if (!ed || !state.dirty) return true;
    if (ed.status === "draft") {
      var f = readFields();
      if (f.text.trim() || f.title) {
        var ok = await saveChapter("draft", { auto: true });
        if (!ok && !confirm("Couldn’t save your latest changes. Leave anyway? (A copy is kept on this device.)")) return false;
      }
      return true;
    }
    return confirm("You have changes that aren’t published yet. Leave without publishing them?");
  }

  /* ---------- chapter navigation: ‹ Ch. N ▾ › ---------- */
  function sortedChapters() {
    return state.chapters.slice().sort(function (a, b) { return a.chapter_number - b.chapter_number; });
  }
  function navIndex(list) {
    if (!ed || !ed.id) return -1;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(ed.id)) return i;
    return -1;
  }
  function neighbour(step) {
    var list = sortedChapters();
    var i = navIndex(list);
    if (i === -1) return step < 0 ? list[list.length - 1] || null : null; /* new chapter: ‹ goes to the last one */
    return list[i + step] || null;
  }
  function refreshNav(num) {
    if (!ed) return;
    var r = ed.root;
    var prev = neighbour(-1), next = neighbour(1);
    var pb = r.querySelector("#aePrev"), nb = r.querySelector("#aeNext");
    pb.disabled = !prev;
    nb.disabled = !next;
    pb.title = prev ? "Previous: Ch. " + prev.chapter_number : "No previous chapter";
    nb.title = next ? "Next: Ch. " + next.chapter_number : "No next chapter";
    r.querySelector("#aeTocLabel").textContent = "Ch. " + (num || "?");
  }
  function renderToc() {
    var r = ed.root, list = sortedChapters(), cur = navIndex(list);
    var toc = r.querySelector("#aeToc");
    if (!list.length) {
      toc.innerHTML = '<p class="ae-toc-empty">No other chapters yet.</p>';
      return;
    }
    toc.innerHTML = list.map(function (c, i) {
      var live = c.status === "published";
      return '<button type="button" role="menuitem" class="ae-toc-item' + (i === cur ? " is-current" : "") +
        '" data-action="ed-goto" data-id="' + esc(c.id) + '"' + (i === cur ? ' aria-current="true"' : "") + ">" +
        '<span class="ae-toc-num">' + esc(c.chapter_number) + "</span>" +
        '<span class="ae-toc-title">' + esc(c.title || "Chapter " + c.chapter_number) + "</span>" +
        '<span class="ae-toc-state' + (live ? " is-live" : "") + '">' + (live ? "Live" : "Draft") + "</span></button>";
    }).join("");
  }
  async function gotoChapter(id) {
    if (!ed || !id || String(id) === String(ed.id)) return closePops();
    closePops();
    if (!(await okToLeave())) return;
    var mode = ed.mode;
    state.dirty = false;
    await openEditor(id, { preview: mode === "preview", split: mode === "split" });
  }

  async function edBack() {
    if (!ed) return openChapters(state.bookId);
    if (state.dirty) {
      if (ed.status === "draft") {
        var f = readFields();
        if (f.text.trim() || f.title) {
          var ok = await saveChapter("draft", { auto: true });
          if (!ok && !confirm("Couldn’t save your latest changes. Leave anyway? (A copy is kept on this device.)")) return;
        }
      } else if (!confirm("You have changes that aren’t published yet. Leave without publishing them?")) {
        return;
      }
    }
    state.dirty = false;
    openChapters(state.bookId);
  }

  function edCancel() {
    if (!ed) return openChapters(state.bookId);
    if (state.dirty && !confirm("Discard your changes since the last save?")) return;
    clearBackup(bkKey(ed));
    state.dirty = false;
    openChapters(state.bookId);
  }

  async function edUnpublish() {
    if (!ed || !ed.id) return;
    closePops();
    try {
      var res = await sb.rpc("author_set_chapter_status", { p_chapter_id: ed.id, p_status: "draft" });
      if (res.error) throw res.error;
      ed.status = "draft";
      toast("Moved to drafts. Readers can no longer see it.");
      refreshUi();
      if (typeof window.loadBooks === "function") {
        try {
          window.loadBooks();
        } catch (e) {}
      }
      if (state.dirty) onEdit(); /* start autosaving any pending edits as a draft */
    } catch (e) {
      console.error(e);
      toast((e && e.message) || "Couldn’t unpublish.");
    }
  }

  async function edDelete() {
    if (!ed) return;
    closePops();
    if (!confirm("Delete this chapter permanently? This cannot be undone.")) return;
    try {
      if (ed.id) {
        var res = await sb.rpc("author_delete_chapter", { p_chapter_id: ed.id });
        if (res.error) throw res.error;
      }
      clearBackup(bkKey(ed));
      state.dirty = false;
      toast("Chapter deleted.");
      if (typeof window.loadBooks === "function") {
        try {
          window.loadBooks();
        } catch (e) {}
      }
      openChapters(state.bookId);
    } catch (e) {
      console.error(e);
      toast((e && e.message) || "Couldn’t delete.");
    }
  }

  /* ---------- building the page ---------- */

  async function openEditor(chapterId, opts) {
    opts = opts || {};
    leaveEditor();
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

    var book = currentBookInfo();
    var cover = safeCover(book.cover_url);
    var isFree = !state.canSell || (existing ? !!existing.is_free : nextNum <= 5);
    var status = existing ? existing.status || "draft" : "draft";

    /* full-screen mode: hide the studio's normal heading */
    modal.classList.add("is-editor");
    modal.setAttribute("data-ae-theme", getTheme());
    headActions("");

    bodyEl.innerHTML =
      '<div class="ae" id="aeRoot">' +
      '<header class="ae-top">' +
      '<button type="button" class="ae-icon" data-action="ed-back" aria-label="Back to chapters" title="Back to chapters">' +
      ICON_BACK +
      "</button>" +
      '<div class="ae-cover" id="aeCover" aria-hidden="true"></div>' +
      '<div class="ae-meta">' +
      '<div class="ae-book">' +
      esc(book.title || "Your novel") +
      "</div>" +
      '<div class="ae-chtitle" id="aeTopTitle"></div>' +
      '<div class="ae-status" aria-live="polite"><span id="aeState" class="ae-pill"></span>' +
      '<span class="ae-dot">·</span><span id="aeWords">0 words</span>' +
      '<span class="ae-dot">·</span><span id="aeSaved"></span></div>' +
      "</div>" +
      '<div class="ae-actions">' +
      '<div class="ae-nav" role="group" aria-label="Chapters">' +
      '<button type="button" class="ae-icon ae-nav-btn" id="aePrev" data-action="ed-prev" aria-label="Previous chapter" title="Previous chapter">' + ICON_PREV + "</button>" +
      '<div class="ae-toc-wrap">' +
      '<button type="button" class="ae-toc-btn" id="aeTocBtn" aria-haspopup="menu" aria-expanded="false" title="All chapters">' +
      '<span id="aeTocLabel">Ch. ?</span>' + ICON_DOWN + "</button>" +
      '<div class="ae-menu ae-toc" id="aeToc" role="menu" aria-label="Chapters" hidden></div>' +
      "</div>" +
      '<button type="button" class="ae-icon ae-nav-btn" id="aeNext" data-action="ed-next" aria-label="Next chapter" title="Next chapter">' + ICON_NEXT + "</button>" +
      "</div>" +
      '<button type="button" class="author-btn primary ae-publish" id="aePublish" data-action="ed-publish">Publish</button>' +
      '<button type="button" class="author-btn ghost ae-cancel" data-action="ed-cancel">Cancel</button>' +
      '<div class="ae-menu-wrap">' +
      '<button type="button" class="ae-icon" id="aeMenuBtn" aria-haspopup="menu" aria-expanded="false" aria-label="More options" title="More options">' +
      ICON_MORE +
      "</button>" +
      '<div class="ae-menu" id="aeMenu" role="menu" hidden>' +
      '<button type="button" role="menuitem" data-action="ed-settings">Chapter settings</button>' +
      '<button type="button" role="menuitem" data-action="ed-save-draft">Save draft</button>' +
      '<button type="button" role="menuitem" data-action="ed-unpublish">Unpublish (move to drafts)</button>' +
      '<button type="button" role="menuitem" class="danger" data-action="ed-delete">Delete chapter</button>' +
      "</div></div></div></header>" +
      '<div class="ae-scroll" id="aeScroll">' +
      '<div class="ae-banner" id="aeBanner" aria-hidden="true"></div>' +
      '<div class="ae-page">' +
      '<div class="ae-toolbar" role="toolbar" aria-label="Formatting">' +
      '<button type="button" class="ae-fmt" data-fmt="bold" aria-label="Bold" title="Bold (Ctrl/Cmd+B)"><b>B</b></button>' +
      '<button type="button" class="ae-fmt" data-fmt="italic" aria-label="Italic" title="Italic (Ctrl/Cmd+I)"><i>I</i></button>' +
      '<button type="button" class="ae-fmt ae-img-btn" id="aeImgBtn" aria-label="Insert image" title="Insert image (or drag one into the page)"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg></button>' +
      '<input type="file" id="aeImgFile" accept="image/jpeg,image/png,image/webp" hidden multiple>' +
      '<span class="ae-sep" aria-hidden="true"></span>' +
      '<div class="ae-mode" role="group" aria-label="View">' +
      '<button type="button" class="ae-mode-btn on" data-action="ed-mode" data-mode="write" aria-pressed="true">Write</button>' +
      '<button type="button" class="ae-mode-btn ae-mode-split" data-action="ed-mode" data-mode="split" aria-pressed="false" title="Write and preview side by side">Split</button>' +
      '<button type="button" class="ae-mode-btn" data-action="ed-mode" data-mode="preview" aria-pressed="false">Preview</button>' +
      "</div>" +
      '<span class="ae-grow"></span>' +
      '<button type="button" class="ae-fmt ae-themebtn" data-action="ed-theme" aria-label="Page background" title="Page background">' +
      ICON_PALETTE +
      "</button>" +
      '<button type="button" class="ae-chip" id="aeChip" data-action="ed-settings" title="Chapter settings">x ' +
      ICON_GEAR +
      "</button>" +
      "</div>" +
      '<div class="ae-write" id="aeWrite">' +
      '<input class="ae-title" id="aeTitle" maxlength="200" placeholder="Chapter title" autocomplete="off" aria-label="Chapter title">' +
      '<div class="ae-body is-empty" id="aeBody" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Chapter text" spellcheck="true" data-placeholder="Write your chapter here…"></div>' +
      "</div>" +
      '<div class="ae-divider" id="aeDivider" role="separator" aria-orientation="vertical" aria-label="Resize write and preview" tabindex="0" title="Drag to resize. Double-click to reset."><span></span></div>' +
      '<div class="ae-preview" id="aePreview" aria-live="polite"></div>' +
      "</div></div>" +
      '<div class="ae-sheet" id="aeSheet" role="dialog" aria-label="Chapter settings" hidden>' +
      "<h3>Chapter settings</h3>" +
      '<label>Chapter #<input id="aeNumber" type="number" min="1" required></label>' +
      (state.canSell
        ? '<label class="check"><input id="aeFree" type="checkbox"> Free chapter</label>' +
          '<label>Price ₱<input id="aePrice" type="number" min="0" step="1"></label>'
        : '<p class="author-note">Every chapter is free to read.</p>' +
          '<input id="aeFree" type="checkbox" hidden checked disabled><input id="aePrice" type="number" hidden disabled value="0">') +
      '<button type="button" class="author-btn small primary" data-action="ed-settings-done">Done</button>' +
      "</div>" +
      '<div class="ae-sheet ae-themes" id="aeThemes" role="dialog" aria-label="Page background" hidden>' +
      "<h3>Page background</h3>" +
      '<div class="ae-swatches">' +
      THEMES.map(function (t) {
        return (
          '<button type="button" class="ae-swatch" data-action="ed-theme-pick" data-theme="' + t.id +
          '" aria-pressed="false" style="--sw:' + t.color + '"><span class="ae-sw-dot"></span><span>' + t.name + "</span></button>"
        );
      }).join("") +
      "</div></div></div>";

    var root = document.getElementById("aeRoot");
    var body = root.querySelector("#aeBody");
    var titleIn = root.querySelector("#aeTitle");
    var numIn = root.querySelector("#aeNumber");
    var freeIn = root.querySelector("#aeFree");
    var priceIn = root.querySelector("#aePrice");

    ed = {
      root: root,
      body: body,
      id: existing ? existing.id : null,
      status: status,
      version: 0,
      mode: "write",
      noAuto: false,
      queue: null,
      saveTimer: null,
      backupTimer: null
    };

    /* cover: thumbnail in the top bar + faded banner above the page */
    if (cover) {
      var img = document.createElement("img");
      img.alt = "";
      img.src = cover;
      root.querySelector("#aeCover").appendChild(img);
      root.querySelector("#aeBanner").style.setProperty("--cover", "url(" + JSON.stringify(cover) + ")");
      root.querySelector("#aeBanner").classList.add("has-cover");
    } else {
      root.querySelector("#aeCover").textContent = (book.title || "S").trim().charAt(0).toUpperCase();
    }

    /* fill in the values */
    titleIn.value = existing ? existing.title || "" : "";
    numIn.value = existing ? existing.chapter_number : nextNum;
    freeIn.checked = isFree;
    priceIn.value = !state.canSell ? 0 : existing && existing.price != null ? existing.price : isFree ? 0 : 10;
    priceIn.disabled = isFree;
    body.innerHTML = toEditorHtml(existing ? existing.content || "" : "");

    /* offer to bring back text that never reached the server */
    try {
      var bk = readBackup(bkKey(ed));
      if (bk) {
        var base = toStored(body);
        var differs = (bk.content || "") !== base || (bk.title || "") !== titleIn.value.trim();
        if (differs && (bk.content || bk.title) && confirm("We found unsaved changes from " + fmtTime(new Date(bk.t)) + " on this device. Restore them?")) {
          titleIn.value = bk.title || "";
          body.innerHTML = toEditorHtml(bk.content || "");
          if (bk.number) numIn.value = bk.number;
          state.dirty = true;
          ed.version = 1;
        } else {
          clearBackup(bkKey(ed));
        }
      }
    } catch (e) {}

    applyTheme(getTheme(), false);
    persistEditor();
    refreshUi();
    refreshWords();
    setSaveText(state.dirty ? "Restored - not saved yet" : existing ? "All changes saved" : "");

    /* ---- events ---- */
    body.addEventListener("input", onEdit);
    root.addEventListener("input", livePreview);
    root.addEventListener("change", livePreview);
    initSplit(root);
    titleIn.addEventListener("input", function () {
      refreshUi();
      onEdit();
    });
    numIn.addEventListener("input", function () {
      refreshUi();
      onEdit();
    });
    priceIn.addEventListener("input", function () {
      refreshUi();
      onEdit();
    });
    freeIn.addEventListener("change", function () {
      if (freeIn.checked) {
        priceIn.value = "0";
        priceIn.disabled = true;
      } else {
        priceIn.disabled = false;
        if (Number(priceIn.value) === 0) priceIn.value = "10";
      }
      refreshUi();
      onEdit();
    });

    /* Enter in the title jumps into the story */
    titleIn.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        body.focus();
      }
    });

    /* paste as plain text (keeps line breaks, drops foreign styling) */
    body.addEventListener("paste", function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData("text/plain") || "";
      text = text.replace(/\r\n?/g, "\n");
      if (!document.execCommand("insertText", false, text)) {
        var sel = window.getSelection();
        if (sel.rangeCount) {
          var rng = sel.getRangeAt(0);
          rng.deleteContents();
          var tn = document.createTextNode(text);
          rng.insertNode(tn);
          rng.setStartAfter(tn);
          rng.collapse(true);
          sel.removeAllRanges();
          sel.addRange(rng);
        }
        onEdit();
      }
    });
    /* pictures: toolbar button, drag into the page, or paste */
    var savedRange = null;
    function rememberCaret() {
      var sel = window.getSelection();
      if (sel && sel.rangeCount && body.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
    }
    function rangeAtPoint(x, y) {
      if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
      if (document.caretPositionFromPoint) {
        var p = document.caretPositionFromPoint(x, y);
        if (!p) return null;
        var r = document.createRange();
        r.setStart(p.offsetNode, p.offset);
        r.collapse(true);
        return r;
      }
      return null;
    }
    async function insertImages(files, range) {
      if (!files.length) return;
      if (!range || !body.contains(range.startContainer)) {
        range = document.createRange();
        range.selectNodeContents(body);
        range.collapse(false);
      }
      for (var i = 0; i < files.length; i++) {
        var holder = document.createElement("p");
        holder.className = "ae-img-uploading";
        holder.setAttribute("contenteditable", "false");
        holder.textContent = "Uploading image…";
        /* pictures sit on their own line */
        var block = range.startContainer;
        while (block && block !== body && block.parentNode !== body) block = block.parentNode;
        if (block && block !== body) {
          /* loose text in the page: keep the line whole, picture goes after it */
          var after = block;
          while (after.nodeType === 3 && after.nextSibling && after.nextSibling.nodeName !== "BR" && after.nextSibling.nodeType === 3) after = after.nextSibling;
          if (after.nextSibling && after.nextSibling.nodeName === "BR") after = after.nextSibling;
          body.insertBefore(holder, after.nextSibling);
        } else {
          var kids = body.childNodes, idx = range.startOffset;
          body.insertBefore(holder, kids[idx] || null);
        }
        try {
          var url = await uploadImage(files[i], "chapter");
          var p = document.createElement("p");
          var img = document.createElement("img");
          img.src = url;
          img.alt = "";
          p.appendChild(img);
          holder.replaceWith(p);
          range = document.createRange();
          range.setStartAfter(p);
          range.collapse(true);
        } catch (err) {
          holder.remove();
          toast((err && err.message) || "Couldn’t upload the image.");
          break;
        }
      }
      body.classList.remove("is-empty");
      onEdit();
    }
    body.addEventListener("keyup", rememberCaret);
    body.addEventListener("mouseup", rememberCaret);
    body.addEventListener("dragover", function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1) {
        e.preventDefault();
        body.classList.add("is-drop");
      }
    });
    body.addEventListener("dragleave", function () { body.classList.remove("is-drop"); });
    body.addEventListener("drop", function (e) {
      body.classList.remove("is-drop");
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      var files = imageFiles(e.dataTransfer);
      if (!files.length) return toast("Only images can be dropped here.");
      insertImages(files, rangeAtPoint(e.clientX, e.clientY));
    });
    body.addEventListener("paste", function (e) {
      var files = imageFiles(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      rememberCaret();
      insertImages(files, savedRange);
    }, true);
    var imgBtn = root.querySelector("#aeImgBtn");
    var imgFile = root.querySelector("#aeImgFile");
    imgBtn.addEventListener("mousedown", function (e) { e.preventDefault(); rememberCaret(); });
    imgBtn.addEventListener("click", function () { imgFile.click(); });
    imgFile.addEventListener("change", function () {
      var files = Array.prototype.slice.call(imgFile.files || []);
      imgFile.value = "";
      insertImages(files, savedRange);
    });

    /* formatting buttons: mousedown must not steal the selection */
    root.querySelectorAll(".ae-fmt[data-fmt]").forEach(function (btn) {
      btn.addEventListener("mousedown", function (e) {
        e.preventDefault();
      });
      btn.addEventListener("click", function () {
        body.focus();
        document.execCommand(btn.getAttribute("data-fmt"), false, null);
        onEdit();
        refreshFormatButtons();
      });
    });

    ed.onSel = function () {
      refreshFormatButtons();
    };
    document.addEventListener("selectionchange", ed.onSel);

    /* Ctrl/Cmd+S saves */
    root.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "s") {
        e.preventDefault();
        if (ed.status === "draft") saveChapter("draft");
        else {
          writeBackup();
          toast("Saved on this device. Press Publish Changes to update readers.");
        }
      }
    });

    /* chapters dropdown */
    var tocBtn = root.querySelector("#aeTocBtn");
    var toc = root.querySelector("#aeToc");
    tocBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = toc.hidden;
      closePops();
      if (!open) return;
      renderToc();
      toc.hidden = false;
      tocBtn.setAttribute("aria-expanded", "true");
      var cur = toc.querySelector(".is-current") || toc.querySelector("button");
      if (cur) { cur.scrollIntoView({ block: "center" }); cur.focus({ preventScroll: true }); }
    });

    /* ⋯ menu */
    var menuBtn = root.querySelector("#aeMenuBtn");
    var menu = root.querySelector("#aeMenu");
    menuBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = menu.hidden;
      closePops();
      menu.hidden = !open;
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        var first = menu.querySelector("button:not([hidden])");
        if (first) first.focus();
      }
    });
    root.addEventListener("click", function (e) {
      if (!e.target.closest(".ae-menu-wrap,.ae-toc-wrap,.ae-sheet,.ae-chip,.ae-themebtn")) closePops();
    });

    /* new chapter: start typing straight away */
    if (opts.preview) {
      setMode("preview");
    } else if (opts.split && canSplit()) {
      setMode("split");
    } else {
      setTimeout(function () {
        if (!ed) return;
        (existing ? body : titleIn).focus();
      }, 60);
    }
  }

  function leaveEditor() {
    if (ed) {
      clearTimeout(ed.saveTimer);
      clearTimeout(ed.backupTimer);
      document.removeEventListener("selectionchange", ed.onSel);
    }
    ed = null;
    if (modal) {
      modal.classList.remove("is-editor");
      modal.removeAttribute("data-ae-theme");
    }
  }

  /* warn before the tab is closed with unsaved text */
  window.addEventListener("beforeunload", function (e) {
    if (ed && state.dirty) {
      writeBackup();
      e.preventDefault();
      e.returnValue = "";
    }
  });

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
    else if (action === "open-reports") openReports();
    else if (action === "report-done") reportAction("admin_resolve_report", { p_report_id: id });
    else if (action === "report-hide") {
      var hide = t.getAttribute("data-on") === "1";
      reportAction("admin_set_book_hidden", { p_book_id: id, p_hidden: hide }, hide ? "Hide this book from all readers?" : null);
    } else if (action === "report-block") {
      var block = t.getAttribute("data-on") === "1";
      reportAction("admin_set_writer_blocked", { p_user_id: id, p_blocked: block },
        block ? "Block this writer? They can’t write any more and all their books are hidden." : "Unblock this writer? Their books stay hidden until you show them.");
    }
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
    else if (action === "preview-chapter") openEditor(id, { preview: true });
    else if (action === "toggle-chapter") toggleChapter(id);
    else if (action === "ed-mode") setMode(t.getAttribute("data-mode"));
    else if (action === "ed-theme") {
      var pop = ed && ed.root.querySelector("#aeThemes");
      if (pop) {
        var was = !pop.hidden;
        closePops();
        pop.hidden = was;
      }
    } else if (action === "ed-theme-pick") applyTheme(t.getAttribute("data-theme"), true);
    else if (action === "ed-back") edBack();
    else if (action === "ed-prev") { var pv = neighbour(-1); if (pv) gotoChapter(pv.id); }
    else if (action === "ed-next") { var nx = neighbour(1); if (nx) gotoChapter(nx.id); }
    else if (action === "ed-goto") gotoChapter(t.getAttribute("data-id"));
    else if (action === "ed-cancel") edCancel();
    else if (action === "ed-publish") edPublish();
    else if (action === "ed-save-draft") {
      closePops();
      saveChapter("draft");
    } else if (action === "ed-unpublish") edUnpublish();
    else if (action === "ed-delete") edDelete();
    else if (action === "ed-settings") {
      var sheet = ed && ed.root.querySelector("#aeSheet");
      if (sheet) {
        var wasOpen = !sheet.hidden;
        closePops();
        sheet.hidden = wasOpen;
        if (!wasOpen) sheet.querySelector("input").focus();
      }
    } else if (action === "ed-settings-done") closePops();
    else if (action === "publish") setStatus(id, "published");
    else if (action === "unpublish") setStatus(id, "draft");
    else if (action === "delete-chapter") deleteChapter(id);
  });

  /* the Write button: anyone signed in can open the studio */
  async function startWriting() {
    var user = typeof currentUser !== "undefined" ? currentUser : null;
    if (!user) {
      toast("Log in or create an account to start writing.");
      if (typeof openModal === "function") openModal("loginModal");
      return;
    }
    if (!state.canWrite) await checkCanWrite();
    if (!state.canWrite) {
      toast("Writing isn’t open for your account yet.");
      return;
    }
    openAuthor();
  }

  function myPenName() {
    var u = typeof currentUser !== "undefined" ? currentUser : null;
    var m = (u && u.user_metadata) || {};
    return String(m.display_name || (u && u.email ? u.email.split("@")[0] : "") || "").trim().slice(0, 120);
  }

  function injectNav() {
    var nav = document.querySelector(".main-nav");
    if (nav && !document.getElementById("authorNavButton")) {
      var btn = document.createElement("button");
      btn.id = "authorNavButton";
      btn.type = "button";
      btn.className = "nav-button hidden";
      btn.textContent = "Write";
      btn.addEventListener("click", function () {
        startWriting();
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
        startWriting();
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
      injectReportLink(bookId);
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
    btn.className = "author-edit-in-modal";
    btn.title = "Edit in Writer Studio";
    btn.setAttribute("aria-label", "Edit in Writer Studio");
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg><span>Edit</span>';
    btn.addEventListener("click", function () {
      if (typeof closeModal === "function") closeModal("bookModal");
      openAuthor();
      setTimeout(function () {
        openChapters(bookId);
      }, 50);
    });
    actions.appendChild(btn);
  }

  /* "Report this story" under the book page buttons (not on your own books) */
  function injectReportLink(bookId) {
    var actions = document.querySelector(".book-modal-actions");
    var old = document.getElementById("solReportLink");
    if (old) old.remove();
    if (!actions) return;
    var full = window.SolApp && window.SolApp.bookById ? window.SolApp.bookById(bookId) : null;
    var user = typeof currentUser !== "undefined" ? currentUser : null;
    if (full && user && full.owner_id && String(full.owner_id) === String(user.id)) return;
    var a = document.createElement("button");
    a.id = "solReportLink";
    a.type = "button";
    a.className = "sol-report-link";
    a.textContent = "Report this story";
    a.addEventListener("click", async function () {
      var u = typeof currentUser !== "undefined" ? currentUser : null;
      if (!u) {
        toast("Log in to report a story.");
        if (typeof openModal === "function") openModal("loginModal");
        return;
      }
      var reason = prompt("What’s wrong with this story? (e.g. stolen work, spam, harmful content)");
      if (reason == null) return;
      reason = String(reason).trim().slice(0, 500);
      if (!reason) return;
      a.disabled = true;
      try {
        var res = await sb.rpc("report_book", { p_book_id: bookId, p_reason: reason });
        if (res.error) throw res.error;
        toast("Thanks. Sol will review this story.");
        a.textContent = "Reported";
      } catch (e) {
        a.disabled = false;
        toast(/function|schema cache/i.test((e && e.message) || "") ? "Reporting isn’t available yet." : (e && e.message) || "Couldn’t send the report.");
      }
    });
    actions.insertAdjacentElement("afterend", a);
  }

  /* ---------- reports (Sol admins only) ---------- */
  async function openReports() {
    leaveEditor();
    state.view = "reports";
    setTitle("Reader reports");
    headActions('<button type="button" class="author-btn ghost" data-action="back-books">← Back</button>');
    bodyEl.innerHTML = '<p class="author-loading">Loading reports…</p>';
    try {
      var res = await sb.rpc("admin_list_reports");
      if (res.error) throw res.error;
      var rows = res.data || [];
      if (!rows.length) {
        bodyEl.innerHTML = '<div class="author-empty"><p>No open reports.</p></div>';
        return;
      }
      bodyEl.innerHTML = '<ul class="author-book-list sol-reports">' + rows.map(function (r) {
        return '<li class="author-book-item sol-report">' +
          '<div class="sol-report-main"><span class="ab-title">' + esc(r.book_title) + "</span>" +
          '<span class="ab-meta">by ' + esc(r.book_author || "Unknown") + " · " + esc(new Date(r.created_at).toLocaleDateString()) +
          (r.is_hidden ? " · hidden" : "") + (r.owner_blocked ? " · writer blocked" : "") + "</span>" +
          '<p class="sol-report-reason">' + esc(r.reason) + "</p></div>" +
          '<div class="sol-report-actions">' +
          '<button type="button" class="author-btn ghost small" data-action="report-hide" data-id="' + esc(r.book_id) + '" data-on="' + (r.is_hidden ? "0" : "1") + '">' + (r.is_hidden ? "Show book" : "Hide book") + "</button>" +
          '<button type="button" class="author-btn ghost small" data-action="report-block" data-id="' + esc(r.owner_id) + '" data-on="' + (r.owner_blocked ? "0" : "1") + '">' + (r.owner_blocked ? "Unblock writer" : "Block writer") + "</button>" +
          '<button type="button" class="author-btn small" data-action="report-done" data-id="' + esc(r.id) + '">Dismiss</button>' +
          "</div></li>";
      }).join("") + "</ul>";
    } catch (e) {
      console.error(e);
      bodyEl.innerHTML = '<p class="author-empty">Couldn’t load reports. Make sure sql/07 is installed.</p>';
    }
  }

  async function reportAction(fn, args, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    try {
      var res = await sb.rpc(fn, args);
      if (res.error) throw res.error;
      openReports();
    } catch (e) {
      toast((e && e.message) || "Couldn’t update.");
    }
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
    refresh: checkCanWrite,
    canWrite: function () { return !!state.canWrite; }
  };
})();
