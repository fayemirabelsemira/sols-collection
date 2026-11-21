# Sol — Remaining Risks

These are open items, ordered by priority. Items R-1 to R-5 depend on backend code or settings that aren't in this repository, so they couldn't be tested without touching production. Running `sql/05_security_audit_readonly.sql` (read-only) and sharing the result would let all of them be reviewed in one pass.

| ID | Risk | Severity if real | What closes it |
|---|---|---|---|
| R-1 | Paid chapter text readable through `chapters?select=content` (SOL-05) | **High** | Run `sql/05`. If section 4 shows `chapters.content : anon/authenticated … SELECT`, run `sql/06` |
| R-2 | PayMongo webhook not verifying `Paymongo-Signature` | **High** | Review the webhook Edge Function (below) |
| R-3 | `comments` written directly from the browser (`js/comments.js:162`). If the INSERT policy/grant allows it, a user could set `author_name` (impersonation), `like_count` (fake ranking) or `user_id`; there's also no visible rate limit | Medium | `sql/05` sections 2, 3, 6 and 9 for `comments` / `comment_likes` |
| R-4 | `author_*` functions not checking ownership (editing or deleting another writer's chapters) | High | **Mitigated by `sql/07`:** table guards on `books`/`chapters` block non-owner writes whichever function makes them, and `sql/07` refuses to open writing if any studio function lacks an owner check. The live studio functions (15 Nov export) all go through `is_book_author()`, which `sql/07` rewrites to "owner of this book or admin" |
| R-5 | `purchases`, `reading_progress`, `comment_likes` policies (IDOR: reading or writing other users' rows) | High | `sql/05` section 2; `purchases` must be read-only and own-rows-only for the browser |
| R-6 | Saved paid chapters stay on the device after an offline logout (SOL-08) | Low | **Fixed 15 Nov:** they're wiped the next time the device is online, unless the same reader has signed in again |
| R-7 | Session token in `localStorage` (Supabase default) | Low | Mitigated by the CSP and escaping. An HttpOnly-cookie setup would need a server component, which isn't worth it for this app |
| R-8 | `img-src https:` lets chapter or cover HTML load images from any host (reader IP visible to that host) | Low | Only writers author chapters. Could be narrowed to the Supabase Storage host |
| R-9 | `style-src 'unsafe-inline'` | Low | Needed by GSAP and inline styles; script execution is still blocked |
| R-10 | Discussion moderators = anyone who owns a book (`is_sol_writer`) | Low | **Fixed by `sql/07`:** moderators are Sol admins only |
| R-11 | Open writing: spam, stolen or harmful stories | Medium | `sql/07` adds confirmed-email-only writing, 3 books / 30 chapters a day, reader reports, hide book and block writer. Check **Writer Studio → Reports** regularly |
| R-12 | `is_comment_admin` (chapter comments) may still mean "owns a book" | Closed | Live code checks `app_admins` only, so it's fine |
| R-13 | Chapters of a hidden book can still be opened by a direct link through `get_chapter_for_reader` | Closed by `sql/07` | `get_chapter_for_reader` is now the live version plus an `is_hidden` check |

## Before or with the next deploy

1. Run `npm test` (it should show 7 pass).
2. Run `npm run deploy`.
3. On the live site, check that books load, a chapter opens, the Discussion page shows, "Install app" works, and reading offline still works. All of these were checked locally; the service-worker check couldn't be done under Cloudflare's local runtime in this browser.

## In Supabase (SQL Editor)

1. **Run `sql/05_security_audit_readonly.sql`.** It changes nothing. Export the result and share it, so R-1, R-3, R-4 and R-5 can be confirmed or ruled out.
2. **Run `sql/06_security_hardening.sql`.**
   - Read the NOTICE line. "Chapter text locked" means it applied. "SKIPPED" lists functions that need to become `SECURITY DEFINER` first.
   - Then open a free chapter, a chapter you bought, and the Writer Studio, to confirm they still work.

## Payment webhook (R-2), what to check in the Edge Function

- It reads the **raw** request body. It computes HMAC-SHA256 with the webhook secret over `t + "." + rawBody`. It compares the result to the `te` value (test) or the `li` value (live) from the `Paymongo-Signature` header, using a constant-time comparison.
- It rejects old timestamps (for example, more than 5 minutes) to stop replays.
- It marks the purchase paid only after re-reading the payment from PayMongo's API, or after matching amount, currency and checkout/session id with the stored pending purchase.
- It is idempotent: the same event twice doesn't double-grant.
- The secret lives only in Supabase function secrets, never in the repo or the client.

## Supabase settings worth a look (dashboard, not code)

- **Auth:**
  - email confirmation on
  - leaked-password protection and a minimum length of 8 or more
  - rate limits left at their defaults
- **Storage:** the covers bucket can be public-read, but uploads should be limited to you (no `insert` policy for `authenticated`), with a size limit and image types only. `sql/05` section 8 shows this.
- **API:** keep the `service_role` key out of every client and Worker. None is in this repo today.
