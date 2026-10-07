/* =========================================================
   ACCESSIBILITY FOR POP-UPS
   - gives every .modal the dialog role + a name
   - moves focus into the dialog when it opens, and back to the
     button that opened it when it closes
   - keeps Tab inside the dialog while it is open
   - Escape closes it
   Works by watching the "active" class, so it needs no changes
   to the code that opens and closes the modals.
   Load LAST.
========================================================= */
(function () {
    "use strict";

    var modals = Array.prototype.slice.call(document.querySelectorAll(".modal"));
    if (!modals.length) return;

    var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),' +
                    'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    var openEl = null;      /* the modal currently open */
    var returnTo = null;    /* what had focus before it opened */
    var wasOpen = {};

    /* ---------- roles + names ---------- */

    modals.forEach(function (modal) {
        var box = modal.querySelector(".modal-box") || modal;
        var heading = box.querySelector("h2, h3");

        box.setAttribute("role", "dialog");
        box.setAttribute("aria-modal", "true");

        if (heading) {
            if (!heading.id) heading.id = modal.id + "Title";
            box.setAttribute("aria-labelledby", heading.id);
        }

        if (!box.hasAttribute("tabindex")) box.setAttribute("tabindex", "-1");

        wasOpen[modal.id] = modal.classList.contains("active");
    });

    /* ---------- helpers ---------- */

    function visible(el) {
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    function focusables(root) {
        return Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE)).filter(visible);
    }

    function boxOf(modal) {
        return modal.querySelector(".modal-box") || modal;
    }

    function onOpen(modal) {
        if (!openEl) returnTo = document.activeElement;
        openEl = modal;

        /* wait a tick so the dialog is laid out before we focus into it */
        setTimeout(function () {
            if (openEl !== modal) return;
            var box = boxOf(modal);
            var field = box.querySelector("input:not([type='hidden']):not([disabled])");
            var target = (field && visible(field)) ? field :
                         (box.querySelector(".modal-close") || focusables(box)[0] || box);
            try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
        }, 30);
    }

    function onClose(modal) {
        if (openEl !== modal) return;
        openEl = null;

        var back = returnTo;
        returnTo = null;

        /* if another modal opens right away (login -> signup) leave focus to it */
        setTimeout(function () {
            if (openEl) return;
            if (back && document.contains(back) && visible(back)) {
                try { back.focus({ preventScroll: true }); } catch (e) { back.focus(); }
            }
        }, 0);
    }

    /* ---------- watch open / close ---------- */

    var observer = new MutationObserver(function (records) {
        records.forEach(function (rec) {
            var modal = rec.target;
            var isOpen = modal.classList.contains("active");
            if (isOpen === wasOpen[modal.id]) return;
            wasOpen[modal.id] = isOpen;
            if (isOpen) onOpen(modal); else onClose(modal);
        });
    });

    modals.forEach(function (modal) {
        observer.observe(modal, { attributes: true, attributeFilter: ["class"] });
    });

    /* ---------- Tab trap + Escape ---------- */

    document.addEventListener("keydown", function (e) {
        if (!openEl) return;

        if (e.key === "Escape") {
            if (typeof window.closeModal === "function") window.closeModal(openEl.id);
            else openEl.classList.remove("active");
            return;
        }

        if (e.key !== "Tab") return;

        var box = boxOf(openEl);
        var items = focusables(box);

        if (!items.length) {
            e.preventDefault();
            box.focus();
            return;
        }

        var first = items[0];
        var last = items[items.length - 1];
        var current = document.activeElement;

        if (!box.contains(current)) {
            e.preventDefault();
            first.focus();
        } else if (e.shiftKey && (current === first || current === box)) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && current === last) {
            e.preventDefault();
            first.focus();
        }
    });
})();
