OPTIONAL. The site works fine without this.

What it does: makes https://yoursite/b/<book-slug> links show the book's cover,
title and description when pasted into Facebook, Messenger, X, Discord, etc.

To turn it on:
 1. Replace wrangler.jsonc with the settings in wrangler.worker.jsonc.
    (If you use "npm run deploy", put the same "main", "binding" and
    "run_worker_first" lines into wrangler.build.jsonc and keep its "directory" as ./dist.)
 2. In js/script.js change:  const SHARE_PATH_LINKS = false;  ->  true
 3. Deploy, then paste a /b/<slug> link into a Facebook post draft to test it.
