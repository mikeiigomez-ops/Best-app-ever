// Upscroll build: inlines CSS + JS into two single-file pages.
//   dist/index.html     full standalone document (installable PWA, works offline)
//   dist/upscroll.html  page body for publishing as a Claude artifact (the host adds the document skeleton)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = (p) => join(root, "src", p);
const read = (p) => readFileSync(p, "utf8");

const contentFiles = readdirSync(src("content")).filter((f) => f.endsWith(".js")).sort().map((f) => src("content/" + f));
const jsOrder = ["util", "icons", "store", "ai", "engine", "cards", "sky", "vault", "ui", "app"].map((n) => src("js/" + n + ".js"));

const css = read(src("styles.css"));
const js = [...contentFiles, ...jsOrder]
  .map((f) => "/* ---- " + f.slice(root.length + 1) + " ---- */\n" + read(f))
  .join("\n")
  .replace(/<\/script/gi, "<\\/script");
const body = read(src("body.html"));

const FONTS = "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=JetBrains+Mono:wght@400;700&display=swap";
const DESC = "A feed that gives back: bite-size learning with spaced repetition, real-world micro-quests, and a vault for everything on your mind.";

const head = `<title>Upscroll</title>
<meta name="description" content="${DESC}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>
${css}
</style>`;

const page = `${head}
${body}
<script>
${js}
</script>
`;

mkdirSync(join(root, "dist"), { recursive: true });

// Artifact page: content only, no document skeleton.
writeFileSync(join(root, "dist/upscroll.html"), page);

// Standalone: full document + PWA bits.
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0e1b">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Upscroll">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-512.png">
${head.replace("</style>", "html,body{height:100%}body{padding-top:env(safe-area-inset-top,0px)}\n</style>")}
</head>
<body>
${body}
<script>
${js}
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
</script>
</body>
</html>
`;
writeFileSync(join(root, "dist/index.html"), standalone);
for (const f of ["manifest.webmanifest", "sw.js", "icon.svg", "icon-512.png"]) {
  try { copyFileSync(join(root, "public", f), join(root, "dist", f)); } catch { /* optional asset */ }
}
console.log("built dist/index.html (" + (standalone.length / 1024).toFixed(0) + " KB) and dist/upscroll.html");
