(function () {
    var KEY = "readerTheme";
    var THEMES = ["white", "beige", "black"];
    var section = document.getElementById("readerSection");
    var buttons = document.querySelectorAll(".theme-swatch");

    if (!section || !buttons.length) return;

    function apply(theme) {
        if (THEMES.indexOf(theme) === -1) theme = "black";
        section.setAttribute("data-reader-theme", theme);
        buttons.forEach(function (b) {
            var on = b.getAttribute("data-reader-theme") === theme;
            b.classList.toggle("active", on);
            b.setAttribute("aria-pressed", on ? "true" : "false");
        });
        try { localStorage.setItem(KEY, theme); } catch (e) {}
    }

    var saved = "black";
    try { saved = localStorage.getItem(KEY) || "black"; } catch (e) {}
    apply(saved);

    buttons.forEach(function (b) {
        b.addEventListener("click", function () {
            apply(b.getAttribute("data-reader-theme"));
        });
    });
})();

/* ===== Mobile reader: slide-out chapters + hide-menu button ===== */
(function () {
    var mq = window.matchMedia("(max-width:900px)");
    var section = document.getElementById("readerSection");
    if (!section) return;

    var layout = section.querySelector(".reader-layout");
    var toggleBtn = document.getElementById("toggleSidebar");
    var focusBtn = document.getElementById("focusToggle");
    var backdrop = document.getElementById("drawerBackdrop");
    var chapterList = document.getElementById("chapterList");

    function closeDrawer() {
        if (!layout || !mq.matches) return;
        layout.classList.add("sidebar-hidden");
        if (toggleBtn) toggleBtn.textContent = "☰ Show Chapters";
    }

    function setFocus(on) {
        section.classList.toggle("focus-mode", on);
        if (focusBtn) focusBtn.textContent = on ? "☰ Menu" : "✕ Hide menu";
    }

    if (focusBtn) {
        focusBtn.addEventListener("click", function () {
            setFocus(!section.classList.contains("focus-mode"));
        });
    }
    if (backdrop) backdrop.addEventListener("click", closeDrawer);
    if (chapterList) {
        chapterList.addEventListener("click", function (e) {
            if (e.target.closest && e.target.closest(".chapter-item")) closeDrawer();
        });
    }

    var wasActive = false;
    new MutationObserver(function () {
        var active = section.classList.contains("active") && !section.classList.contains("hidden");
        if (active && !wasActive) {
            closeDrawer();
            setFocus(false);
        }
        wasActive = active;
    }).observe(section, { attributes: true, attributeFilter: ["class"] });
})();