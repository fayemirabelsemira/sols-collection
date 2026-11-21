# Sol — Security Test Results

**Run on:** 13 November 2026, local machine only. Nothing was run against production.

## Summary

| Suite | Before fixes | After fixes |
|---|---|---|
| Frontend unit tests (`npm test`) | n/a (new) | **7 / 7 pass** |
| SQL checks, local Postgres (`npm run test:sql`) | **4 FAIL** (SOL-01 ×2, SOL-05 ×2), 9 pass | **13 / 13 pass**, plus the guard test passes |
| Browser PoC, avatar CSS injection | **Exploited** (full-screen overlay, external request) | Blocked; legitimate colours kept |
| Browser, CSP / SRI under `wrangler dev` | Whole CDN allowed, no SRI | Pinned libraries load; other jsDelivr package blocked |
| Browser, XSS payloads through the chapter sanitizer | Inert on 3.1.6 | Inert on 3.2.6 (5/5), formatting kept |
| Headless Chrome offline regression | Pass | Pass |
| `npm audit` | 0 | 0 |
| `npm run build` | OK | OK |

## 1. `npm test`

```
✔ SOL-01 safeColor accepts only #rrggbb
✔ SOL-01 every style="--av:" goes through safeColor
✔ SOL-04 checkout redirect only to PayMongo
✔ SOL-02 every CDN script has SRI and crossorigin
✔ SOL-02 CSP allows only the pinned library folders
✔ SOL-03 DOMPurify is 3.2.x or newer
✔ no service-role keys or secrets in the published code
ℹ tests 7  ℹ pass 7  ℹ fail 0
```

## 2. `npm run test:sql` (Docker Postgres 16 with Supabase roles and default grants)

```
NOTICE:  Chapter text locked. Browser roles can read only: id, book_id, chapter_number, title, is_free, status, created_at, published_at
PASS SOL-05 guard: lock skipped when a caller-rights function reads chapters
== BEFORE sql/06 ==
FAIL SOL-01 malicious avatar_color stored on thread
FAIL SOL-01 invalid colours stored
PASS SOL-01 valid colour still kept
FAIL SOL-05 anon read paid chapter text directly: PAID SECRET TEXT
FAIL SOL-05 signed-in reader read paid chapter text directly
PASS SOL-05 chapter_number still readable (used by the site)
PASS SOL-05 free chapter still opens through get_chapter_for_reader
PASS books cannot be edited by readers
PASS threads cannot be inserted directly (no name spoofing)
PASS non-writer cannot pin
PASS non-owner cannot change book details
PASS anonymous vote refused
PASS chapters cannot be written directly
== AFTER sql/06 ==
PASS SOL-01 malicious avatar_color dropped by create_thread
PASS SOL-01 no invalid colours stored
PASS SOL-01 valid colour still kept
PASS SOL-05 anon cannot read paid chapter text directly
PASS SOL-05 signed-in reader cannot read paid chapter text directly
PASS SOL-05 chapter_number still readable (used by the site)
PASS SOL-05 free chapter still opens through get_chapter_for_reader
PASS books cannot be edited by readers
PASS threads cannot be inserted directly (no name spoofing)
PASS non-writer cannot pin
PASS non-owner cannot change book details
PASS anonymous vote refused
PASS chapters cannot be written directly
All SQL security checks passed.
```

The "before" FAILs for SOL-05 describe the **modelled** configuration (Supabase default grants plus a row-visible policy). Production may differ; run `sql/05` to find out.

`sql/05_security_audit_readonly.sql` was also run against the local database to check that it executes: it returned all 9 sections without errors.

## 3. Browser checks (in-app browser, local only, backend calls faked in the page)

**Avatar PoC (SOL-01), the same input before and after the fix:**

| | Before | After |
|---|---|---|
| Malicious row `style` | `--av:red;position:fixed;inset:0;z-index:99999;background:url(https://example.invalid/track.png)` | `--av:#e0274f` |
| Computed position | `fixed`, covers viewport | `static` |
| External image requested | yes | no |
| Legitimate row `#3fa7ff` | n/a | `--av:#3fa7ff` (kept) |

