# Sol — Security Audit

**Date:** 13 November 2026
**Scope:** everything in this repository: static site (`index.html`, `js/`, `css/`), service worker, Cloudflare config (`_headers`, `wrangler*.jsonc`), the share-preview Worker, and the SQL in `sql/`.
**Not in scope (not in the repo):** the live Supabase database as it really is today, the `create-payment` Edge Function, the PayMongo webhook, the `author_*` / `get_chapter_for_reader` / comment functions and policies. These can't be tested from here. `sql/05_security_audit_readonly.sql` collects them so they can be reviewed next (see `REMAINING_RISKS.md`).
**Rules followed:** nothing was run against production. Tests used the local preview (`dist/` on 127.0.0.1), Cloudflare's local server (`wrangler dev`), and a throwaway Postgres in Docker that mimics Supabase's roles and default grants. No real accounts, payments or user data were used.

This replaces the 8 November report. That report's live checks against production were not repeated.

Companion reports:

| File | Contents |
|---|---|
| `PENETRATION_TEST_REPORT.md` | each test case, how it was run, and what happened |
| `SECURITY_FIXES.md` | what changed, file by file |
| `SECURITY_TEST_RESULTS.md` | before/after test output |
| `REMAINING_RISKS.md` | what is still open and what you need to do |

---

## 1. Architecture and attack surface

| Area | What's there | Trust boundary |
|---|---|---|
| Frontend | Vanilla JS, about 25 classic scripts, built by `build.mjs` into `dist/` | Runs in the reader's browser, so nothing here is a security control |
| Hosting | Cloudflare Workers static assets (`wrangler.build.jsonc` → `dist/`), headers come from `_headers` | Public |
| Backend | Supabase: PostgREST (tables + RPC), Auth, Edge Functions, Storage | The **only** real enforcement point: RLS policies, grants, and `SECURITY DEFINER` functions |
| Auth | Supabase email/password; session token kept in `localStorage`; sent as a bearer header, not a cookie | XSS would expose the token, so XSS defences matter |
| Payments | `functions.invoke("create-payment")` → PayMongo checkout → readers return to the site, which polls `purchases` (`js/script.js` ~2990–3030) | The price and the unlocking happen on the server; the browser never unlocks content itself |
| Offline / PWA | `sw.js` caches the shell, CDN files and the `books` list; chapters are stored in IndexedDB (`js/offline.js`) | Device-local |
| Third-party code | supabase-js 2.45.4, DOMPurify, GSAP 3.12.5, ScrollTrigger, Lenis 1.1.14, all from jsDelivr | Runs with full page rights |
| File upload | None in the client. Covers are public Storage URLs uploaded from the dashboard | n/a |
| Optional Worker | `optional-share-previews/worker.js`: reads public `books` columns, escapes values into meta tags | Public, read-only |

**Data the browser touches directly**
- Tables: `books`, `chapters` (id/number only), `comments`, `comment_likes`, `reading_progress`, `purchases`, `library`, `book_reviews`, `book_votes`, `discussion_*`.
- RPCs: `author_*` (writer studio), `get_chapter_for_reader`, `get_book_chapter_metadata`, `cast_vote`, `increment_views`, `upsert_review`, `create_thread`, `add_reply`, `toggle_thread_like`, `set_thread_pinned`, `is_sol_writer`, `is_comment_admin`, `author_can_write`, `get_*` stats/highlights/recaps/codex.

**Secrets:** only the Supabase *publishable* key and the project URL are in the code (`js/script.js:17-18`, `optional-share-previews/worker.js:7-8`). That is by design. No service-role key, PayMongo secret, webhook secret or JWT secret was found (checked automatically in `tests/security.test.mjs`).

**Dependencies:**
- `npm audit`: 0 vulnerabilities (dev-only: esbuild, wrangler).
- The browser libraries are pinned to exact versions. DOMPurify was behind; it is now on 3.2.6.

---

## 2. Findings

| ID | Finding | Severity | Status |
|---|---|---|---|
| SOL-01 | CSS injection through a user-controlled `avatar_color` on Discussion posts | **Medium** | Fixed and verified (client + SQL) |
| SOL-02 | CDN scripts loaded without Subresource Integrity, and the CSP allowed every package on jsDelivr | **Medium** | Fixed and verified |
| SOL-03 | DOMPurify 3.1.6 out of date | Low | Upgraded to 3.2.6 and verified |
| SOL-04 | Payment redirect followed any URL the server returned | Low | Fixed and verified |
| SOL-05 | Paid chapter text may be readable with a direct `chapters?select=content` request | **High *if present*** | Reproduced on a Supabase-like local database; production **not confirmed**. Guarded fix in `sql/06` |
| SOL-06 | Missing HSTS and COOP headers | Low | Fixed and verified |
| SOL-07 | User IDs are public on reviews, threads, replies and comments | Info | Accepted (documented) |
| SOL-08 | Saved paid chapters stay on the device if the reader logs out while offline | Low | Accepted (documented) |
| SOL-09 | `wrangler.jsonc` publishes the repo root if someone deploys without `-c` | Info | Mitigated (`.assetsignore` extended) |

