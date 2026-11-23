/* Frontend security regression tests.  Run:  npm test
   No network, no Supabase: pure checks on the source files. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

/* ---------- SOL-01: avatar colours ---------- */
function loadAppCore() {
  const noop = () => {};
  const ctx = {
    console, setTimeout, clearTimeout,
    window: {},
    supabaseClient: {
      auth: { onAuthStateChange: noop, getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: {} }) },
      rpc: async () => ({ data: null, error: null }),
      from: () => ({})
    },
    document: { addEventListener: noop, getElementById: () => null, querySelector: () => null }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("js/app-core.js"), ctx);
  return ctx.SolApp;
}

test("SOL-01 safeColor accepts only #rrggbb", () => {
  const A = loadAppCore();
  assert.equal(A.safeColor("#e0274f"), "#e0274f");
  assert.equal(A.safeColor("#ABCDEF"), "#ABCDEF");
  for (const bad of [
    "red;position:fixed;inset:0;z-index:99999;background:url(https://example.invalid/t.png)",
    "#fff;background:url(x)", "red", "#fff", "url(javascript:alert(1))", '"><img src=x onerror=alert(1)>', "", null, undefined
  ]) {
    assert.equal(A.safeColor(bad), "#e0274f", "should reject " + bad);
  }
});

test("SOL-01 every style=\"--av:\" goes through safeColor", () => {
  for (const f of ["js/discuss.js", "js/profile.js"]) {
    const src = read(f);
    const sinks = src.match(/style="--av:'\s*\+\s*[^+]+/g) || [];
    assert.ok(sinks.length > 0, f + " has an avatar sink");
    for (const s of sinks) assert.match(s, /A\.safeColor\(/, f + ": " + s);
  }
});

/* ---------- SOL-04: payment redirect ---------- */
test("SOL-04 checkout redirect only to PayMongo", () => {
  const src = read("js/script.js");
  const fn = src.match(/function isPayMongoCheckout\(value\) \{[\s\S]*?\n\}/);
  assert.ok(fn, "isPayMongoCheckout exists");
  const ctx = { URL };
  vm.createContext(ctx);
  vm.runInContext(fn[0], ctx);
  const ok = (u) => ctx.isPayMongoCheckout(u);
  assert.ok(ok("https://checkout.paymongo.com/cs_abc123"));
  assert.ok(ok("https://pm.link/org/abc"));
  for (const bad of ["http://checkout.paymongo.com/cs_1", "https://paymongo.com.evil.example/x",
    "https://evilpaymongo.com/x", "javascript:alert(1)", "//evil.example", "", null]) {
    assert.ok(!ok(bad), "should reject " + bad);
  }
  /* the redirect is guarded */
  const i = src.indexOf("window.location.href = data.checkout_url");
  assert.ok(src.lastIndexOf("isPayMongoCheckout(data.checkout_url)", i) > -1);
});

/* ---------- SOL-02: third-party scripts ---------- */
test("SOL-02 every CDN script has SRI and crossorigin", () => {
  const html = read("index.html");
  const tags = html.match(/<script[^>]+src="https?:[^"]+"[^>]*>/g) || [];
  assert.ok(tags.length >= 5);
  for (const t of tags) {
    if (t.includes("static.cloudflareinsights.com/beacon.min.js")) continue; // Cloudflare updates it in place, so it can't be pinned
    assert.match(t, /integrity="sha384-[A-Za-z0-9+/=]{64}"/, t);
    assert.match(t, /crossorigin="anonymous"/, t);
  }
});

test("SOL-02 CSP allows only the pinned library folders", () => {
  const headers = read("_headers");
  const csp = headers.match(/Content-Security-Policy: (.+)/)[1];
  const scriptSrc = csp.match(/script-src ([^;]+)/)[1].trim().split(/\s+/);
  assert.ok(!scriptSrc.includes("https://cdn.jsdelivr.net"), "no whole-CDN allowance");
  assert.ok(!scriptSrc.some((s) => /unsafe-inline|unsafe-eval|\*/.test(s)));
  const html = read("index.html");
  for (const [, url] of html.matchAll(/<script[^>]+src="(https?:[^"]+)"/g)) {
    assert.ok(scriptSrc.some((s) => s === url || (s.endsWith("/") && url.startsWith(s))), url + " allowed by CSP");
  }
  for (const h of ["X-Content-Type-Options: nosniff", "X-Frame-Options: DENY", "Strict-Transport-Security", "frame-ancestors 'none'", "object-src 'none'"]) {
    assert.ok(headers.includes(h), h);
  }
});

test("SOL-03 DOMPurify is 3.2.x or newer", () => {
  const v = read("index.html").match(/dompurify@(\d+)\.(\d+)\.(\d+)/);
  assert.ok(v && (Number(v[1]) > 3 || (Number(v[1]) === 3 && Number(v[2]) >= 2)), "dompurify version " + (v && v[0]));
});

/* ---------- secrets ---------- */
test("no service-role keys or secrets in the published code", () => {
  const files = ["js/script.js", "js/app-core.js", "js/offline.js", "js/author.js", "index.html", "sw.js"];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /service_role|sb_secret_|sk_live_|sk_test_|whsec_|PAYMONGO_SECRET/i, f);
    /* the old JWT-style keys: a service-role JWT carries "role":"service_role" (base64 c2VydmljZV9yb2xl) */
    assert.doesNotMatch(src, /c2VydmljZV9yb2xl/, f);
  }
});

test("render.yaml sends the same headers as _headers", () => {
  const yaml = read("render.yaml");
  for (const block of read("_headers").trim().split(/\n\s*\n/)) {
    const [path, ...lines] = block.split("\n");
    for (const l of lines) {
      const i = l.indexOf(":");
      const entry = `- path: ${path.trim()}\n        name: ${l.slice(0, i).trim()}\n        value: ${JSON.stringify(l.slice(i + 1).trim())}`;
      assert.ok(yaml.includes(entry), "render.yaml is missing: " + l.trim().slice(0, 60));
    }
  }
});