**CSP / SRI under `wrangler dev` (real `_headers`):**
- Loaded: `DOMPurify.version = "3.2.6"`, `gsap`, `ScrollTrigger`, `Lenis`, `supabase`; 7 books rendered.
- An injected `jquery@3.7.1` from jsDelivr: **blocked**, with this console message: "violates the following Content Security Policy directive: script-src 'self' https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/ …".
- Response headers present: CSP, `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.

**Chapter sanitizer, DOMPurify 3.2.6:**

| Input | Output |
|---|---|
| `<img src=x onerror=alert(1)>` | `<img src="x">` |
| `<a href="javascript:alert(1)">x</a>` | `<a>x</a>` |
| `<svg><script>alert(1)</script></svg>` | (empty) |
| `<p onclick="alert(1)">t</p>` | `<p>t</p>` |
| `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>` | (empty) |
| `<p>Chapter <em>text</em> with <strong>bold</strong></p>` | unchanged |

**Payment redirect:** `isPayMongoCheckout('https://checkout.paymongo.com/cs_1')` gave `true`; `isPayMongoCheckout('https://evil.example/x')` gave `false`.

## 4. Offline regression (headless Chrome, network off)

```
books: 7 (app booted offline)
downloads list tap: modal=true title=The Things We Refuse To Keep
tap saved card on home: modal active=true
Start Reading: reader shown, chapter text present
tap unsaved card: modal active=true
```

## 5. Open writing (`sql/07`), 15 November 2026, local Postgres only

`npm run test:sql` now also builds `sol_open`: the stub, then **verbatim copies of the live Writer Studio functions** from the 15 Nov export, with `is_book_author` / `is_site_admin` modelled in their weakest form, then `sql/06` and `sql/07` and `sol_guard7` (with a careless `author_get_chapter`). Every check passes:

```
PASS new reader can write
PASS new writer cannot sell
PASS unconfirmed email cannot write
PASS Sol admin can sell
PASS new writer book saved free and owned
PASS new writer chapter forced free
PASS cannot rewrite another writer's chapter
PASS cannot delete another writer's chapter
PASS cannot change another writer's book
PASS cannot take over another writer's book
PASS cannot add chapters to another writer's book
PASS own chapters stay free even when set paid
PASS cannot open Sol's paid chapter in the studio
PASS live studio function refuses another writer's chapter
PASS cannot list Sol's chapters and drafts
PASS studio lists only the writer's own books
PASS owning a book does not make a site admin
PASS readers still count views
PASS Sol can still sell chapters
PASS daily book limit
PASS non-https cover refused
PASS book owner is no longer a moderator
PASS Sol can moderate
PASS readers cannot see reports
PASS Sol sees the report
PASS hidden book gone for readers
PASS hidden book's chapter won't open by link
PASS writer still sees own hidden book
PASS writer cannot unhide
PASS blocked writer cannot write
PASS blocked writer's books hidden
PASS sql/07 stops and changes nothing when a studio function skips the owner check
```

The "cannot rewrite / delete / change / take over" checks go through a deliberately **careless** owner-rights function, which proves the table guards hold even if a live studio function lacks an owner check.

**Browser (local, backend faked in the page):**

| Who | Result |
|---|---|
| Signed-out visitor | "Write" shows and opens the login prompt |
| New writer | No price fields; chapters are always free; pen name prefilled; `author_upsert_book` sent with `p_price: 0`; no Reports button |
| Admin | Reports button and list work; a title containing `<b>` is shown as text; "Hide book" calls `admin_set_book_hidden(…, true)` |
| Book page | "Report this story" shows under Start Reading on a phone; a price-0 book shows "Free" |
| Offline wipe flag | Cleared on the `online` event |

The headless offline regression still passes.

## 6. Image uploads (`sql/08`), local Postgres with a Storage stand-in

```
PASS bucket is public-read with a 5 MB limit
PASS writer uploads into own folder
PASS cannot upload into another writer's folder
PASS cannot upload outside a folder
PASS cannot delete another writer's image
PASS cannot take another writer's image
PASS writer lists only own files
PASS writer deletes own image
PASS unconfirmed email cannot upload
PASS visitors cannot upload
PASS blocked writer cannot upload
```

**Browser, with uploads faked in the page:**
- **Cover:** a 3000×2000 PNG (137 KB) was dropped on the cover box. It was uploaded as a 7.7 KB WebP to `<uid>/cover/…`, and the link field filled in.
- **Chapter editor:**
  - Dropping an image and using the image button each uploaded to `<uid>/chapter/…`.
  - The image goes on its own line after the line it was dropped on.
  - The preview keeps it.

## 6b. Rewards + spoiler-safe (`sql/10`) and character cards (`sql/11`), 16 November 2026, local Postgres only

`npm run test:sql` now ends with these two sections (97 PASS in total, 0 FAIL). The tables and functions are shaped like the live project, using the `sql/09` export.

```
== REWARDS + SPOILER-SAFE (sql/10) ==
PASS 4 comments + 2 shares earn 1 free chapter
PASS free chapter cannot be claimed
PASS reward unlocks a paid chapter
PASS claimed chapter opens for the reader
PASS a reward can only be used once
PASS same chapter cannot be claimed twice
PASS other paid chapters stay locked
PASS readers cannot write purchases directly
PASS readers cannot add shares directly
PASS rewards are per reader
PASS visitors cannot claim
PASS comment remembers the writer reached chapter 4
PASS discussion post remembers the writer's chapter
PASS without progress, the comment's own chapter is used
== CHARACTER CARDS + RECAPS (sql/11) ==
PASS sql/11 stops and changes nothing when the book already has cards
PASS sql/11 writes 20 cards
PASS old cards replaced
PASS 143 facts
PASS 54 approved recaps, none for missing ch41
PASS recap 55 takes the chapter title (Epilogue)
PASS ch1 shows only Navy and Nick
PASS twin reveal hidden until ch50
PASS Executioner name hidden until ch35
PASS Yoseff prince reveal hidden until ch39
PASS no fact unlocks before its card
PASS every relationship links a character
PASS recaps stop before the current chapter
PASS other books' cards are left alone
```

## 7. Known test-environment quirk

Under `wrangler dev`, the in-app browser refused to register the service worker ("An unknown error occurred when fetching the script"). This was reproduced with the **original** `_headers` too, and registration works on the plain local server, so it isn't caused by these changes. Check it once after deploying: open the site and confirm "Install app" and offline reading still work.
