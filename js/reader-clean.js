/* Sol — calmer reader toolbar on phones (≤700px).
   Bar shows: Chapters · Bookmark · Aa · •••
   "Aa" sheet  = text size + page colors (+ link to the full customizer)
   "•••" menu  = Family tree (opens character cards), Previously on…
   One bar on phones; the floating button hides/shows it.
   Load AFTER reader-extras.js. The original buttons are MOVED, never copied,
   so all their existing behaviour keeps working. */
(() => {
  'use strict';
  const section = document.getElementById('readerSection');
  const inner = section && section.querySelector('.reader-toolbar-inner');
  if (!section || !inner) return;
  const mq = matchMedia('(max-width:700px)');
  const $ = (s, r = section) => r.querySelector(s);

  const topbar = $('.reader-topbar'), toolbar = $('.reader-toolbar');
  const sizeGroup = $('#fontDecrease') && $('#fontDecrease').closest('.toolbar-group');
  const themeGroup = $('.theme-group');
  if (!sizeGroup || !themeGroup) return;

  /* where things live on desktop, so they can go back */
  const homeSize = document.createComment('rd-size'), homeTheme = document.createComment('rd-theme');
  sizeGroup.before(homeSize); themeGroup.before(homeTheme);

  const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  /* ---- toolbar buttons ---- */
  const aa = mk('button', 'toolbar-btn rd-aa', 'Aa'); aa.type = 'button'; aa.setAttribute('aria-label', 'Text size and page color'); aa.setAttribute('aria-expanded', 'false');
  const more = mk('button', 'toolbar-btn rd-more-btn', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>');
  more.type = 'button'; more.setAttribute('aria-label', 'More'); more.setAttribute('aria-expanded', 'false');

  /* ---- Aa sheet ---- */
  const sheet = mk('div', 'rd-sheet'); sheet.hidden = true; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Text size and page color');
  const head = mk('div', 'rd-head', '<b>Reading style</b>');
  const close = mk('button', 'rd-close', '✕'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); head.appendChild(close);
  const rowSize = mk('div', 'rd-row', '<span class="rd-label">Text size</span>'); const slotSize = mk('div', 'rd-slot'); rowSize.appendChild(slotSize);
  const rowTheme = mk('div', 'rd-row', '<span class="rd-label">Page color</span>'); const slotTheme = mk('div', 'rd-slot'); rowTheme.appendChild(slotTheme);
  const full = mk('button', 'rd-full', 'More colors &amp; layout'); full.type = 'button';
  sheet.append(head, rowSize, rowTheme, full);

  /* ---- ••• menu ---- */
  const menu = mk('div', 'rd-menu'); menu.hidden = true;
  const ico = d => '<svg class="rd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICON_TREE = ico('<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>');
  const ICON_RECAP = ico('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>');
  const item = (label, id, icon, hint) => {
    const b = mk('button', 'rd-item', icon + '<span class="rd-item-text"><span class="rd-item-label">' + label + '</span><span class="rd-item-hint">' + hint + '</span></span>'); b.type = 'button';
    b.addEventListener('click', () => { close_(); const t = document.getElementById(id); t && t.click(); });
    return b;
  };
  menu.setAttribute('role', 'menu');
  menu.append(item('Family tree', 'cxTreeBtn', ICON_TREE, 'Characters and bloodlines'), item('Previously on\u2026', 'rcBtn', ICON_RECAP, 'Catch up on recent chapters'));

  section.append(sheet, menu);

  function close_() {
    sheet.hidden = true; menu.hidden = true;
    aa.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-expanded', 'false');
  }
  aa.addEventListener('click', e => { e.stopPropagation(); const o = sheet.hidden; close_(); sheet.hidden = !o; aa.setAttribute('aria-expanded', String(o)); });
  more.addEventListener('click', e => {
    e.stopPropagation(); const o = menu.hidden; close_();
    if (o) { const r = more.getBoundingClientRect(); menu.style.top = (r.bottom + 6) + 'px'; menu.hidden = false; more.setAttribute('aria-expanded', 'true'); }
  });
  close.addEventListener('click', close_);
  full.addEventListener('click', e => {
    e.stopPropagation();                          /* else the customizer's "click outside" closes it at once */
    close_();
    const b = $('.rc-open'); b && b.click();
  });
  document.addEventListener('click', e => {
    if (sheet.hidden && menu.hidden) return;
    if (sheet.contains(e.target) || menu.contains(e.target) || aa.contains(e.target) || more.contains(e.target)) return;
    close_();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close_(); });
  new MutationObserver(() => { if (!section.classList.contains('active')) close_(); }).observe(section, { attributes: true, attributeFilter: ['class'] });

  /* ---- phone <-> desktop ---- */
  function layout() {
    close_();
    if (mq.matches) {
      slotSize.appendChild(sizeGroup); slotTheme.appendChild(themeGroup);
      inner.append(aa, more);
      topbar && topbar.append(inner);            /* ONE bar on phones: back · title · tools */
    } else {
      toolbar && toolbar.append(inner);
      homeSize.after(sizeGroup); homeTheme.after(themeGroup);
      aa.remove(); more.remove();
      section.classList.remove('rd-bars-off');
    }
  }
  mq.addEventListener('change', layout);
  layout();

  /* ---- hide / show bars button: keep its label in sync (the visible icon comes from CSS) ---- */
  const focusBtn = document.getElementById('focusToggle');
  const syncFocus = () => {
    if (!focusBtn) return;
    const off = section.classList.contains('focus-mode');
    focusBtn.setAttribute('aria-label', off ? 'Show menu' : 'Hide menu');
    focusBtn.title = off ? 'Show menu' : 'Hide menu';
  };
  new MutationObserver(syncFocus).observe(section, { attributes: true, attributeFilter: ['class'] });
  syncFocus();
})();
