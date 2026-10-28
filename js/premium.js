/* =========================================================
   SOL'S COLLECTION — premium motion layer (GSAP + Lenis)
   Purely additive: never touches Supabase / PayMongo / auth.
   If a CDN script fails to load, the site simply runs as before.
========================================================= */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const header = $(".site-header");

  /* ---- Reduced motion or missing GSAP: minimal, safe behaviour ---- */
  if (reduce || !window.gsap) {
    if (header) {
      const solid = () => header.classList.toggle("is-solid", window.scrollY > 40);
      window.addEventListener("scroll", solid, { passive: true });
      solid();
    }
    return;
  }

  const hasST = !!window.ScrollTrigger;
  if (hasST) gsap.registerPlugin(ScrollTrigger);
  root.classList.add("has-gsap");
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  /* =========================================================
     1. LENIS smooth scroll (synced with GSAP ticker)
  ========================================================= */
  let lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({
      lerp: 0.085,
      wheelMultiplier: 1,
      smoothWheel: true,
      prevent: (node) =>
        !!(node.closest && node.closest("[data-lenis-prevent], .modal, #readerSection, .mobile-menu"))
    });
    if (hasST) lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  // One subscription helper for scroll position (Lenis or native)
  const scrollSubs = [];
  let prevY = window.scrollY;
  function onScrollY(fn) { scrollSubs.push(fn); }
  if (lenis) {
    lenis.on("scroll", (e) => scrollSubs.forEach((f) => f(e.scroll, e.velocity)));
  } else {
    window.addEventListener(
      "scroll",
      () => {
        const y = window.scrollY;
        const v = y - prevY;
        prevY = y;
        scrollSubs.forEach((f) => f(y, v));
      },
      { passive: true }
    );
  }

  // Smooth anchor links
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || !lenis) return;
    const id = a.getAttribute("href");
    if (!id || id.length < 2) return;
    const target = document.getElementById(id.slice(1));
    if (!target) return;
    e.preventDefault();
    const top = id === "#top";
    lenis.scrollTo(top ? 0 : target, {
      offset: top ? 0 : -20,
      duration: 1.7,
      easing: (t) => 1 - Math.pow(1 - t, 4)
    });
    if (target.tabIndex >= -1) target.focus({ preventScroll: true });
  });

  // Let inner scrollers keep native scrolling
  function markPrevent(scope) {
    const sel = ".modal-box,.author-box,.author-body,#readerSection,.mobile-menu,.chapter-sidebar,.story-reader,textarea";
    if (scope.matches && scope.matches(sel)) scope.setAttribute("data-lenis-prevent", "");
    if (scope.querySelectorAll) scope.querySelectorAll(sel).forEach((n) => n.setAttribute("data-lenis-prevent", ""));
  }
  markPrevent(document);

  /* =========================================================
     2. Scroll progress + header behaviour
  ========================================================= */
  const bar = document.createElement("div");
  bar.className = "scroll-progress";
  document.body.appendChild(bar);
  const setBar = gsap.quickSetter(bar, "scaleX");

  let lastY = window.scrollY;
  let headerHidden = false;
  onScrollY((y) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    setBar(max > 0 ? Math.min(1, y / max) : 0);
    if (header) {
      header.classList.toggle("is-solid", y > 40);
      const menuOpen = !!$("#mobileMenu.active");
      if (y > 420 && y > lastY + 4 && !menuOpen && !headerHidden) {
        headerHidden = true;
        gsap.to(header, { yPercent: -100, duration: 0.55, ease: "power3.out", overwrite: true });
      } else if ((y < lastY - 4 || y < 420) && headerHidden) {
        headerHidden = false;
        gsap.to(header, { yPercent: 0, duration: 0.55, ease: "power3.out", overwrite: true });
      }
    }
    lastY = y;
  });
  if (header) header.classList.toggle("is-solid", window.scrollY > 40);

  /* =========================================================
     3. Hero setup (initial states) + intro curtain
  ========================================================= */
  const heroWords = $$(".cine-title .wi");
  const heroBits = [$(".cine-kicker"), $(".cine-sub"), $(".cine-cta"), $(".cine-scroll")].filter(Boolean);
  const eclipse = $(".cine-eclipse");
  gsap.set(heroWords, { yPercent: 118, rotate: 5 });
  gsap.set(heroBits, { opacity: 0, y: 28 });
  if (eclipse) gsap.set(eclipse, { opacity: 0 });

  function heroEntrance() {
    const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
    if (eclipse) tl.to(eclipse, { opacity: 1, duration: 2.6, ease: "power2.out" }, 0);
    tl.to(heroBits[0] || {}, { opacity: 1, y: 0, duration: 1 }, 0.1)
      .to(heroWords, { yPercent: 0, rotate: 0, duration: 1.5, stagger: 0.1 }, 0.2)
      .to(heroBits.slice(1), { opacity: 1, y: 0, duration: 1.1, stagger: 0.14 }, 0.85);
    return tl;
  }

  function runIntro() {
    let seen = false;
    try { seen = !!sessionStorage.getItem("sc_intro"); sessionStorage.setItem("sc_intro", "1"); } catch (_) {}
    if (seen) { heroEntrance(); return; }

    const wrap = document.createElement("div");
    wrap.className = "intro";
    wrap.innerHTML =
      '<div class="intro-sun"></div><div class="intro-name" aria-hidden="true">' +
      "Sol\u2019s Collection".split("").map((c) => '<span><b>' + (c === " " ? "&nbsp;" : c) + "</b></span>").join("") +
      "</div>";
    document.body.appendChild(wrap);
    if (lenis) lenis.stop(); else document.body.style.overflow = "hidden";

    const done = () => {
      wrap.remove();
      if (lenis) lenis.start(); else document.body.style.overflow = "";
    };
    const letters = $$(".intro-name b", wrap);
    gsap.set(letters, { yPercent: 110 });
    const tl = gsap.timeline({ onComplete: done });
    tl.fromTo(".intro-sun", { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.6, ease: "power3.out" }, 0)
      .to(letters, { yPercent: 0, duration: 1, stagger: 0.04, ease: "power4.out" }, 0.25)
      .to(letters, { yPercent: -110, duration: 0.7, stagger: 0.025, ease: "power3.in" }, 1.75)
      .add(heroEntrance, 2.0)
      .to(wrap, { clipPath: "circle(0% at 50% 50%)", duration: 1.15, ease: "power4.inOut" }, 2.0);
    wrap.addEventListener("click", () => tl.timeScale(4));
    setTimeout(() => { if (wrap.isConnected) { tl.progress(1); } }, 7000); // failsafe
  }
  runIntro();

  /* ---- Hero ambience: embers, mouse parallax, scroll parallax ---- */
  (function embers() {
    const c = $(".cine-embers");
    if (!c) return;
    const ctx = c.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0, run = true, ps = [];
    const N = window.innerWidth < 700 ? 34 : 78;
    const spawn = (init) => ({
      x: Math.random() * w, y: init ? Math.random() * h : h + 12,
      r: Math.random() * 1.7 + 0.4, vy: Math.random() * 0.55 + 0.15,
      vx: (Math.random() - 0.5) * 0.25, a: Math.random() * 0.7 + 0.25,
      ph: Math.random() * 6.28, warm: Math.random() > 0.5
    });
    function size() {
      w = c.clientWidth; h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!ps.length) ps = Array.from({ length: N }, () => spawn(true));
    }
    size();
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(size, 200); });
    new IntersectionObserver((en) => { run = en[0].isIntersecting; }).observe(c);
    gsap.ticker.add(() => {
      if (!run || document.hidden) return;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (const p of ps) {
        p.y -= p.vy; p.ph += 0.02; p.x += p.vx + Math.sin(p.ph) * 0.25;
        if (p.y < -12) Object.assign(p, spawn(false));
        const a = p.a * (0.55 + 0.45 * Math.sin(p.ph * 2.3));
        const col = p.warm ? "255,179,71" : "255,92,86";
        ctx.fillStyle = "rgba(" + col + "," + (a * 0.12).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 5, 0, 6.283); ctx.fill();
        ctx.fillStyle = "rgba(" + col + "," + a.toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
    });
  })();

  const hero = $(".cine-hero");
  if (hero && hasST) {
    const st = { trigger: hero, start: "top top", end: "bottom top", scrub: true };
    const inner = $(".eclipse-inner");
    gsap.to(".cine-hero-inner", { yPercent: -14, opacity: 0, ease: "none", scrollTrigger: st });
    if (inner) gsap.to(inner, { scale: 1.5, opacity: 0.15, ease: "none", scrollTrigger: st });
  }
  if (hero && fine) {
    const inner = $(".eclipse-inner");
    const txt = $(".cine-hero-inner");
    if (inner && txt) {
      const ex = gsap.quickTo(inner, "x", { duration: 1.2, ease: "power3" });
      const ey = gsap.quickTo(inner, "y", { duration: 1.2, ease: "power3" });
      const tx = gsap.quickTo(txt, "x", { duration: 1.4, ease: "power3" });
      hero.addEventListener("pointermove", (e) => {
        const nx = e.clientX / window.innerWidth - 0.5;
        const ny = e.clientY / window.innerHeight - 0.5;
        ex(nx * 46); ey(ny * 36); tx(nx * -14);
      });
    }
  }

  /* ---- Velocity marquee ---- */
  (function marquee() {
    const track = $(".cine-marquee-track");
    if (!track) return;
    const tween = gsap.to(track, { xPercent: -50, repeat: -1, ease: "none", duration: 38 });
    let dir = 1, boost = 0;
    onScrollY((y, v) => {
      const vel = typeof v === "number" ? v : 0;
      if (Math.abs(vel) > 0.15) { dir = vel > 0 ? 1 : -1; boost = Math.min(7, Math.abs(vel) * 0.35); }
    });
    gsap.ticker.add(() => { boost *= 0.94; tween.timeScale(dir * (1 + boost)); });
  })();

  /* =========================================================
     4. Scroll reveals (static sections)
  ========================================================= */
  if (hasST) {
    $$(".section-heading").forEach((h) => {
      const label = $(".section-label", h);
      const h2 = $("h2", h);
      const sub = $("p:not(.section-label)", h);
      const tl = gsap.timeline({ scrollTrigger: { trigger: h, start: "top 86%", once: true }, defaults: { ease: "power4.out" } });
      if (label) tl.from(label, { opacity: 0, y: 18, duration: 0.9 }, 0);
      if (h2) tl.from(h2, { opacity: 0, y: 70, filter: "blur(14px)", duration: 1.3, clearProps: "filter" }, 0.08);
      if (sub) tl.from(sub, { opacity: 0, y: 20, duration: 0.9 }, 0.3);
    });
    gsap.from(".books-controls", { opacity: 0, y: 30, duration: 1, ease: "power3.out", scrollTrigger: { trigger: ".books-controls", start: "top 92%", once: true } });
    const cc = $(".continue-card");
    if (cc) gsap.from(cc, { opacity: 0, y: 60, scale: 0.97, duration: 1.2, ease: "power4.out", scrollTrigger: { trigger: cc, start: "top 90%", once: true } });
    const gc = $$(".genre-card");
    if (gc.length) {
      gsap.set(gc, { opacity: 0, y: 40 });
      ScrollTrigger.batch(gc, {
        start: "top 94%", once: true,
        onEnter: (b) => gsap.to(b, { opacity: 1, y: 0, duration: 0.9, stagger: 0.08, ease: "power3.out", clearProps: "opacity,transform" })
      });
    }
    const about = $("#about");
    if (about) gsap.from(about, { opacity: 0, y: 90, scale: 0.96, duration: 1.4, ease: "power4.out", scrollTrigger: { trigger: about, start: "top 88%", once: true } });
  }

  // Genre spotlight follows the pointer
  const gg = $(".genres-grid");
  if (gg && fine) {
    gg.addEventListener("pointermove", (e) => {
      const c = e.target.closest(".genre-card");
      if (!c) return;
      const r = c.getBoundingClientRect();
      c.style.setProperty("--mx", e.clientX - r.left + "px");
      c.style.setProperty("--my", e.clientY - r.top + "px");
    });
  }

  /* =========================================================
     5. Book cards: entrance (dynamic) + 3D tilt
  ========================================================= */
  const grid = $("#booksGrid");
  let refreshT;
  const refreshSoon = () => { if (!hasST) return; clearTimeout(refreshT); refreshT = setTimeout(() => ScrollTrigger.refresh(), 350); };

  function revealCards(cards) {
    if (!cards.length) return;
    if (!hasST) return;
    gsap.set(cards, { opacity: 0, y: 90, scale: 0.95 });
    ScrollTrigger.batch(cards, {
      start: "top 95%", once: true,
      onEnter: (b) =>
        gsap.to(b, { opacity: 1, y: 0, scale: 1, duration: 1.15, stagger: 0.11, ease: "power4.out", clearProps: "opacity,transform" })
    });
    refreshSoon();
  }
  if (grid) {
    revealCards($$(".book-card", grid));
    grid.addEventListener("load", refreshSoon, true);

    if (fine) {
      let cur = null, raf = 0;
      const reset = () => {
        if (!cur) return;
        cur.classList.remove("is-tilting");
        cur.style.setProperty("--rx", "0deg"); cur.style.setProperty("--ry", "0deg");
        cur.style.setProperty("--px", ".5"); cur.style.setProperty("--py", ".5");
        cur = null;
      };
      grid.addEventListener("pointermove", (e) => {
        const c = e.target.closest(".book-card");
        if (!c) { reset(); return; }
        if (cur && cur !== c) reset();
        cur = c; c.classList.add("is-tilting");
        const r = c.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          c.style.setProperty("--px", px.toFixed(3)); c.style.setProperty("--py", py.toFixed(3));
          c.style.setProperty("--ry", ((px - 0.5) * 11).toFixed(2) + "deg");
          c.style.setProperty("--rx", ((0.5 - py) * 9).toFixed(2) + "deg");
        });
      });
      grid.addEventListener("pointerleave", reset);
    }
  }
  window.addEventListener("load", refreshSoon);

  /* =========================================================
     6. Magnetic buttons + custom cursor
  ========================================================= */
  if (fine) {
    const MAG = "[data-magnetic], .nav-button.primary, .author-btn.primary, .read-button.large";
    let mag = null;
    const unmag = () => { if (mag) { gsap.to(mag, { x: 0, y: 0, duration: 0.8, ease: "elastic.out(1,.4)" }); mag = null; } };
    document.addEventListener("pointermove", (e) => {
      const m = e.target.closest && e.target.closest(MAG);
      if (!m) { unmag(); return; }
      if (mag && mag !== m) unmag();
      mag = m;
      const r = m.getBoundingClientRect();
      gsap.to(m, {
        x: (e.clientX - (r.left + r.width / 2)) * 0.32,
        y: (e.clientY - (r.top + r.height / 2)) * 0.42,
        duration: 0.4, ease: "power3.out", overwrite: "auto"
      });
    });

    // cursor
    root.classList.add("has-cursor");
    const dot = document.createElement("div"); dot.className = "cursor-dot";
    const ring = document.createElement("div"); ring.className = "cursor-ring";
    document.body.append(ring, dot);
    const rx = gsap.quickTo(ring, "x", { duration: 0.5, ease: "power3" });
    const ry = gsap.quickTo(ring, "y", { duration: 0.5, ease: "power3" });
    const dx = gsap.quickTo(dot, "x", { duration: 0.08 });
    const dy = gsap.quickTo(dot, "y", { duration: 0.08 });
    document.addEventListener("pointermove", (e) => { rx(e.clientX); ry(e.clientY); dx(e.clientX); dy(e.clientY); });
    document.addEventListener("pointerover", (e) => {
      const t = e.target;
      if (!t.closest) return;
      const text = !!t.closest("input,textarea,select,#storyContent");
      ring.classList.toggle("is-hidden", text); dot.classList.toggle("is-hidden", text);
      const link = !!t.closest("a,button,[data-magnetic],.genre-card,label,.continue-card");
      ring.classList.toggle("is-link", link);
    });
    document.documentElement.addEventListener("mouseleave", () => { ring.classList.add("is-hidden"); dot.classList.add("is-hidden"); });
    document.documentElement.addEventListener("mouseenter", () => { ring.classList.remove("is-hidden"); dot.classList.remove("is-hidden"); });
  }

  /* =========================================================
     7. Modals + Reader transitions (observe class changes)
  ========================================================= */
  let lastPt = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  document.addEventListener("pointerdown", (e) => { lastPt = { x: e.clientX, y: e.clientY }; }, true);

  function openModal(m) {
    const box = $(".modal-box", m) || $(".author-box", m);
    const ov = $(".modal-overlay", m);
    if (ov) gsap.fromTo(ov, { opacity: 0 }, { opacity: 1, duration: 0.55, ease: "power2.out", clearProps: "opacity" });
    if (!box) return;
    gsap.fromTo(box,
      { y: 70, scale: 0.94, opacity: 0, filter: "blur(10px)" },
      { y: 0, scale: 1, opacity: 1, filter: "blur(0px)", duration: 0.9, ease: "power4.out", clearProps: "transform,opacity,filter" });
    const kids = $$(".book-modal-header > *, .book-synopsis, .book-features > div, .payment-box > *, .author-head > *", box);
    if (kids.length) gsap.from(kids, { opacity: 0, y: 26, duration: 0.9, stagger: 0.06, delay: 0.18, ease: "power3.out", clearProps: "opacity,transform" });
  }

  const reader = $("#readerSection");
  function openReader() {
    gsap.fromTo(reader,
      { clipPath: "circle(0% at " + lastPt.x + "px " + lastPt.y + "px)" },
      { clipPath: "circle(150% at " + lastPt.x + "px " + lastPt.y + "px)", duration: 1.2, ease: "power3.inOut", clearProps: "clipPath" });
    gsap.from(".reader-topbar", { yPercent: -100, duration: 0.9, delay: 0.55, ease: "power4.out", clearProps: "transform" });
    gsap.from(".reader-toolbar", { opacity: 0, duration: 0.9, delay: 0.7, ease: "power2.out", clearProps: "opacity" });
  }

  let headingT = 0;
  const heading = $("#chapterHeading");
  if (heading) {
    new MutationObserver(() => {
      const now = Date.now();
      if (now - headingT < 500) return;
      headingT = now;
      gsap.fromTo(heading, { opacity: 0 }, { opacity: 1, duration: 1, ease: "power2.out", clearProps: "opacity" });
    }).observe(heading, { childList: true, characterData: true, subtree: true });
  }

  new MutationObserver((muts) => {
    const newCards = [];
    for (const m of muts) {
      if (m.type === "childList") {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          markPrevent(n);
          if (n.matches && n.matches(".book-card") && n.parentElement === grid) newCards.push(n);
        });
        continue;
      }
      const t = m.target;
      if (!t.classList) continue;
      const was = (m.oldValue || "").split(/\s+/);
      if ((t.classList.contains("modal") || t.classList.contains("author-modal")) &&
          t.classList.contains("active") && !was.includes("active")) {
        openModal(t);
      } else if (t === reader && was.includes("hidden") && !t.classList.contains("hidden")) {
        openReader();
      }
    }
    if (newCards.length) revealCards(newCards);
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });

  window.SolsPremium = { lenis };
})();