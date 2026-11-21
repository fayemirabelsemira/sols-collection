/* =========================================================
   SOL OPENING INTRO: "Eclipse Ignition" (4 s)
   Same animation as brand/sol-eclipse-reveal.html, drawn live:
   ember -> sun -> total eclipse -> diamond-ring flash -> the
   crescent floats into place -> a spark writes "Sol" -> tagline.
   js/premium.js calls SolIntro.play() once per session (each app
   launch). Tap anywhere or "Skip" to jump straight in.
   Load BEFORE js/premium.js.
========================================================= */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var DURATION = 4;

  var MARKUP =
    '<svg viewBox="560 110 840 800" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
    "<defs>" +
    '<radialGradient id="siSky" cx="960" cy="470" r="900" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4a0b1d" stop-opacity=".9"/><stop offset=".35" stop-color="#22070f" stop-opacity=".6"/><stop offset="1" stop-color="#070508" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="siSun" cx="0" cy="0" r="150" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff6ea"/><stop offset=".45" stop-color="#ffd2a1"/><stop offset=".8" stop-color="#ff9a3c"/><stop offset="1" stop-color="#ff6a4d"/></radialGradient>' +
    '<linearGradient id="siGold" x1="-150" y1="-150" x2="150" y2="150" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffe9cc"/><stop offset=".5" stop-color="#ffbe8f"/><stop offset="1" stop-color="#ff8a45"/></linearGradient>' +
    '<radialGradient id="siCorona" cx="0" cy="0" r="290" gradientUnits="userSpaceOnUse"><stop offset=".5" stop-color="#fff1e0" stop-opacity="0"/><stop offset=".52" stop-color="#fff1e0" stop-opacity=".95"/><stop offset=".6" stop-color="#ffc58f" stop-opacity=".45"/><stop offset=".8" stop-color="#ff6a4d" stop-opacity=".12"/><stop offset="1" stop-color="#e0274f" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="siBloom"><stop offset="0" stop-color="#fff"/><stop offset=".18" stop-color="#fff3e2" stop-opacity=".85"/><stop offset=".5" stop-color="#ffb199" stop-opacity=".25"/><stop offset="1" stop-color="#ff6a4d" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="siRay" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
    '<linearGradient id="siBrand" x1="640" y1="0" x2="1340" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff3d5e"/><stop offset=".38" stop-color="#ffb199"/><stop offset=".6" stop-color="#ff6a4d"/><stop offset="1" stop-color="#ff9a3c"/></linearGradient>' +
    '<filter id="siB30" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="30"/></filter>' +
    '<filter id="siB6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>' +
    '<filter id="siB3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>' +
    '<filter id="siB1" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.2"/></filter>' +
    '<mask id="siMoon" maskUnits="userSpaceOnUse" x="-1000" y="-1000" width="2000" height="2000"><rect x="-1000" y="-1000" width="2000" height="2000" fill="#fff"/><circle data-k="moon" r="150" fill="#000"/></mask>' +
    "</defs>" +
    '<rect data-k="sky" x="-2000" y="-2000" width="5920" height="5080" fill="url(#siSky)" opacity="0"/>' +
    '<g data-k="eclipse">' +
    '<g data-k="rays" opacity="0" filter="url(#siB6)"></g>' +
    '<circle data-k="corona" r="290" fill="url(#siCorona)" opacity="0"/>' +
    '<circle data-k="rim" r="151" fill="none" stroke="#fff3e2" stroke-width="3" filter="url(#siB1)" opacity="0"/>' +
    '<g data-k="halo" filter="url(#siB30)" opacity="0"><g mask="url(#siMoon)"><circle data-k="haloDisc" r="150" fill="#ff7a45"/></g></g>' +
    '<g mask="url(#siMoon)"><circle data-k="sun" r="150" fill="url(#siSun)" opacity="0"/><circle data-k="gold" r="150" fill="url(#siGold)" opacity="0"/></g>' +
    '<g data-k="diamond" opacity="0"><circle r="150" fill="url(#siBloom)"/><ellipse rx="260" ry="2.2" fill="url(#siBloom)" transform="rotate(-18)"/><ellipse rx="2.2" ry="200" fill="url(#siBloom)" transform="rotate(-18)"/><circle r="9" fill="#fff" filter="url(#siB3)"/></g>' +
    "</g>" +
    '<circle data-k="ember" cx="960" cy="470" r="3" fill="#ffd9b0" opacity="0"/>' +
    '<circle data-k="emberGlow" cx="960" cy="470" r="40" fill="url(#siBloom)" opacity="0"/>' +
    '<g data-k="sigGlow" fill="none" stroke="url(#siBrand)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" filter="url(#siB6)" opacity="0"></g>' +
    '<g data-k="sig" fill="none" stroke="url(#siBrand)" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"></g>' +
    '<path data-k="comet" fill="none" stroke="#fff3e2" stroke-width="3" stroke-linecap="round" opacity="0" filter="url(#siB1)"/>' +
    '<g data-k="nib" opacity="0"><circle r="22" fill="url(#siBloom)" opacity=".9"/><circle r="3.4" fill="#fff"/></g>' +
    '<text data-k="tagline" x="1000" y="842" text-anchor="middle" fill="#f1dccd" opacity="0" font-family="Didot, \'Bodoni 72\', \'Playfair Display\', Georgia, serif" font-size="25" letter-spacing="14">STORIES THAT STAY WITH YOU</text>' +
    '<g data-k="glint" opacity="0"><circle r="16" fill="url(#siBloom)"/><ellipse rx="34" ry="1.4" fill="#fff"/><ellipse rx="1.4" ry="26" fill="#fff"/></g>' +
    "</svg>" +
    '<button type="button" class="sol-intro-skip">Skip</button>';

  /* ---------- easing ---------- */
  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function prog(t, a, b) { return clamp((t - a) / (b - a)); }
  function smooth(x) { return x * x * (3 - 2 * x); }
  function inOutCubic(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function inOutQuint(x) { return x < 0.5 ? 16 * Math.pow(x, 5) : 1 - Math.pow(-2 * x + 2, 5) / 2; }
  function outCubic(x) { return 1 - Math.pow(1 - x, 3); }
  function outQuart(x) { return 1 - Math.pow(1 - x, 4); }
  function outExpo(x) { return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x); }
  function inOutSine(x) { return -(Math.cos(Math.PI * x) - 1) / 2; }
  function bump(t, a, m, b) { return t < a || t > b ? 0 : t < m ? smooth((t - a) / (m - a)) : smooth(1 - (t - m) / (b - m)); }
  function lerp(a, b, u) { return a + (b - a) * u; }

  /* ---------- geometry (same as the brand file) ---------- */
  var RS = 150;
  var START = { x: 960, y: 470, s: 1 }, END = { x: 806, y: 296, s: 0.6 };
  var MOON_END = { x: 0.48 * RS, y: -0.31 * RS }, MOON_START = { x: -2.3 * RS, y: 1.45 * RS };
  var md = Math.hypot(MOON_END.x, MOON_END.y), MU = { x: MOON_END.x / md, y: MOON_END.y / md };
  var BEAD = { x: -MU.x * RS, y: -MU.y * RS };
  var HORN = (function () {
    var mx = MOON_END.x / 2, my = MOON_END.y / 2, h = Math.sqrt(RS * RS - (md / 2) * (md / 2));
    var a = { x: mx - MU.y * h, y: my + MU.x * h }, b = { x: mx + MU.y * h, y: my - MU.x * h };
    return a.y < b.y ? a : b;
  })();
  var STROKES = [
    "M 902 420 C 894 388, 842 374, 800 390 C 754 408, 746 462, 790 492 C 836 524, 902 548, 904 612 C 906 672, 838 712, 770 706 C 726 702, 704 676, 716 650",
    "M 1000 618 C 980 602, 946 610, 940 646 C 934 684, 962 706, 988 698 C 1014 690, 1024 656, 1012 630 C 1004 614, 988 616, 996 630 C 1008 648, 1040 652, 1066 640 C 1110 620, 1160 520, 1166 450 C 1170 400, 1150 380, 1136 396 C 1116 420, 1112 520, 1116 600 C 1120 670, 1140 704, 1176 702 C 1206 700, 1228 684, 1246 668",
    "M 704 752 C 860 772, 1110 764, 1296 716"
  ];
  var LIFT = 0.06, SLANT = Math.tan(-11 * Math.PI / 180), PX = 960, PY = 700;
  var WRITE_START = 2.1, WRITE_END = 3.35;
  function slant(p) { return { x: p.x + SLANT * (p.y - PY), y: p.y }; }
  function groupAt(t) {
    var u = inOutQuint(prog(t, 1.62, 2.3));
    return { x: lerp(START.x, END.x, u), y: lerp(START.y, END.y, u), s: lerp(START.s, END.s, u) };
  }
  function toScreen(g, p) { return { x: g.x + g.s * p.x, y: g.y + g.s * p.y }; }
  function pen(x) { return 0.65 * inOutSine(x) + 0.35 * x; }

  function build(root) {
    var k = function (name) { return root.querySelector('[data-k="' + name + '"]'); };
    var el = {};
    ["sky", "eclipse", "rays", "corona", "rim", "halo", "haloDisc", "sun", "gold", "diamond", "moon", "ember", "emberGlow",
     "sigGlow", "sig", "comet", "nib", "tagline", "glint"].forEach(function (n) { el[n] = k(n); });

    for (var i = 0; i < 16; i++) {
      var r = document.createElementNS(NS, "rect");
      r.setAttribute("x", 150); r.setAttribute("y", -(i % 3 ? 1.6 : 2.6));
      r.setAttribute("width", 120 + ((i * 53) % 90)); r.setAttribute("height", i % 3 ? 3.2 : 5.2);
      r.setAttribute("rx", 2); r.setAttribute("fill", "url(#siRay)");
      r.setAttribute("opacity", (0.35 + ((i * 37) % 50) / 100).toFixed(2));
      r.setAttribute("transform", "rotate(" + ((i / 16) * 360 + (i % 2 ? 7 : -5)) + ")");
      el.rays.appendChild(r);
    }

    var tf = "translate(" + PX + " " + PY + ") skewX(-11) translate(" + -PX + " " + -PY + ")";
    el.sig.setAttribute("transform", tf);
    el.sigGlow.setAttribute("transform", tf);
    var strokes = STROKES.map(function (d) {
      var mk = function (parent) { var p = document.createElementNS(NS, "path"); p.setAttribute("d", d); parent.appendChild(p); return p; };
      var path = mk(el.sig), glow = mk(el.sigGlow), len = path.getTotalLength();
      [path, glow].forEach(function (p) { p.setAttribute("stroke-dasharray", len + " " + len); });
      return { path: path, glow: glow, len: len };
    });
    var total = strokes.reduce(function (a, s) { return a + s.len; }, 0);
    var T = WRITE_END - WRITE_START - LIFT * (strokes.length - 1), at = WRITE_START;
    strokes.forEach(function (s) { s.t0 = at; s.t1 = at + T * s.len / total; at = s.t1 + LIFT; });
    el.strokes = strokes;
    /* phones show the mark smaller, so the tagline needs bigger letters to stay readable */
    el.narrow = window.innerWidth <= 700;
    if (el.narrow) {
      el.tagline.setAttribute("font-size", "40");
      /* the moon + "Sol" sit right of the tagline's centre (x 1000): frame the
         finished mark so both share one centre line on the screen */
      el.tagline.setAttribute("x", "1025");
      root.querySelector("svg").setAttribute("viewBox", "605 128 840 800");
    }
    el.sigStart = slant(strokes[0].path.getPointAtLength(0));
    return el;
  }

  function set(node, name, v) { node.setAttribute(name, v); }

  function render(el, t) {
    t = Math.max(0, Math.min(DURATION, t));
    var g = groupAt(t);
    set(el.eclipse, "transform", "translate(" + g.x.toFixed(2) + " " + g.y.toFixed(2) + ") scale(" + g.s.toFixed(4) + ")");

    set(el.ember, "opacity", (smooth(prog(t, 0, 0.25)) * (1 - smooth(prog(t, 0.35, 0.55)))).toFixed(3));
    set(el.emberGlow, "opacity", (0.7 * smooth(prog(t, 0, 0.3)) * (1 - smooth(prog(t, 0.35, 0.6)))).toFixed(3));
    var r = Math.max(0.01, RS * outQuart(prog(t, 0.22, 0.85))).toFixed(2);
    set(el.sun, "r", r); set(el.gold, "r", r); set(el.haloDisc, "r", r);
    set(el.sun, "opacity", (smooth(prog(t, 0.22, 0.45)) * (1 - smooth(prog(t, 2.0, 2.6)))).toFixed(3));
    set(el.gold, "opacity", smooth(prog(t, 2.0, 2.6)).toFixed(3));
    set(el.halo, "opacity", (0.85 * smooth(prog(t, 0.25, 0.7)) * (1 - 0.6 * smooth(prog(t, 2.2, 2.8)))).toFixed(3));

    var mx, my, u;
    if (t < 1.5) { u = outCubic(prog(t, 0.7, 1.5)); mx = lerp(MOON_START.x, 0, u); my = lerp(MOON_START.y, 0, u); }
    else { u = inOutCubic(prog(t, 1.6, 2.3)); mx = lerp(0, MOON_END.x, u); my = lerp(0, MOON_END.y, u); }
    set(el.moon, "cx", mx.toFixed(2)); set(el.moon, "cy", my.toFixed(2));

    var tot = bump(t, 1.3, 1.52, 1.9);
    set(el.corona, "opacity", (tot * 0.95).toFixed(3));
    set(el.rim, "opacity", (bump(t, 1.38, 1.52, 1.72) * 0.9).toFixed(3));
    set(el.rays, "opacity", (tot * 0.75).toFixed(3));
    set(el.rays, "transform", "rotate(" + (t * 6).toFixed(2) + ")");
    var sky = 0.95 * smooth(prog(t, 0.25, 0.9)) - 0.6 * bump(t, 1.2, 1.5, 1.9) + 0.25 * bump(t, 1.55, 1.68, 2.2);
    set(el.sky, "opacity", Math.max(0, Math.min(1, sky - 0.15 * smooth(prog(t, 2.2, 3.0)))).toFixed(3));

    set(el.diamond, "opacity", bump(t, 1.56, 1.66, 1.98).toFixed(3));
    set(el.diamond, "transform", "translate(" + BEAD.x.toFixed(2) + " " + BEAD.y.toFixed(2) + ") scale(" + (0.6 + 0.6 * outExpo(prog(t, 1.56, 1.8))).toFixed(3) + ")");

    var cu = inOutCubic(prog(t, 1.92, WRITE_START));
    var from = toScreen(g, { x: BEAD.x * 0.92, y: BEAD.y * 0.92 }), to = el.sigStart;
    var ctrl = { x: (from.x + to.x) / 2 + 40, y: Math.min(from.y, to.y) - 60 };
    var q = function (v) {
      return { x: (1 - v) * (1 - v) * from.x + 2 * (1 - v) * v * ctrl.x + v * v * to.x,
               y: (1 - v) * (1 - v) * from.y + 2 * (1 - v) * v * ctrl.y + v * v * to.y };
    };
    var head = q(cu), tail = q(Math.max(0, cu - 0.22));
    var cometOn = t >= 1.92 && t < WRITE_START + 0.02 ? smooth(prog(t, 1.92, 1.98)) : 0;
    set(el.comet, "d", "M " + tail.x.toFixed(2) + " " + tail.y.toFixed(2) + " Q " + lerp(tail.x, head.x, 0.5).toFixed(2) + " " +
      lerp(tail.y, head.y, 0.5).toFixed(2) + " " + head.x.toFixed(2) + " " + head.y.toFixed(2));
    set(el.comet, "opacity", (cometOn * 0.85).toFixed(3));

    var nib = null, nibOn = 0;
    if (t >= 1.92 && t < WRITE_START) { nib = head; nibOn = cometOn; }
    el.strokes.forEach(function (st, i) {
      var w = pen(prog(t, st.t0, st.t1)), off = (st.len * (1 - w)).toFixed(2);
      set(st.path, "stroke-dashoffset", off); set(st.glow, "stroke-dashoffset", off);
      var on = t >= st.t0 && w > 0.0005 ? 1 : 0;
      set(st.path, "opacity", on); set(st.glow, "opacity", on);
      if (t >= st.t0 && t <= st.t1) { nib = slant(st.path.getPointAtLength(st.len * w)); nibOn = 1; }
      else if (i < el.strokes.length - 1 && t > st.t1 && t < el.strokes[i + 1].t0) {
        var a = slant(st.path.getPointAtLength(st.len)), b = slant(el.strokes[i + 1].path.getPointAtLength(0));
        var v = inOutSine(prog(t, st.t1, el.strokes[i + 1].t0));
        nib = { x: lerp(a.x, b.x, v), y: lerp(a.y, b.y, v) }; nibOn = 0.35;
      }
    });
    set(el.sigGlow, "opacity", (t >= WRITE_START ? 0.4 + 0.2 * bump(t, 3.5, 3.75, 4.0) : 0).toFixed(3));
    if (nib) set(el.nib, "transform", "translate(" + nib.x.toFixed(2) + " " + nib.y.toFixed(2) + ")");
    set(el.nib, "opacity", (nibOn * (1 - smooth(prog(t, 3.3, 3.45)))).toFixed(3));

    var tg = outCubic(prog(t, 3.2, 3.85));
    set(el.tagline, "opacity", (tg * 0.88).toFixed(3));
    set(el.tagline, "letter-spacing", (el.narrow ? 12 - 6 * tg : 22 - 9 * tg).toFixed(2));
    set(el.tagline, "transform", "translate(0 " + (8 * (1 - tg)).toFixed(2) + ")");

    var gp = toScreen(g, HORN), gl = bump(t, 3.5, 3.72, 3.98);
    set(el.glint, "opacity", gl.toFixed(3));
    set(el.glint, "transform", "translate(" + gp.x.toFixed(2) + " " + gp.y.toFixed(2) + ") rotate(" + (15 + 40 * prog(t, 3.5, 4)).toFixed(2) + ") scale(" + (0.4 + 0.8 * gl).toFixed(3) + ")");
  }

  /* opts.onReveal: called as the intro starts to fade (start the page's entrance)
     opts.onDone:   called once the overlay is gone */
  function play(opts) {
    opts = opts || {};
    var root = document.createElement("div");
    root.className = "sol-intro";
    root.setAttribute("role", "img");
    root.setAttribute("aria-label", "Sol");
    root.innerHTML = MARKUP;
    document.body.appendChild(root);
    var el;
    try { el = build(root); } catch (e) { root.remove(); document.documentElement.classList.remove("sol-intro-wait"); if (opts.onReveal) opts.onReveal(); if (opts.onDone) opts.onDone(); return; }
    render(el, 0);
    document.documentElement.classList.remove("sol-intro-wait");   /* set by js/boot.js */

    var start = null, ended = false, revealed = false, raf = 0;
    function reveal() { if (!revealed) { revealed = true; if (opts.onReveal) opts.onReveal(); } }
    function finish() {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      reveal();
      root.classList.add("is-leaving");
      setTimeout(function () { root.remove(); if (opts.onDone) opts.onDone(); }, 600);
    }
    function frame(now) {
      if (start === null) start = now;
      var t = (now - start) / 1000;
      render(el, t);
      if (t >= DURATION + 0.35) return finish();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    root.addEventListener("click", finish);
    setTimeout(finish, 8000);   /* failsafe: never block the app */
  }

  window.SolIntro = { play: play, DURATION: DURATION };
})();
