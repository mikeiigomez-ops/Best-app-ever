// Letterfall build (node, no deps).
//   dist/letterfall.html  artifact page body (the host adds the document skeleton)
//   dist/index.html       standalone document: open it in any browser
// Run: node apps/letterfall/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT || join(root, "dist");
const read = (p) => readFileSync(join(root, "src", p), "utf8");

const words = read("words.txt").split(/\s+/).filter(Boolean);
if (!words.every((w) => /^[a-z]{3,6}$/.test(w))) throw new Error("words.txt: only 3-6 lowercase letters per line");
const page = read("letterfall.html")
  .replace('"/*@WORDS*/"', () => JSON.stringify(words.join(" ")))
  .replace("/*@ENGINE*/", () => read("engine.js").replace(/<\/script/gi, "<\\/script"));

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "letterfall.html"), page);
writeFileSync(join(OUT, "index.html"), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${page}
</body>
</html>
`);
console.log("built dist/letterfall.html (" + (page.length / 1024).toFixed(0) + " KB) and dist/index.html");
