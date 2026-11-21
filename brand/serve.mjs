/* Local preview + export helper for the Sol logo reveal.
     node brand/serve.mjs            -> http://localhost:8790/sol-eclipse-reveal.html
   POST /save?name=<file> writes the uploaded body into brand/ (export only).
   Listens on 127.0.0.1 only. */
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8790;
const TYPES = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".png": "image/png", ".js": "text/javascript" };
const SAVE_OK = /^[a-z0-9-]+\.(mp4|svg|png)$/;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "POST" && url.pathname === "/save") {
      const name = basename(url.searchParams.get("name") || "");
      if (!SAVE_OK.test(name)) { res.writeHead(400); return res.end("bad name"); }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const buf = Buffer.concat(chunks);
      await writeFile(join(DIR, name), buf);
      console.log(`saved ${name} (${(buf.length / 1024).toFixed(0)} KB)`);
      res.writeHead(200); return res.end("ok");
    }
    const file = basename(url.pathname === "/" ? "sol-eclipse-reveal.html" : url.pathname);
    const body = await readFile(join(DIR, file));
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Sol logo reveal: http://localhost:${PORT}/sol-eclipse-reveal.html`));
