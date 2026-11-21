/* =========================================================
   READING STREAK (sql/13_reading_streak.sql)
   Opening a chapter counts as a reading day. Shows on the Me page.
   Hidden until the SQL is installed.
========================================================= */
(function () {
  "use strict";
  var sb = typeof supabaseClient !== "undefined" ? supabaseClient : null;
  if (!sb) return;
  var installed = true, data = null, sentDay = "";

  function user() { return typeof currentUser !== "undefined" ? currentUser : null; }
  function missing(err) { return err && /function|schema cache|does not exist|42883|PGRST202/i.test((err.message || "") + " " + (err.code || "")); }
  function text() { return data ? "🔥 " + data.current + (data.current === 1 ? " day" : " days") : "–"; }

  function paint() {
    document.querySelectorAll("[data-streak-stat]").forEach(function (el) { el.textContent = text(); });
  }

  async function call(fn) {
    if (!installed || !user()) return null;
    var res = await sb.rpc(fn);
    if (res.error) { if (missing(res.error)) installed = false; return null; }
    data = res.data;
    paint();
    return data;
  }

  async function record() {
    var u = user();
    if (!u) return;
    var key = u.id + ":" + new Date().toDateString();
    if (sentDay === key) return;           /* once per session per day */
    sentDay = key;
    var before = data ? data.current : null;
    var d = await call("record_read_day");
    if (d && window.solToast && d.current > (before == null ? 0 : before) && d.current > 1) {
      window.solToast("🔥 " + d.current + "-day reading streak!");
    }
  }

  var orig = window.openChapter;
  if (typeof orig === "function") {
    window.openChapter = function () {
      var r = orig.apply(this, arguments);
      record();
      return r;
    };
  }

  document.addEventListener("click", function () { if (!data && user()) call("reading_streak"); }, { once: true });
  window.SolStreak = { refresh: function () { return call("reading_streak"); }, text: text };
})();
