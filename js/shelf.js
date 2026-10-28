/* Sol's Collection — Reading Journey shelf.
   Adds a row of "other stories you've opened" under the Continue Reading card.
   Load AFTER script.js:  <script src="js/shelf.js"></script>
   It reads script.js's own globals (books, currentUser, readLocalPositions, openReader...)
   and wraps a few functions; script.js itself is not edited. */
(() => {
  'use strict';
  const host = document.getElementById('continueReading');
  if (!host || typeof books === 'undefined' || typeof openReader !== 'function') return;

  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
.journey-shelf{max-width:450px;margin:22px auto 0}
.journey-shelf[hidden]{display:none}
.shelf-title{margin:0 0 12px;padding:0 2px;font:italic 500 20px/1.2 var(--font-display,"Bodoni Moda",Georgia,serif);color:var(--ivory,#f4ede4)}
.shelf-track{display:flex;gap:12px;margin:0;padding:2px 2px 10px;list-style:none;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.shelf-track::-webkit-scrollbar{display:none}
.shelf-track li{flex:0 0 220px;scroll-snap-align:start}
.shelf-card{display:flex;gap:12px;width:100%;height:100%;padding:10px;text-align:left;cursor:pointer;color:var(--ivory,#f4ede4);
  border:1px solid var(--border,rgba(255,226,214,.11));border-radius:16px;background:linear-gradient(170deg,rgba(255,255,255,.05),rgba(255,255,255,.012));
  transition:border-color .3s,box-shadow .4s,scale .3s cubic-bezier(.16,1,.3,1)}
.shelf-card:hover{border-color:rgba(255,106,77,.55);box-shadow:0 14px 40px rgba(224,39,79,.25)}
.shelf-card:active{scale:.97}
.shelf-card:focus-visible{outline:2px solid var(--ember,#ff6a4d);outline-offset:2px}
.shelf-cover{flex:0 0 52px;height:78px;border-radius:8px;overflow:hidden;display:grid;place-items:center;
  background:radial-gradient(circle,#e0274f 0%,#3a0716 60%,#070508 100%);color:var(--ember-hi,#ffb199);font:700 20px var(--font-display,Georgia,serif)}
.shelf-cover img{display:block;width:100%;height:100%;object-fit:cover}
.shelf-info{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:4px}
.shelf-name{font:500 15px/1.2 var(--font-serif,Georgia,serif);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.shelf-meta{font-size:12px;color:var(--muted,#b3a8a6)}
.shelf-bar{height:3px;margin-top:2px;border-radius:3px;overflow:hidden;background:rgba(255,255,255,.08)}
.shelf-bar i{display:block;height:100%;background:var(--brushed,linear-gradient(120deg,#ff3d5e,#ffb347));box-shadow:0 0 10px rgba(255,106,77,.5)}
@media(max-width:700px){
  .journey-shelf{max-width:none;margin-top:18px}
  .shelf-track{margin-inline:calc(var(--gutter,14px)*-1);padding-inline:var(--gutter,14px);scroll-padding-inline:var(--gutter,14px)}
  .shelf-track li{flex-basis:min(76vw,260px)}
  .shelf-card{min-height:96px}
}`;
  document.head.appendChild(css);

  /* ---------- markup ---------- */
  const shelf = document.createElement('div');
  shelf.className = 'journey-shelf';
  shelf.hidden = true;
  shelf.innerHTML = '<h3 class="shelf-title">Other stories you\u2019ve opened</h3><ul class="shelf-track"></ul>';
  host.appendChild(shelf);
  const track = shelf.querySelector('.shelf-track');

  /* ---------- remember every book the reader opens (read or not) ---------- */
  const same = (a, b) => String(a) === String(b);
  const clicksKey = () => 'solRecent.v1:' + (currentUser ? currentUser.id : 'guest');
  const readClicks = () => {
    try { const a = JSON.parse(localStorage.getItem(clicksKey()) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  };
  function trackClick(id) {
    if (id == null) return;
    const list = readClicks().filter(c => !same(c.id, id));
    list.unshift({ id, ts: Date.now() });
    try { localStorage.setItem(clicksKey(), JSON.stringify(list.slice(0, 20))); } catch (e) { /* storage blocked */ }
    schedule();
  }

  /* ---------- signed-in readers: progress rows for every book ---------- */
  let rowsFor, rowsP = Promise.resolve([]);
  function loadRows() {
    const id = currentUser ? currentUser.id : null;
    if (id === rowsFor) return rowsP;
    rowsFor = id;
    rowsP = (async () => {
      if (!id) return [];
      const base = 'book_id, chapter_id, chapter_number, progress_percent, updated_at';
      const q = cols => supabaseClient.from('reading_progress').select(cols)
        .eq('user_id', id).order('updated_at', { ascending: false }).limit(12);
      try {
        let res = await q(positionColumns ? base + ', read_offset, scroll_ratio' : base);
        if (res.error) res = await q(base);
        return res.error ? [] : (res.data || []);
      } catch (e) { return []; }
    })();
    return rowsP;
  }

  /* ---------- merge device + account + clicks into one list ---------- */
  function build(rows) {
    const map = new Map();
    const slot = id => {
      const k = String(id);
      if (!map.has(k)) map.set(k, { bookId: id, ts: 0, pts: -1, hasProgress: false });
      return map.get(k);
    };
    const progress = (id, p) => {
      const e = slot(id);
      if (p.ts > e.pts) Object.assign(e, { hasProgress: true, pts: p.ts, chapterNumber: p.chapterNumber, chapterId: p.chapterId, offset: p.offset, ratio: p.ratio, percent: p.percent });
      e.ts = Math.max(e.ts, p.ts);
    };
    try {
      Object.values(readLocalPositions()).forEach(p => p && progress(p.bookId, {
        ts: p.ts || 0, chapterNumber: p.chapterNumber, chapterId: p.chapterId, offset: p.offset, ratio: p.ratio, percent: p.percent }));
    } catch (e) { /* ignore */ }
    rows.forEach(r => progress(r.book_id, {
      ts: Date.parse(r.updated_at) || 0, chapterNumber: Number(r.chapter_number) || 1, chapterId: r.chapter_id,
      offset: Number(r.read_offset) || 0, ratio: Number(r.scroll_ratio) || 0, percent: Number(r.progress_percent) || 0 }));
    readClicks().forEach(c => { const e = slot(c.id); e.ts = Math.max(e.ts, c.ts || 0); });

    const mainId = continueState ? continueState.bookId : (books[0] && books[0].id);   // already on the big card
    return [...map.values()]
      .filter(e => books.some(b => same(b.id, e.bookId)) && !same(e.bookId, mainId))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 8);
  }

  /* ---------- open an entry ---------- */
  async function openEntry(e) {
    const book = books.find(b => same(b.id, e.bookId));
    if (!book) return;
    if (!e.hasProgress) return showBook(book.id);
    pendingRestore = { bookId: book.id, chapterId: e.chapterId, chapterNumber: e.chapterNumber, offset: e.offset || 0, ratio: e.ratio || 0 };
    try { await openReader(book.id, e.chapterNumber); }
    finally { pendingRestore = null; }          // a locked chapter never rendered: don't leak the jump
  }

  /* ---------- paint ---------- */
  function paint(list) {
    shelf.hidden = !list.length;
    track.replaceChildren();
    list.forEach(e => {
      const book = books.find(b => same(b.id, e.bookId));
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'shelf-card';
      btn.setAttribute('aria-label', e.hasProgress ? `Continue ${book.title} from chapter ${e.chapterNumber}` : `Open ${book.title}`);

      const cover = document.createElement('span'); cover.className = 'shelf-cover';
      if (book.cover_url) {
        const img = document.createElement('img');
        img.src = book.cover_url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
        cover.appendChild(img);
      } else cover.textContent = (book.title || 'S').trim().charAt(0).toUpperCase();

      const info = document.createElement('span'); info.className = 'shelf-info';
      const name = document.createElement('span'); name.className = 'shelf-name'; name.textContent = book.title;
      const meta = document.createElement('span'); meta.className = 'shelf-meta';
      meta.textContent = e.hasProgress ? `Chapter ${e.chapterNumber}, ${Math.round(Math.min(100, Math.max(0, e.percent || 0)))}% read` : 'Not started yet';
      info.append(name, meta);
      if (e.hasProgress) {
        const bar = document.createElement('span'); bar.className = 'shelf-bar';
        const fill = document.createElement('i'); fill.style.width = Math.min(100, Math.max(0, e.percent || 0)) + '%';
        bar.appendChild(fill); info.appendChild(bar);
      }
      btn.append(cover, info);
      btn.addEventListener('click', () => openEntry(e));
      li.appendChild(btn); track.appendChild(li);
    });
  }

  let timer = 0, lastKey = '';
  async function render() {
    if (!Array.isArray(books) || !books.length) return;
    const list = build(await loadRows());
    const key = JSON.stringify(list.map(e => [e.bookId, e.chapterNumber, Math.round(e.percent || 0), e.hasProgress]));
    if (key === lastKey) return;
    lastKey = key; paint(list);
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(render, 350); }

  /* ---------- hook into script.js without editing it ---------- */
  const hook = (name, { before, after }) => {
    const fn = window[name];
    if (typeof fn !== 'function') return;
    window[name] = function (...args) {
      if (before) { try { before(...args); } catch (e) { /* never block the original */ } }
      const out = fn.apply(this, args);
      if (after) {
        const done = () => { try { after(...args); } catch (e) { /* ignore */ } };
        out && typeof out.then === 'function' ? out.then(done, done) : done();
      }
      return out;
    };
  };
  hook('showBook', { before: trackClick });        // every book the reader clicks
  hook('renderContinue', { after: schedule });     // progress saved / main card changed
  hook('updateAuthUI', { after: schedule });       // signed in or out
  hook('logout', { after: schedule });

  schedule();
})();
