/* =========================================================
   READER CUSTOMIZER
   Adds a "Customize" button to the reader toolbar with:
     - 8 page themes (white, beige, black + paper, rose, midnight, forest, sunset)
     - accent colors
     - line spacing
     - text width
   Font size (A- / A+) and font style already exist in the toolbar.
   This file owns ALL page-theme logic, including the toolbar swatches.
========================================================= */
(function () {
    "use strict";

    var section = document.getElementById("readerSection");
    var toolbar = section && section.querySelector(".reader-toolbar-inner");
    if (!section || !toolbar) return;

    /* ---------- settings ---------- */

    var KEYS = {
        theme: "readerTheme",          /* same key reader-theme.js already uses */
        accent: "readerAccent",
        lh: "readerLineHeight",
        width: "readerWidth"
    };

    var THEMES = [
        { id: "white",    name: "White",    light: true  },
        { id: "beige",    name: "Beige",    light: true  },
        { id: "paper",    name: "Paper",    light: true  },
        { id: "rose",     name: "Rose",     light: true  },
        { id: "black",    name: "Black",    light: false },
        { id: "midnight", name: "Midnight", light: false },
        { id: "forest",   name: "Forest",   light: false },
        { id: "sunset",   name: "Sunset",   light: false }
    ];

    var ACCENTS = [
        { id: "default",  name: "Default",  color: null },
        { id: "gold",     name: "Gold",     color: "#d4af37" },
        { id: "red",      name: "Crimson",  color: "#d6453d" },
        { id: "rose",     name: "Rose",     color: "#e07a8f" },
        { id: "teal",     name: "Teal",     color: "#2bb3a3" },
        { id: "lavender", name: "Lavender", color: "#a98bd6" },
        { id: "emerald",  name: "Emerald",  color: "#3fae6a" },
        { id: "sky",      name: "Sky",      color: "#4aa3df" }
    ];

    var SPACING = [
        { id: "compact", name: "Compact", value: "1.6" },
        { id: "normal",  name: "Normal",  value: "2" },
        { id: "relaxed", name: "Relaxed", value: "2.4" }
    ];

    var WIDTHS = [
        { id: "narrow", name: "Narrow", value: "620px" },
        { id: "normal", name: "Normal", value: "760px" },
        { id: "wide",   name: "Wide",   value: "920px" }
    ];

    var DEFAULTS = { theme: "black", accent: "default", lh: "normal", width: "normal" };

    /* ---------- storage helpers ---------- */

    function read(key, fallback) {
        try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
    }

    function write(key, value) {
        try { localStorage.setItem(key, value); } catch (e) {}
    }

    function find(list, id) {
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    /* ---------- color helpers ---------- */

    function hexToRgb(hex) {
        var h = hex.replace("#", "");
        return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
    }

    function rgbToHex(rgb) {
        return "#" + rgb.map(function (v) {
            var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
            return s.length === 1 ? "0" + s : s;
        }).join("");
    }

    /* amount > 0 mixes toward white, amount < 0 mixes toward black */
    function shade(hex, amount) {
        var rgb = hexToRgb(hex);
        var target = amount >= 0 ? 255 : 0;
        var t = Math.abs(amount);
        return rgbToHex(rgb.map(function (v) { return v + (target - v) * t; }));
    }

    function luminance(hex) {
        var c = hexToRgb(hex).map(function (v) {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }

    /* ---------- apply ---------- */

    function currentTheme() {
        var id = section.getAttribute("data-reader-theme") || read(KEYS.theme, DEFAULTS.theme);
        return find(THEMES, id) || find(THEMES, DEFAULTS.theme);
    }

    function markActive(container, attr, value) {
        var nodes = container.querySelectorAll("[" + attr + "]");
        for (var i = 0; i < nodes.length; i++) {
            var on = nodes[i].getAttribute(attr) === value;
            nodes[i].classList.toggle("active", on);
            nodes[i].setAttribute("aria-pressed", on ? "true" : "false");
        }
    }

    function applyTheme(id) {
        var theme = find(THEMES, id) || find(THEMES, DEFAULTS.theme);
        section.setAttribute("data-reader-theme", theme.id);
        write(KEYS.theme, theme.id);

        /* keep every swatch (toolbar + panel) in sync */
        var swatches = document.querySelectorAll(".theme-swatch");
        for (var i = 0; i < swatches.length; i++) {
            var on = swatches[i].getAttribute("data-reader-theme") === theme.id;
            swatches[i].classList.toggle("active", on);
            swatches[i].setAttribute("aria-pressed", on ? "true" : "false");
        }

        /* accent colors look different on light and dark pages */
        applyAccent(read(KEYS.accent, DEFAULTS.accent), true);
    }

    function applyAccent(id, skipSave) {
        var accent = find(ACCENTS, id) || find(ACCENTS, DEFAULTS.accent);
        if (!skipSave) write(KEYS.accent, accent.id);

        if (!accent.color) {
            section.style.removeProperty("--gold");
            section.style.removeProperty("--gold-hi");
            section.style.removeProperty("--rc-on-accent");
        } else {
            var light = currentTheme().light;
            var base = light ? shade(accent.color, -0.32) : accent.color;
            var hi = light ? shade(accent.color, -0.45) : shade(accent.color, 0.22);
            section.style.setProperty("--gold", base);
            section.style.setProperty("--gold-hi", hi);
            section.style.setProperty("--rc-on-accent", luminance(base) > 0.45 ? "#111" : "#fff");
        }

        markActive(panel, "data-accent", accent.id);
    }

    function applySpacing(id, skipSave) {
        var item = find(SPACING, id) || find(SPACING, DEFAULTS.lh);
        section.style.setProperty("--rc-lh", item.value);
        if (!skipSave) write(KEYS.lh, item.id);
        markActive(panel, "data-lh", item.id);
    }

    function applyWidth(id, skipSave) {
        var item = find(WIDTHS, id) || find(WIDTHS, DEFAULTS.width);
        section.style.setProperty("--rc-width", item.value);
        if (!skipSave) write(KEYS.width, item.id);
        markActive(panel, "data-width", item.id);
    }

    /* ONE click handler for every swatch (toolbar + panel) */
    document.addEventListener("click", function (e) {
        var sw = e.target.closest && e.target.closest(".theme-swatch");
        if (!sw) return;
        var id = sw.getAttribute("data-reader-theme");
        if (id) applyTheme(id);
    });

    /* ---------- build the panel ---------- */

    var panel = document.createElement("div");
    panel.className = "rc-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Customize reading theme");

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    function sectionBlock(label) {
        var block = el("div", "rc-section");
        block.appendChild(el("div", "rc-label", label));
        panel.appendChild(block);
        return block;
    }

    /* header */
    var head = el("div", "rc-head");
    head.appendChild(el("h4", "", "Customize"));
    var closeBtn = el("button", "rc-close", "\u00D7");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    head.appendChild(closeBtn);
    panel.appendChild(head);

    /* themes */
    var themeBlock = sectionBlock("Page theme");
    var themeGrid = el("div", "rc-grid");
    THEMES.forEach(function (t) {
        var opt = el("div", "rc-opt");
        var b = el("button", "theme-swatch");
        b.type = "button";
        b.setAttribute("data-reader-theme", t.id);
        b.setAttribute("title", t.name);
        b.setAttribute("aria-label", t.name + " page");
        opt.appendChild(b);
        opt.appendChild(el("span", "", t.name));
        themeGrid.appendChild(opt);
    });
    themeBlock.appendChild(themeGrid);

    /* accents */
    var accentBlock = sectionBlock("Accent color");
    var accentRow = el("div", "rc-accents");
    ACCENTS.forEach(function (a) {
        var b = el("button", "rc-dot" + (a.color ? "" : " rc-default"));
        b.type = "button";
        b.setAttribute("data-accent", a.id);
        b.setAttribute("title", a.name);
        b.setAttribute("aria-label", a.name + " accent");
        if (a.color) b.style.background = a.color;
        b.addEventListener("click", function () { applyAccent(a.id); });
        accentRow.appendChild(b);
    });
    accentBlock.appendChild(accentRow);

    /* segmented rows */
    function segmented(label, list, attr, handler) {
        var block = sectionBlock(label);
        var seg = el("div", "rc-seg");
        list.forEach(function (item) {
            var b = el("button", "", item.name);
            b.type = "button";
            b.setAttribute(attr, item.id);
            b.addEventListener("click", function () { handler(item.id); });
            seg.appendChild(b);
        });
        block.appendChild(seg);
    }

    segmented("Line spacing", SPACING, "data-lh", function (id) { applySpacing(id); });
    segmented("Text width", WIDTHS, "data-width", function (id) { applyWidth(id); });

    /* reset */
    var resetBtn = el("button", "rc-reset", "Reset to default");
    resetBtn.type = "button";
    resetBtn.addEventListener("click", function () {
        applyTheme(DEFAULTS.theme);
        applyAccent(DEFAULTS.accent);
        applySpacing(DEFAULTS.lh);
        applyWidth(DEFAULTS.width);
    });
    panel.appendChild(resetBtn);

    section.appendChild(panel);

    /* ---------- toolbar button ---------- */

    var openBtn = el("button", "toolbar-btn rc-open");
    openBtn.type = "button";
    openBtn.setAttribute("title", "Customize colors and layout");
    openBtn.setAttribute("aria-label", "Customize colors and layout");
    openBtn.setAttribute("aria-expanded", "false");
    openBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="13.5" cy="6.5" r=".6"/><circle cx="17.5" cy="10.5" r=".6"/>' +
        '<circle cx="8.5" cy="7.5" r=".6"/><circle cx="6.5" cy="12.5" r=".6"/>' +
        '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.76 1.5-1.5 0-.4-.15-.74-.39-1.04-.23-.29-.38-.63-.38-.96 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-4.96-4.5-9-10-9z"/>' +
        '</svg><span>Customize</span>';
    toolbar.appendChild(openBtn);

    function positionPanel() {
        if (window.matchMedia("(max-width:700px)").matches) {
            panel.style.top = "";
            panel.style.left = "";
            return;
        }
        var r = openBtn.getBoundingClientRect();
        var width = Math.min(340, window.innerWidth - 24);
        var left = Math.min(Math.max(12, r.left), window.innerWidth - width - 12);
        panel.style.top = (r.bottom + 8) + "px";
        panel.style.left = left + "px";
    }

    function openPanel() {
        positionPanel();
        panel.classList.add("open");
        openBtn.setAttribute("aria-expanded", "true");
    }

    function closePanel() {
        panel.classList.remove("open");
        openBtn.setAttribute("aria-expanded", "false");
    }

    openBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (panel.classList.contains("open")) closePanel(); else openPanel();
    });

    closeBtn.addEventListener("click", closePanel);

    document.addEventListener("click", function (e) {
        if (!panel.classList.contains("open")) return;
        if (panel.contains(e.target) || openBtn.contains(e.target)) return;
        closePanel();
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closePanel();
    });

    window.addEventListener("resize", function () {
        if (panel.classList.contains("open")) positionPanel();
    });

    /* close the panel when the reader closes */
    new MutationObserver(function () {
        if (!section.classList.contains("active")) closePanel();
    }).observe(section, { attributes: true, attributeFilter: ["class"] });

    /* ---------- restore saved choices ---------- */

    applyTheme(read(KEYS.theme, DEFAULTS.theme));
    applyAccent(read(KEYS.accent, DEFAULTS.accent), true);
    applySpacing(read(KEYS.lh, DEFAULTS.lh), true);
    applyWidth(read(KEYS.width, DEFAULTS.width), true);
})();