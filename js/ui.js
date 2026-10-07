/* =========================================================
   SOL TOAST
   Replaces alert(). Usage:
     solToast("Saved!");
     solToast("Working...", { sticky: true })  -> returns a hide() function
     solToast("Slow one", { duration: 9000 });
   Load BEFORE script.js.
========================================================= */
(function () {
    "use strict";

    var host, timer, current = 0;

    function ensureHost() {
        if (host) return host;
        host = document.createElement("div");
        host.className = "sol-toast";
        host.setAttribute("role", "status");
        host.setAttribute("aria-live", "polite");
        document.body.appendChild(host);
        return host;
    }

    function hide(id) {
        if (id !== undefined && id !== current) return; /* a newer toast took over */
        clearTimeout(timer);
        if (host) host.classList.remove("show");
    }

    window.solToast = function (message, options) {
        options = options || {};
        var el = ensureHost();
        var id = ++current;

        el.textContent = String(message == null ? "" : message);
        /* restart the transition so repeated toasts feel responsive */
        el.classList.remove("show");
        void el.offsetWidth;
        el.classList.add("show");

        clearTimeout(timer);
        if (!options.sticky) {
            timer = setTimeout(function () { hide(id); }, options.duration || 4200);
        }

        return function () { hide(id); };
    };
})();
