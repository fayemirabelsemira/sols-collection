# Sol — Penetration Test Report

**Date:** 13 November 2026 · **Type:** authorised, defensive, non-destructive
**Targets:**

| Target | What it is |
|---|---|
| A. Local preview | `python3 -m http.server` serving `dist/` on `127.0.0.1:8788` |
| B. Cloudflare local runtime | `wrangler dev -c wrangler.build.jsonc` on `127.0.0.1:8789`, which applies the real `_headers` |
| C. Throwaway Postgres 16 | In Docker, set up by `tests/sql/00_supabase_stub.sql` with Supabase's `anon` / `authenticated` roles, its default grants, an `auth.users` table, `auth.uid()`, plus `sql/01`, `03`, `04` |
| D. Headless Chrome | With the network switched off, for the offline regression |

**Not targeted:** production (`sol.ladyysol.workers.dev`, the Supabase project, PayMongo). No accounts were created, no payments were made, and no real data was read or changed. Where the browser needed backend data, `supabaseClient.from(...)` was **faked inside the page**, so nothing was sent.

Each test lists the component, the hypothesis, the method, the result and the conclusion.

---

## PT-01: Avatar colour → CSS injection on Discussion (finding SOL-01)

- **Component:** `js/discuss.js` `avatar()`; `discussion_author()` / `create_thread()` in `sql/04_discussions.sql`
- **Hypothesis:** profile metadata is user-writable, so a crafted colour can add CSS to every viewer's page.
- **Method, browser (A):**
  1. Replaced `supabaseClient.from("discussion_threads")` in the page with a stub that returns one thread whose `avatar_color` is `red;position:fixed;inset:0;z-index:99999;background:url(https://example.invalid/track.png)`.
  2. Opened `#/discuss` so the real rendering code ran.
- **Method, database (C):** set `auth.users.raw_user_meta_data.avatar_color` to the same payload, then called `create_thread()` as that `authenticated` user.

**Result before the fix:**

| Check | Observed |
|---|---|
| Rendered `style` | `--av:red;position:fixed;inset:0;z-index:99999;background:url(https://example.invalid/track.png)` |
| Computed `position` / `z-index` | `fixed` / `99999` |
| Covers the viewport | `true` |
| Background loads external URL | `url("https://example.invalid/track.png")` |
| DB: colour stored on the new thread | yes (`FAIL SOL-01 malicious avatar_color stored on thread`) |

**Conclusion:** exploitable. Any signed-in user could deface the page or track every viewer. No script execution is possible (CSP + escaping). **Severity: Medium.**

**Result after the fix:**
- The rendered avatars were `--av:#e0274f` (payload replaced, `position: static`) and `--av:#3fa7ff` (a legitimate colour, kept).
- The DB returned `PASS` on all three SOL-01 checks.

---

## PT-02: Third-party script substitution / CSP bypass via jsDelivr (SOL-02)

- **Component:** `index.html` script tags and `_headers` CSP
- **Hypothesis:** without SRI, a changed CDN file runs; with a host-wide CSP, any npm package on jsDelivr can be loaded by injected markup.
- **Method:**
  1. Static check of the tags and the CSP.
  2. After the fix, in B, injected `<script src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js">` from the console.
- **Result before:** no `integrity` on any of the 5 scripts; `script-src … https://cdn.jsdelivr.net` (the whole CDN).
- **Result after:**
  - The injected script was **blocked**: "Loading the script '…jquery@3.7.1…' violates the following Content Security Policy directive", and `window.jQuery` stayed `undefined`.
  - All five pinned libraries loaded and passed their SRI check: `DOMPurify.version = 3.2.6`, `gsap`, `ScrollTrigger`, `Lenis`, `supabase`; 7 books rendered.
- **Conclusion:** the risk is closed. **Severity: Medium** (low likelihood, high impact).

---

## PT-03: XSS through chapter HTML (SOL-03 regression)

- **Component:** `sanitizeChapterHtml()` (`js/script.js` ~1743) with DOMPurify 3.2.6
- **Payloads:**
  1. `<img src=x onerror=alert(1)>`
  2. `<a href="javascript:alert(1)">x</a>`
  3. `<svg><script>alert(1)</script></svg>`
  4. `<p onclick="alert(1)">t</p>`
  5. `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>`
  6. Control: `<p>Chapter <em>text</em> with <strong>bold</strong></p>`
- **Result:**

