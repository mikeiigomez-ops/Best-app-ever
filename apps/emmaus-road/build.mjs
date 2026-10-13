// Emmaus Road build (node, no deps).
//   dist/emmaus-road.html  artifact page body (the host adds the document skeleton)
//   dist/index.html        standalone document: open it in any browser
// Run: node apps/emmaus-road/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT || join(root, "dist");
const page = readFileSync(join(root, "src", "emmaus-road.html"), "utf8");

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "emmaus-road.html"), page);
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
console.log("built dist/emmaus-road.html and dist/index.html");