Full detail for each finding (root cause, evidence, impact, fix, verification) is below.

### SOL-01: CSS injection via `avatar_color` (Medium)

- **Affected:**
  - `js/discuss.js:31` (the `avatar()` renderer)
  - `sql/04_discussions.sql:126` (`discussion_author()` copies the colour unchecked)
  - also `js/profile.js:42, 182`
- **Root cause:**
  - The avatar colour comes from `raw_user_meta_data`. Any signed-in user can write that field with `supabase.auth.updateUser({ data: { avatar_color: … } })`.
  - The server copied it onto every thread and reply as-is.
  - The client put it inside `style="--av:…"`. `esc()` stops attribute breakout, but not `;`, so extra CSS declarations got through.
- **Evidence:**
  - Local preview, real `discuss.js` code path, with faked thread rows. The payload was `red;position:fixed;inset:0;z-index:99999;background:url(https://example.invalid/track.png)`.
  - The rendered avatar had `position: fixed`, `z-index: 99999`, covered the whole viewport, and loaded the external image.
  - In the local Postgres, `create_thread` stored the payload unchanged.
- **Impact:**
  - One malicious account could cover the Discussion page for every visitor (defacement / denial of use).
  - It could also make every visitor's browser request an attacker URL (IP and timing tracking).
  - It could not run script: `script-src` and the escaping prevented that.
- **Fix:**
  - New `SolApp.safeColor()` (`js/app-core.js:34`) only allows `#rrggbb`. All three avatar sinks use it.
  - `sql/06_security_hardening.sql` §1 validates the colour in `discussion_author()`, nulls invalid stored values, and adds `CHECK` constraints on both tables.
- **Verified:**
  - After the fix, the same PoC renders `--av:#e0274f` (`position: static`), and normal colours are kept.
  - SQL tests: the malicious colour is dropped, a valid colour is kept, and no invalid colours remain.
  - Unit test: `SOL-01 …` in `tests/security.test.mjs`.

### SOL-02: Third-party scripts without integrity pinning (Medium)

- **Affected:** `index.html:498-502`, `_headers:2`
- **Root cause:**
  - The five jsDelivr scripts had no `integrity` attribute.
  - The CSP allowed `script-src https://cdn.jsdelivr.net`, which is every file of every npm package.
- **Evidence:**
  - The script tags had no hash (static check).
  - The CSP host-wide allowance meant any HTML injection could load script gadgets from any npm package (a well-known CSP bypass).
  - A compromised or mis-served CDN file would run with full page rights, including the Supabase session in `localStorage`.
- **Impact:**
  - Supply-chain takeover of every session: read paid content, act as the user.
  - Likelihood is low; impact is high.
- **Fix:**
  - `integrity="sha384-…"` plus `crossorigin="anonymous"` on all five scripts (hashes computed from the exact pinned files).
  - CSP `script-src` narrowed to the four pinned package folders.
  - Service-worker CDN cache renamed `sol-static-v2`, so older opaque copies aren't reused for CORS requests.
- **Verified:**
  - Under `wrangler dev` with the real `_headers`, all libraries load (supabase-js, DOMPurify 3.2.6, GSAP, ScrollTrigger, Lenis), books load, and the app runs.
  - A script from another jsDelivr package (`jquery@3.7.1`) is **blocked** by the CSP (console violation captured).
  - The offline test still passes with the new cache.
  - Unit tests: `SOL-02 …`.

### SOL-03: DOMPurify 3.1.6 (Low)

- **Affected:** `index.html:499`
- **Root cause:** an old pinned version. CVE-2025-26791, fixed in 3.2.4, needs `SAFE_FOR_TEMPLATES`, which Sol does not use, so it was not exploitable here.
- **Fix:** upgraded to 3.2.6, with SRI.
- **Verified:** `DOMPurify.version === "3.2.6"` in the page. Five XSS payloads through `sanitizeChapterHtml()` came out inert:
  - `onerror`
  - `javascript:`
  - `<svg><script>`
  - `onclick`
  - the `mglyph/style` mXSS vector

  Normal formatting (`<p><em><strong>`) is kept.

### SOL-04: Unvalidated payment redirect (Low)

- **Affected:** `js/script.js:2942` (was `window.location.href = data.checkout_url` with no check)
- **Root cause:** the browser trusted any URL in the Edge Function's response.
- **Impact:** if that function, or something in front of it, were ever compromised or misconfigured, readers could be sent to a fake payment page. This is defence in depth.
- **Fix:** `isPayMongoCheckout()` (`js/script.js:3006`) only allows `https:` URLs on `*.paymongo.com` or `pm.link`. Anything else shows an error and doesn't redirect.
- **Verified:**
  - Unit test: the PayMongo URLs are accepted.
  - These are rejected: `http:`, look-alike domains (`paymongo.com.evil.example`, `evilpaymongo.com`), `javascript:`, protocol-relative, and empty.
  - In the browser: `true` for a checkout URL, `false` for `https://evil.example/x`.

