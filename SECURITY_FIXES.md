# Sol — Security Fixes

Everything changed in this pass, with the reason for each change. Backups of the original files are in the session scratchpad. Nothing has been deployed, and no SQL has been run on Supabase.

## Frontend (takes effect after `npm run deploy`)

| File | Change | Finding |
|---|---|---|
| `js/app-core.js:34`, `:137` | New `safeColor(v, fallback)`, exposed as `SolApp.safeColor`. Returns the value only if it is `#rrggbb`, otherwise the brand red | SOL-01 |
| `js/discuss.js:31` | The avatar style uses `A.safeColor(color)` instead of `esc(color)` | SOL-01 |
| `js/profile.js:42`, `:182` | The header avatar and colour swatches use `A.safeColor(...)` | SOL-01 |
| `index.html:498-502` | `integrity="sha384-…"` and `crossorigin="anonymous"` on all 5 CDN scripts; DOMPurify `3.1.6 → 3.2.6` | SOL-02, SOL-03 |
| `_headers` | CSP `script-src` narrowed from the whole `cdn.jsdelivr.net` host to the 4 pinned package folders; added `Strict-Transport-Security: max-age=31536000` and `Cross-Origin-Opener-Policy: same-origin` | SOL-02, SOL-06 |
| `sw.js:11` | CDN cache renamed `sol-static-v1 → sol-static-v2`, so copies cached before SRI (opaque) are dropped once and fetched again with CORS | SOL-02 |
| `js/script.js:2934-2942`, `:3006` | New `isPayMongoCheckout()`. The checkout redirect only goes to `https://*.paymongo.com` or `pm.link`; anything else shows "Payment checkout URL was not valid" | SOL-04 |
| `.assetsignore` | Also excludes `.claude`, `.DS_Store`, `brand`, `dist`, `optional-share-previews`, `tests`, `package*.json`, `build.mjs` | SOL-09 |

If you ever change a library version in `index.html`, you must also:
- update its `integrity` hash
- update the CSP folder in `_headers`

The test `npm test` fails if either is out of step. To get a new hash, run:

```bash
curl -sL https://cdn.jsdelivr.net/npm/<pkg>@<ver>/<file> | openssl dgst -sha384 -binary | openssl base64 -A
```

## Database (takes effect when you run it in Supabase → SQL Editor)

### `sql/05_security_audit_readonly.sql` (new, read-only)

- Changes nothing.
- Lists the following, so the backend outside this repo can be reviewed:
  - RLS status per table
  - every policy
  - table and column grants for `anon` / `authenticated`
  - every function: definer or not, whether `search_path` is pinned, who can call it
  - the full source of `author_*`, `get_chapter_for_reader`, `is_comment_admin` and the trigger functions
  - triggers
  - Storage buckets
  - the columns of sensitive tables

### `sql/06_security_hardening.sql` (new, safe to run twice)

1. **Avatar colours (SOL-01)**
   - `discussion_author()` now copies the colour only if it matches `^#[0-9A-Fa-f]{6}$`.
   - Existing invalid colours on threads and replies are set to null. Only invalid values are touched.
   - New `CHECK` constraints `discussion_threads_avatar_color_check` and `discussion_replies_avatar_color_check`.
2. **Chapter text lock (SOL-05)**
   - Revokes table-wide `SELECT, INSERT, UPDATE, DELETE, TRUNCATE` on `public.chapters` from `anon` and `authenticated`.
   - Grants `SELECT` back only on `id, book_id, chapter_number, title, is_free, status, published_at, created_at, updated_at` (whichever exist).
   - **Guard:** if any non-trigger function that reads `chapters` runs with caller rights, the whole block is skipped with `NOTICE: Chapter lock SKIPPED …` and the function names.
   - **Undo:** `grant select, insert, update, delete on public.chapters to anon, authenticated;`

**Run order:** `05` first and share its output, then `06`. After running `06`, open a free chapter and a chapter you own as a check.

### `sql/07_open_writers.sql` (new, 15 Nov; one transaction, safe to run twice)

Opens writing to every signed-in reader, free books only.

1. **Admins.** `sol_is_admin()` checks your existing `app_admins` plus a new `sol_admins`, which is seeded with everyone who owns a book today (you). It is the only check for selling and moderation.
   - **Strict helpers:** `is_book_author(book)` is rewritten to "admin, or owner of this book", and `is_site_admin()` to "admin". Both keep their names and inputs. Their old code wasn't exported, and every live studio function depends on them.
   - **Safety stop:** if any Writer Studio function checks neither `is_book_author()` nor `owner_id = auth.uid()`, it stops with `STOPPED, nothing changed …`.
2. **Hidden books:** `get_chapter_for_reader` is the live version plus a hidden-book check.
3. **`author_can_write()`** is true for any signed-in user with a confirmed email who isn't blocked. **`author_can_sell()`** is true for admins only.
4. **Table guards** (`sol_books_guard`, `sol_chapters_guard`) run on every write, whichever function makes it:
   - only the owner (or an admin) can change or delete a book or chapter
   - readers can still bump counters such as views and votes
   - non-admin prices are forced to 0 and chapters to free
   - covers must be `https://`
   - limits: 3 new books and 30 new chapters a day; 300,000 characters a chapter
