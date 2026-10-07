/* Minifies js/ and css/ into dist/ and copies the pages.
   Your source files are never touched. Run:  npm run build  */
import { transform } from "esbuild";
import { readFile, writeFile, readdir, mkdir, rm, copyFile } from "node:fs/promises";

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

console.log(`\nDone. JS+CSS: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB  (output in ${OUT}/)`);
