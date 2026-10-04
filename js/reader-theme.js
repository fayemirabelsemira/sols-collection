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