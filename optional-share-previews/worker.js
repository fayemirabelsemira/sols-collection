/* OPTIONAL: real link previews for shared books.
   Facebook, Messenger, X, Discord etc. don't run JavaScript, so a normal
   #/book/slug link always previews as the generic site. This Worker answers
   /b/<slug> with the same page but with that book's title, description and
   cover filled into the preview tags. See optional-share-previews/README.txt */

const SUPABASE_URL = "https://whxtkvavyisbvisdemhn.supabase.co";
const SUPABASE_KEY = "sb_publishable_dtX1ejuMrmJrBFmLCxnksg_8qpuxMzQ"; /* same public key as script.js */

/* MUST stay identical to slugify() / bookSlug() in js/script.js */
function slugify(text) {
  return String(text || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function slugFor(book, all) {
  const base = slugify(book.title) || "book";
  const clash = all.some(o => o.id !== book.id && (slugify(o.title) || "book") === base);
  return clash ? `${base}-${String(book.id).slice(0, 4)}` : base;
}

async function findBook(slug) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/books?select=id,title,author,description,cover_url&limit=1000`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  if (!res.ok) return null;
  const all = await res.json();
  return all.find(b => slugFor(b, all) === slug) || null;
}

const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/b\/([^/]+)\/?$/);
    if (!m) return env.ASSETS.fetch(request);

    const page = await env.ASSETS.fetch(new Request(new URL("/", url), request));
    let book = null;
    try { book = await findBook(decodeURIComponent(m[1])); } catch (e) {}

    const title = book ? `${book.title} | Sol's Collection` : "Sol's Collection";
    const desc = book ? String(book.description || "Read it on Sol's Collection.").replace(/\s+/g, " ").slice(0, 160) : "Stories that stay with you.";
    const image = book && book.cover_url ? book.cover_url : "";

    const setContent = value => ({ element(el) { el.setAttribute("content", value); } });
    const absolutize = attr => ({ element(el) {
      const v = el.getAttribute(attr);
      if (v && !/^(https?:|\/|data:|#)/.test(v)) el.setAttribute(attr, "/" + v);
    } });

    return new HTMLRewriter()
      .on("title", { element(el) { el.setInnerContent(title); } })
      .on('meta[property="og:title"]', setContent(book ? book.title : "Sol's Collection"))
      .on('meta[name="twitter:title"]', setContent(book ? book.title : "Sol's Collection"))
      .on('meta[property="og:description"]', setContent(desc))
      .on('meta[name="twitter:description"]', setContent(desc))
      .on('meta[name="twitter:card"]', setContent(image ? "summary_large_image" : "summary"))
      .on("head", { element(el) {
        el.append(`<meta property="og:url" content="${esc(url.href)}">`, { html: true });
        if (image) el.append(`<meta property="og:image" content="${esc(image)}"><meta name="twitter:image" content="${esc(image)}">`, { html: true });
      } })
      .on("link[href]", absolutize("href"))
      .on("script[src]", absolutize("src"))
      .transform(page);
  }
};
