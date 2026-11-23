/* Sol — phone home layout (≤700px).
   Wattpad-style: search + genre chips at the top, swipeable shelves,
   and a bottom tab bar. On wider screens everything is put back and hidden.
   Load BEFORE premium.js (so its scroll animations see the final positions). */
(() => {
  'use strict';
  const mq = matchMedia('(max-width:700px)');
  const $ = (s, r = document) => r.querySelector(s);
  const root = document.documentElement;
  const top = $('#mTop'), tabbar = $('#mTabbar');
  const form = $('#bookSearchForm'), genres = $('.genres-grid');
  const controls = $('.books-controls'), genreSection = $('.genres-section');
  const booksHeading = $('.books-heading');
  if (!top || !form || !controls) return;

  /* ---------- move search + genre chips to the top (and back) ---------- */
  function layout() {
    if (mq.matches) {
      top.hidden = false;
      top.append(form);
      if (genres) top.append(genres);
      root.classList.add('m-moved');
    } else {
      controls.insertBefore(form, controls.firstChild);
      genreSection && genres && genreSection.appendChild(genres);
      top.hidden = true;
      root.classList.remove('m-moved');
    }
    shelves();
    window.ScrollTrigger && ScrollTrigger.refresh();
  }

  /* ---------- horizontal shelves ---------- */
  const shelfHost = document.createElement('div');
  shelfHost.id = 'mShelves'; shelfHost.className = 'm-shelves';
  booksHeading && booksHeading.after(shelfHost);

  function shelf(title, list) {
    const sec = document.createElement('section'); sec.className = 'm-shelf';
    const h = document.createElement('h3'); h.className = 'm-shelf-title'; h.textContent = title;
    const track = document.createElement('div'); track.className = 'm-shelf-track';
    list.forEach(b => {
      const item = document.createElement('button');
      item.type = 'button'; item.className = 'm-shelf-item';
      const cover = document.createElement('span'); cover.className = 'm-shelf-cover';
      if (b.cover_url) {
        const img = document.createElement('img');
        img.src = b.cover_url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
        cover.appendChild(img);
      } else cover.textContent = 'S';
      const name = document.createElement('span'); name.className = 'm-shelf-name'; name.textContent = b.title || '';
      item.append(cover, name);
      item.addEventListener('click', () => typeof showBook === 'function' && showBook(b.id));
      track.appendChild(item);
    });
    sec.append(h, track);
    return sec;
  }
  function shelves() {
    shelfHost.textContent = '';
    if (!mq.matches || typeof books === 'undefined' || !books.length) return;
    // while searching or filtering by genre, show only the results grid
    const filtering = (typeof currentGenre !== 'undefined' && currentGenre) || (typeof currentQuery !== 'undefined' && currentQuery);
    if (filtering) return;
    const num = (b, k) => Number(b[k]) || 0;
    const popular = [...books].sort((a, b) => num(b, 'views') - num(a, 'views')).slice(0, 10);
    // one shelf only: a "Top voted" shelf listed the same books again
    shelfHost.append(shelf('Most popular', popular));
    const all = document.createElement('h3'); all.className = 'm-shelf-title'; all.textContent = 'All stories';
    shelfHost.appendChild(all);
  }
  if (typeof renderBooks === 'function') {
    const orig = renderBooks;
    window.renderBooks = function () { const r = orig.apply(this, arguments); shelves(); return r; };
  }

  /* ---------- bottom tab bar ----------
     Each tab opens its own page now: see js/pages.js. */

  /* hide the tab bar while the keyboard is up */
  addEventListener('focusin', e => { if (mq.matches && e.target.matches && e.target.matches('input,textarea,select')) root.classList.add('m-kbd'); });
  addEventListener('focusout', () => setTimeout(() => {
    const a = document.activeElement;
    if (!(a && a.matches && a.matches('input,textarea,select'))) root.classList.remove('m-kbd');
  }, 80));

  mq.addEventListener('change', layout);
  layout();
})();
