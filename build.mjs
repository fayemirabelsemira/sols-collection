/* Minifies js/ and css/ into dist/ and copies the pages.
   Your source files are never touched. Run:  npm run build  */
import { transform } from "esbuild";
import { readFile, writeFile, readdir, mkdir, rm, copyFile, cp } from "node:fs/promises";

const OUT = "dist";
await rm(OUT, { recursive: true, force: true });
await mkdir(`${OUT}/js`, { recursive: true });
await mkdir(`${OUT}/css`, { recursive: true });

let before = 0, after = 0;

async function minify(dir, loader) {
  for (const name of await readdir(dir)) {
    if (!name.endsWith(loader === "js" ? ".js" : ".css")) continue;
    const src = await readFile(`${dir}/${name}`, "utf8");
    /* no "format" = classic scripts: top-level names stay global, load order keeps working */
    const out = await transform(src, { loader, minify: true, target: "es2020", legalComments: "none" });
    await writeFile(`${OUT}/${dir}/${name}`, out.code);
    before += Buffer.byteLength(src);
    after += Buffer.byteLength(out.code);
    console.log(`  ${dir}/${name}  ${(Buffer.byteLength(src) / 1024).toFixed(0)} KB -> ${(Buffer.byteLength(out.code) / 1024).toFixed(0)} KB`);
  }
}

await minify("js", "js");
await minify("css", "css");

for (const file of ["index.html", "privacy.html", "terms.html", "refunds.html", "_headers"]) {
  try { await copyFile(file, `${OUT}/${file}`); } catch { console.warn(`  (skipped missing ${file})`); }
}

/* images (author photo etc.) must be published too, or <img src="images/..."> breaks on the live site */
try { await cp("images", `${OUT}/images`, { recursive: true }); console.log("  images/ copied"); }
catch { console.warn("  (no images/ folder to copy)"); }

/* ---------- app (PWA): icons, manifest, service worker ---------- */
try { await cp("icons", `${OUT}/icons`, { recursive: true }); console.log("  icons/ copied"); }
catch { console.warn("  (no icons/ folder to copy)"); }
try { await copyFile("manifest.webmanifest", `${OUT}/manifest.webmanifest`); } catch { console.warn("  (skipped missing manifest.webmanifest)"); }
/* .well-known/assetlinks.json links the Google Play app to this site (optional) */
try { await cp(".well-known", `${OUT}/.well-known`, { recursive: true }); console.log("  .well-known/ copied"); } catch {}

/* sw.js gets the list of files to keep offline + a version, so every deploy
   installs a fresh copy on readers' phones */
{
  const { createHash } = await import("node:crypto");
  const list = ["/", "/index.html", "/manifest.webmanifest", "/privacy.html", "/terms.html", "/refunds.html"];
  const hash = createHash("sha256");
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (/\.(js|css|png|svg|jpg|jpeg|webp)$/.test(entry.name)) {
        list.push(path.slice(OUT.length));
        hash.update(await readFile(path));
      }
    }
  }
  for (const d of ["js", "css", "icons", "images"]) { try { await walk(`${OUT}/${d}`); } catch {} }
  hash.update(await readFile(`${OUT}/index.html`));
  const version = hash.digest("hex").slice(0, 10);
  let sw = await readFile("sw.js", "utf8");
  sw = sw.replace(/const VERSION = "[^"]*";/, `const VERSION = "${version}";`)
         .replace(/const PRECACHE = \[[^\]]*\];/, `const PRECACHE = ${JSON.stringify(list)};`);
  const out = await transform(sw, { loader: "js", minify: true, target: "es2020", legalComments: "none" });
  await writeFile(`${OUT}/sw.js`, out.code);
  console.log(`  sw.js  version ${version}, ${list.length} files kept offline`);
}

console.log(`\nDone. JS+CSS: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB  (output in ${OUT}/)`);