| Payload | Output |
|---|---|
| 1 | `<img src="x">` |
| 2 | `<a>x</a>` |
| 3 | empty |
| 4 | `<p>t</p>` |
| 5 | empty |
| 6 (control) | unchanged |

- **Conclusion:** not exploitable, and formatting is kept.

---

## PT-04: Payment redirect to a foreign host (SOL-04)

- **Component:** `startRealPayment` redirect in `js/script.js`
- **Method:** the unit test runs `isPayMongoCheckout()` extracted from the source. A browser spot-check followed.
- **Result before:** any `checkout_url` was followed.
- **Result after:**
  - Accepted: `https://checkout.paymongo.com/cs_abc123` and `https://pm.link/org/abc`.
  - Rejected: `http://checkout.paymongo.com/…`, `https://paymongo.com.evil.example/x`, `https://evilpaymongo.com/x`, `javascript:alert(1)`, `//evil.example`, empty, and null.
  - Browser: `[true, false]` for a PayMongo URL vs `https://evil.example/x`.
- **Conclusion:** hardened. **Severity: Low** (needs a compromised backend first).

---

## PT-05: Paid chapter text via direct table read (SOL-05)

- **Component:** `public.chapters` grants and policies
- **Hypothesis:** RLS filters rows, not columns. If a reader may see a chapter row, they may select its `content` too.
- **Method (C):**
  1. Seeded a free chapter and a paid chapter.
  2. Granted the browser roles exactly what Supabase grants by default, and added a row-visible SELECT policy.
  3. As `anon`, and as a signed-in reader with no purchase, ran `select content from public.chapters where chapter_number = 2`.
- **Result before:**
  - `FAIL SOL-05 anon read paid chapter text directly: PAID SECRET TEXT`
  - `FAIL SOL-05 signed-in reader read paid chapter text directly`
  - `get_chapter_for_reader` returned null for the paid chapter, which is correct; the hole is the table, not the function.
- **Result after `sql/06`:**
  - Both reads are refused (`insufficient_privilege`).
  - `chapter_number` is still readable, so the site keeps working.
  - The free chapter still opens through `get_chapter_for_reader`.
  - Direct INSERT/UPDATE by a signed-in user changes nothing.
- **Guard test:** in a separate database with a caller-rights function that reads `chapters`, `sql/06` printed `Chapter lock SKIPPED …` and changed nothing.
- **Conclusion:** the weakness is real for the configuration modelled. **Whether production has it is not confirmed**, because the live policy isn't in the repo. **Severity: High if present.**

---

## PT-06: Existing access controls (regression, all from the repo SQL, C)

| Attempt (as a normal reader) | Expected | Result |
|---|---|---|
| `update books set price = 0` | blocked | PASS (price still 150) |
| Insert a thread directly with someone else's `user_id` / name | blocked | PASS |
| `set_thread_pinned` without owning a book | refused | PASS |
| `author_set_book_details` on someone else's book | refused | PASS |
| `cast_vote` as `anon` | refused | PASS |

---

## PT-07: Security headers (SOL-06)

- **Method:** `curl -I http://127.0.0.1:8789/` and `/sw.js` under `wrangler dev`.
- **Result:**
  - All present: CSP (narrowed), `Strict-Transport-Security: max-age=31536000`, `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.
  - `sw.js` and the manifest keep `Cache-Control: no-cache`.

---

## PT-08: Offline / service-worker regression

- **Method (D):**
  1. Load online.
  2. Save a story.
  3. Cut the network and reopen the app.
  4. Open the saved list, home cards and Start Reading.
- **Result:**
  - The app booted offline with 7 books.
  - The saved-list tap opened the book, and Start Reading showed the chapter text.
  - The SRI-checked CDN files were served from the renamed `sol-static-v2` cache.

---

## Notes and limits

- **Service worker under `wrangler dev`:** registration failed in the in-app browser with "An unknown error occurred when fetching the script". The same happened with the **old** headers, and registration works on the plain local server. So it's a quirk of the local runtime, not a regression.
- **Not testable here:**
  - comment / purchase / progress policies
  - `author_*` ownership checks
  - `get_chapter_for_reader`'s purchase logic
  - `create-payment`
  - PayMongo webhook signature verification
  - Storage bucket policies

  They need production metadata: run `sql/05_security_audit_readonly.sql` and share the output. See `REMAINING_RISKS.md`.
