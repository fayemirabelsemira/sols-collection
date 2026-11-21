/* Runs in <head>, before the page paints. On the first open of a session the
   Eclipse intro plays (js/intro.js via js/premium.js); hide the page until it
   starts so the home page doesn't flash first. Always undone once the page
   has loaded if the intro didn't start (no GSAP, reduced motion, etc.). */
(function () {
  var h = document.documentElement, wait = false;
  try {
    wait = !sessionStorage.getItem("sc_intro") &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {}
  if (!wait) return;
  h.classList.add("sol-intro-wait");
  function release() { h.classList.remove("sol-intro-wait"); }
  document.addEventListener("DOMContentLoaded", function () {
    if (!document.querySelector(".sol-intro")) release();
  });
  setTimeout(release, 9000);   /* never keep the app hidden */
})();