5. **Moderation:**
   - `books.is_hidden` plus a restrictive select policy
   - `book_reports` with `report_book()` (10 a day per reader)
   - admin RPCs: `admin_list_reports`, `admin_resolve_report`, `admin_set_book_hidden`, `admin_set_writer_blocked`. Blocking a writer also hides their books.
6. **`is_sol_writer()`** now means admin, so discussion pinning and deleting is yours only.

**Undo opening writing:** see the comment at the top of the file.

### `sql/08_image_uploads.sql` (new, 15 Nov; one transaction, safe to run twice)

- **Bucket:** a public `sol-images` bucket, 5 MB per file, WebP, JPEG or PNG only.
- **Who can upload:** signed-in writers allowed by `author_can_write()` (confirmed email, not blocked), only into the folder named after their own user id.
- **Own files only:** writers can list, replace and delete only their own files.
- **Viewing:** everyone sees images through the public link only. Nobody can list another writer's folder.
- **In the browser:** images are shrunk (covers to 1200 px, chapter images to 1600 px) and re-encoded before upload. This also strips EXIF data such as GPS location.

### Frontend for open writing (15 Nov)

| File | Change |
|---|---|
| `js/author.js` | "Write" is always shown; signed-out visitors get a login prompt. New `author_can_sell` check: non-admin writers get no price fields, chapters are always free, and the pen name defaults to their display name. "Report this story" link on book pages (not on your own). Admin-only **Reports** screen: hide or show the book, block or unblock the writer, dismiss |
| `js/script.js` | Book page shows **Free** when a book's price is 0 |
| `js/offline.js` | Offline logout sets a flag; saved chapters are wiped the next time the device is online, unless the same reader is signed in again |
| `css/author.css` | Styles for the free note, report link and reports list |

### `sql/10_rewards_and_spoilers.sql` (16 Nov): chapter rewards + spoiler-safe comments

- **Rewards:** 20 comments + 5 shares on one book = 1 free paid chapter.
  - A comment counts only if it has 15+ characters, and at most 5 count per day (Manila time).
  - One share per book per day counts.
- **Readers can't add points themselves:** `reward_settings` and `reward_shares` are closed to readers. Shares are recorded only through `record_share()`, which checks the login and the book.
- **Claiming:** `claim_reward_chapter()` takes a per-reader lock, so the same reward can't be spent twice. It refuses free chapters, chapters already unlocked, and readers with no reward earned. The unlocked chapter is saved as a paid purchase with amount 0 and type `reward`.
- **Spoiler-safe:** new comments, discussion posts and replies remember the furthest chapter the writer had read (a trigger stamps it, so the writer can't fake it). The site blurs them for readers who are behind.

### `sql/11_seven_swords_codex.sql` (16 Nov): character cards + recaps (content only)

- **What it writes:** 20 cards with 143 facts and 54 approved recaps for *Princess and the Seven Swords*.
  - Each card appears from the chapter that introduces the character.
  - Each fact unlocks at the chapter that reveals it.
- **No new functions or permissions:** it uses the existing `get_codex` / `get_recaps`.
- **Safety:** it finds the book by title. It stops and changes nothing if no book or more than one book matches, or if the book already has cards — unless `replace_cards := true` is set. Other books are never touched.

### Frontend for rewards + spoilers (16 Nov)

| File | Change |
|---|---|
| `js/rewards.js` (new) | Progress and an "Unlock free" button in the paid-chapter window, plus a progress line on the book page. Hidden until `sql/10` is installed |
| `js/comments.js`, `js/discuss.js` | Blur comments, posts and replies written further ahead than the reader; tap to reveal. Your own posts are never blurred |
| `js/script.js` | Named parts (Prologue, Epilogue, …) show their own title instead of "Chapter N"; a finished share notifies the rewards module |

## Tests added

| File | What it covers | Run |
|---|---|---|
| `tests/security.test.mjs` | colour validation and every avatar sink; PayMongo redirect allow-list; SRI and crossorigin on every CDN script; CSP covers exactly the pinned folders and isn't host-wide; DOMPurify ≥ 3.2; no secret-key patterns in the shipped code | `npm test` |
| `tests/sql/00_supabase_stub.sql`, `tests/sql/10_security_checks.sql`, `tests/run-sql-tests.sh` | Builds a Supabase-like Postgres in Docker; runs the checks before and after `sql/06`, plus the guard test | `npm run test:sql` (needs Docker; never connects to Supabase) |

`package.json` now has the `test` and `test:sql` scripts.

## Not changed on purpose

- **Offline logout wipe (SOL-08):** kept the online-only wipe so readers don't lose their saved stories on a flaky connection.
- **Public `user_id` on posts (SOL-07):** the site needs it for "delete own"; it isn't a credential.
- **`style` attribute allowed in chapter HTML:** only the book's owner writes chapters, and `script-src` blocks script anyway.