### SOL-05: Paid chapter text through direct table reads (High if present, unconfirmed)

- **Affected:**
  - the `chapters` table policies/grants in production (not in the repo)
  - client reads at `js/script.js:2596` and `js/profile.js:93`
- **Root cause:**
  - The site reads `chapters` directly for `id, chapter_number`, so the browser roles must have some SELECT on the table.
  - Supabase's defaults give `anon`/`authenticated` **all** privileges on every column.
  - If the RLS policy lets readers see the row (needed for those reads), it also lets them request `?select=content`. RLS filters rows, not columns.
  - Whether production looks like this is unknown, because the policy isn't in the repo.
- **Evidence:**
  - Local Postgres with Supabase's roles and default grants plus a row-visible policy: `anon` read `PAID SECRET TEXT` from a paid chapter directly, and so did a signed-in reader who hadn't paid.
  - `get_chapter_for_reader` correctly withheld it.
- **Impact:** if present, anyone with the public key could download every paid chapter free.
- **Fix (`sql/06` §2):**
  - Revokes table-wide SELECT and INSERT/UPDATE/DELETE/TRUNCATE on `chapters` from the browser roles.
  - Grants SELECT back only on safe columns (`id, book_id, chapter_number, title, is_free, status, published_at, created_at, updated_at`, whichever exist).
  - **Guarded:** it does nothing, and prints a NOTICE, if any function reading `chapters` runs with caller rights, since that function would break.
- **Verified locally:**
  - Before: two FAILs (anon and signed-in reads of paid text).
  - After: both PASS. `chapter_number` is still readable, free chapters still open through `get_chapter_for_reader`, and direct writes are blocked.
  - The guard was tested: with a caller-rights function present, the lock was skipped.
- **You still need to:** run `sql/05` to see what production looks like, then run `sql/06`. See REMAINING_RISKS R-1.

### SOL-06: Missing HSTS / COOP (Low)

- **Affected:** `_headers`
- **Fix:** added `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains`, so other `workers.dev` hosts aren't affected) and `Cross-Origin-Opener-Policy: same-origin`. No popups or OAuth windows are used, so nothing breaks.
- **Verified:** `curl -I` against `wrangler dev` shows both headers plus the existing CSP, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy and Permissions-Policy.

### SOL-07: Public user IDs (Info, accepted)

- **Where:** `book_reviews`, `discussion_threads`, `discussion_replies` and (probably) `comments` expose `user_id` to everyone. The site uses it for "delete own" buttons.
- **Risk:** a UUID is not a credential and every write path checks `auth.uid()`. The only risk is linking one person's posts across features.
- **Status:** left as is.

### SOL-08: Paid chapters kept after an offline logout (Low, accepted)

- **Where:** `js/offline.js:258` only wipes downloads when the logout happens online. This avoids wiping a reader's library when a flaky connection looks like a logout.
- **Risk:** on a shared device, the next person can read chapters already saved.
- **Status:** accepted for now. A "wipe at the next online start" flag would close it (REMAINING_RISKS R-6).

### SOL-09: Root deploy config (Info, mitigated)

- **Where:** `wrangler.jsonc` points at `.`.
- **Risk:** running `wrangler deploy` without `-c wrangler.build.jsonc` publishes the project folder, filtered by `.assetsignore`.
- **Fix:** added `.claude`, `brand`, `dist`, `tests`, `optional-share-previews`, `package*.json`, `build.mjs` and `.DS_Store` to `.assetsignore`. `npm run deploy` was already safe.

---

## 3. Checked and found sound

| Check | How | Result |
|---|---|---|
| XSS in user content (comments, replies, threads, reviews, names, search, book cards, toasts) | Every `innerHTML` / `insertAdjacentHTML` sink reviewed (~110) | All user text goes through `esc()` / `escapeHtml()` or `textContent`. Chapter HTML goes through DOMPurify with an allow-list (and a hand-written fallback) |
| SQL injection | Repo SQL: no dynamic SQL except `sql/06`, which uses `format()` with `quote_ident`. Client: only PostgREST builders and typed RPC args | None. The one hand-built PostgREST filter (`hasPaidPurchase`) is UUID-checked first (`isUuid`) |
| CSRF | Auth is a bearer header from `localStorage`, not a cookie | Not applicable |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` | Protected |
| Access control in repo SQL | Local Postgres tests run as `anon` / `authenticated` | Readers can't edit `books` (price); can't insert threads directly (no name spoofing); non-writers can't pin; non-owners can't change book details; anonymous votes are refused |
| Rate limiting (repo SQL) | `create_thread` 5/hour, `add_reply` 20/10 min; reviews and votes are one per user per book | OK. Comments are not in the repo (REMAINING_RISKS R-3) |
| Secrets | Repo scan + unit test | Only the publishable key |
| Dependencies | `npm audit` + library versions | 0 npm issues; DOMPurify upgraded |
| Share-preview Worker | Code review | Reads public columns only; escapes values into meta attributes; `setInnerContent` escapes text |
