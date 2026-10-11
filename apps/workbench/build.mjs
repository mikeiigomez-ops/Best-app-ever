// Workbench build (node, no deps): inlines CSS + JS into single-file pages.
//   dist/workbench.html  artifact page body (the host adds the document skeleton)
//   dist/index.html      standalone preview document
// Run: node apps/workbench/build.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT || join(root, "dist");
const src = (p) => join(root, "src", p);

const CSS = ["tokens", "base", "bench", "instrument", "actions"].map((n) => "css/" + n + ".css");
const JS = ["core", "ai", "molds", "store", "demo", "forge", "charts", "instrument", "actions", "mission", "room", "bench", "app"]
  .map((n) => "js/" + n + ".js");

const missing = [];
function readPart(rel) {
  const p = src(rel);
  if (!existsSync(p)) { missing.push("src/" + rel); return null; }
  return readFileSync(p, "utf8");
}

// Conservative size pass (set RAW=1 to skip): drops indentation, blank lines and whole-line comments.
// Safe for these sources because none uses template literals or backslash line continuations;
// line breaks are kept, so automatic semicolon insertion is unchanged. Trailing comments are left alone.
const RAW = !!process.env.RAW;
function slim(text) {
  if (RAW) return text.trim();
  const out = [];
  let inBlock = false;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (inBlock) { if (t.endsWith("*/") && !t.slice(0, -2).includes("*/")) inBlock = false; else if (t.includes("*/")) { inBlock = false; out.push(t); } continue; }
    if (!t || t.startsWith("//")) continue;
    if (t.startsWith("/*")) {
      const end = t.indexOf("*/", 2);
      if (end < 0) { inBlock = true; continue; }
      if (end === t.length - 2) continue;
    }
    out.push(t);
  }
  return out.join("\n");
}

const css = CSS.map((rel) => {
  const body = readPart(rel);
  return body == null ? "" : "/* ---- src/" + rel + " ---- */\n" + slim(body) + "\n";
}).join("\n");

const js = JS.map((rel) => {
  const body = readPart(rel);
  return body == null ? "" : "/* ---- src/" + rel + " ---- */\n" + slim(body) + "\n";
}).join("\n").replace(/<\/script/gi, "<\\/script") + "\nWB.app.boot();\n";

const body = readPart("index.html");
if (body == null) { console.error("build: src/index.html is missing"); process.exit(1); }
if (/<\s*(!doctype|html|head|body)\b/i.test(body)) { console.error("build: src/index.html must be a body fragment"); process.exit(1); }
if (/<script\b/i.test(body)) { console.error("build: src/index.html must not contain <script>"); process.exit(1); }

const FONTS = "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:wght@400..700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";
const DESC = "Photograph a receipt, your fridge, a bill or a messy corner, and steer a live instrument of it: every number shows where it came from, and one hold commits a real next step.";

const head = `<title>Workbench</title>
<meta name="description" content="${DESC}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>
${css}</style>`;

const content = `${head}
${body.trim()}
<script>
${js}</script>
`;

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#F3EFE6">
${head}
</head>
<body>
${body.trim()}
<script>
${js}</script>
</body>
</html>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "workbench.html"), content);
writeFileSync(join(OUT, "index.html"), standalone);

const kb = (s) => (Buffer.byteLength(s, "utf8") / 1024).toFixed(1) + " KB";
console.log("workbench build");
console.log("  css     " + kb(css));
console.log("  js      " + kb(js));
console.log("  dist/workbench.html  " + kb(content));
console.log("  dist/index.html      " + kb(standalone));
if (Buffer.byteLength(content, "utf8") > 400 * 1024) console.warn("  warning: bundle is over the 400 KB target");
if (missing.length) console.warn("  missing (skipped): " + missing.join(", "));
