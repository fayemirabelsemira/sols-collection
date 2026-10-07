/* Mobile reader: slide-out chapters + hide-menu button.
   (Page themes now live ONLY in reader-customize.js.) */
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