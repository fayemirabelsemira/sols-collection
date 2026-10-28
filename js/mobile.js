/* Sol's Collection — mobile polish (phones only, ≤700px).
   Load AFTER premium.js. Needs GSAP + ScrollTrigger (already on the page);
   everything degrades gracefully if they are missing. */
(() => {
  'use strict';
  const mq = matchMedia('(max-width:700px)');
  const calm = matchMedia('(prefers-reduced-motion:reduce)');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const raf = fn => { let p = 0; return (...a) => { if (p) return; p = 1; requestAnimationFrame(() => { p = 0; fn(...a); }); }; };
  const gs = window.gsap, root = document.documentElement;

  /* Visible height that follows the on-screen keyboard (iOS dvh ignores it) */
  const vv = window.visualViewport;
  const setVvh = () => root.style.setProperty('--vvh', (vv ? vv.height : innerHeight) + 'px');
  setVvh(); vv && vv.addEventListener('resize', setVvh);

  /* Menu: animated hamburger, aria state, scroll lock, Esc to close */
  const btn = $('#mobileMenuButton'), menu = $('#mobileMenu'), header = $('.site-header');
  if (btn && menu) {
    btn.setAttribute('aria-controls', 'mobileMenu');
    const sync = () => {
      const open = menu.classList.contains('active');
      btn.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open);
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      root.classList.toggle('m-menu-open', open && mq.matches);
      if (open && header) header.classList.remove('m-hide');
    };
    sync();
    new MutationObserver(sync).observe(menu, { attributes: true, attributeFilter: ['class'] });
    addEventListener('keydown', e => { if (e.key === 'Escape' && menu.classList.contains('active')) { menu.classList.remove('active'); btn.focus(); } });
  }
  mq.addEventListener('change', () => {
    if (mq.matches) return;
    root.classList.remove('m-menu-open'); header && header.classList.remove('m-hide');
  });

  /* Header tucks away while reading down, returns on scroll up */
  if (header) {
    let last = scrollY;
    addEventListener('scroll', raf(() => {
      const y = scrollY, dy = y - last;
      if (!mq.matches || (menu && menu.classList.contains('active')) || document.body.classList.contains('modal-open')) {
        header.classList.remove('m-hide'); last = y; return;
      }
      if (Math.abs(dy) < 6) return;
      header.classList.toggle('m-hide', dy > 0 && y > 140);
      last = y;
    }), { passive: true });
  }

  /* Modals: spring-in, bottom-sheet swipe-to-dismiss */
  const SHEETS = '#loginModal,#signupModal,#forgotModal,#resetModal,#paymentModal';
  function enter(modal) {
    if (!mq.matches || calm.matches || !gs) return;
    // Only the bottom sheets get this animation. The book modal keeps premium.js's own entrance,
    // because stopping that tween midway can leave a blur/scale stuck on the content.
    if (!(modal.matches(SHEETS) || modal.classList.contains('author-modal'))) return;
    const box = $('.modal-box', modal), ov = $('.modal-overlay', modal);
    if (!box) return;
    requestAnimationFrame(() => {               // runs after premium.js's own tween, then replaces it
      gs.killTweensOf([box, ov]);
      gs.set([box, ov].filter(Boolean), { clearProps: 'all' });   // wipe anything the killed tween left behind
      gs.fromTo(box, { yPercent: 100 }, { yPercent: 0, duration: .65, ease: 'expo.out', clearProps: 'all' });
      if (ov) gs.fromTo(ov, { opacity: 0 }, { opacity: 1, duration: .35, ease: 'power2.out', clearProps: 'all' });
    });
  }
  function armSheet(modal) {
    const box = $('.modal-box', modal);
    if (!box || box.dataset.mSheet) return;
    box.dataset.mSheet = 1;
    const grab = document.createElement('div');
    grab.className = 'm-grab'; grab.setAttribute('aria-hidden', 'true'); grab.innerHTML = '<i></i>';
    box.prepend(grab);
    let y0 = 0, dy = 0, t0 = 0, on = false;
    grab.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; t0 = e.timeStamp; dy = 0; on = true; box.style.transition = 'none'; }, { passive: true });
    grab.addEventListener('touchmove', e => { if (!on) return; dy = Math.max(0, e.touches[0].clientY - y0); box.style.transform = `translateY(${dy}px)`; }, { passive: true });
    const end = e => {
      if (!on) return; on = false;
      if (dy > 110 || (dy > 30 && dy / Math.max(e.timeStamp - t0, 1) > .6)) {
        box.style.transition = 'transform .28s cubic-bezier(.4,0,1,1)'; box.style.transform = 'translateY(110%)';
        setTimeout(() => { const c = $('.modal-close', box); c && c.click(); box.style.transition = box.style.transform = ''; }, 260);
      } else {
        box.style.transition = 'transform .45s cubic-bezier(.16,1,.3,1)'; box.style.transform = '';
        setTimeout(() => { box.style.transition = ''; }, 460);
      }
    };
    grab.addEventListener('touchend', end); grab.addEventListener('touchcancel', end);
  }
  const watch = modal => {
    if (modal._m) return; modal._m = 1;
    if (modal.matches(SHEETS)) armSheet(modal);
    let was = modal.classList.contains('active');
    new MutationObserver(() => { const on = modal.classList.contains('active'); if (on && !was) enter(modal); was = on; })
      .observe(modal, { attributes: true, attributeFilter: ['class'] });
  };
  $$('.modal').forEach(watch);
  new MutationObserver(list => list.forEach(r => r.addedNodes.forEach(n => {
    if (n.nodeType !== 1) return;
    n.matches('.modal') ? watch(n) : n.querySelector && $$('.modal', n).forEach(watch);
  }))).observe(document.body, { childList: true, subtree: true });

  /* Keep the focused field visible above the keyboard */
  document.addEventListener('focusin', e => {
    const t = e.target;
    if (!mq.matches || !t.matches || !t.matches('input,textarea,select') || !t.closest('.modal-box')) return;
    setTimeout(() => t.scrollIntoView({ block: 'center', behavior: calm.matches ? 'auto' : 'smooth' }), 320);
  });

  /* Hero: gentle scroll parallax via a CSS variable (no transform conflicts) */
  if (gs && window.ScrollTrigger && !calm.matches) {
    gs.registerPlugin(ScrollTrigger);
    gs.matchMedia().add('(max-width:700px)', () => {
      const hero = $('.cine-hero');
      if (hero) gs.fromTo(hero, { '--hp': 0 }, { '--hp': 1, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true } });
    });
  }

  /* Book cards: staggered rise as they enter (only cards below the fold) */
  const grid = $('#booksGrid');
  if (grid && 'IntersectionObserver' in window && !calm.matches) {
    const io = new IntersectionObserver(es => es.forEach(en => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target); en.target.classList.add('m-in');
      setTimeout(() => en.target.classList.remove('m-reveal', 'm-in'), 1200);
    }), { rootMargin: '0px 0px -8% 0px', threshold: .08 });
    const prep = () => $$('.book-card:not([data-m])', grid).forEach((c, i) => {
      c.dataset.m = 1;
      if (!mq.matches || c.getBoundingClientRect().top < innerHeight * .92) return;
      c.style.setProperty('--m-d', (i % 2) * .08 + 's');
      c.classList.add('m-reveal'); io.observe(c);
    });
    new MutationObserver(prep).observe(grid, { childList: true }); prep();
  }

  /* Reader: thin reading-progress line under the top bar */
  const reader = $('#readerSection'), bar = $('.reader-topbar'), sr = $('.story-reader');
  if (reader && bar) {
    const track = document.createElement('div');
    track.className = 'm-reader-bar'; track.innerHTML = '<i></i>'; bar.appendChild(track);
    const fill = track.firstChild;
    reader.addEventListener('scroll', raf(e => {
      const t = e.target;
      if (t !== sr && t !== reader) return;
      const max = t.scrollHeight - t.clientHeight;
      fill.style.transform = `scaleX(${max > 0 ? Math.min(1, t.scrollTop / max) : 0})`;
    }), true);
  }

  /* Light haptic tick on primary taps (Android; ignored elsewhere) */
  document.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || !mq.matches || !navigator.vibrate) return;
    if (e.target.closest('.read-button,.cine-btn,.sort-button,.genre-card,.auth-submit,.payment-button,.reader-nav-button,.author-btn.primary')) navigator.vibrate(8);
  }, { passive: true });
})();