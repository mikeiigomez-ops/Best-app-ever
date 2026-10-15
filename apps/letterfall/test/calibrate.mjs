// Score distributions for level settings, used to set the star targets in engine.js.
// Run: node apps/letterfall/test/calibrate.mjs [games]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const L = createRequire(import.meta.url)(join(here, "../src/engine.js"));
L.setWords(readFileSync(join(here, "../src/words.txt"), "utf8"));
const games = +(process.argv[2] || 200);

// A middling player: random legal swaps, and powerups spent as soon as they arrive.
function play(opts, seed) {
  const g = new L.Game(seed, opts);
  let r = 0;
  const rnd = L.makeRng(seed + "#bot");
  while (!g.over()) {
    const have = L.POWERS.filter((k) => g.inv[k]);
    if (have.length) {
      const k = have[0];
      if (g.usePower(k, { cell: [Math.floor(rnd() * 6), Math.floor(rnd() * 6)], dir: rnd() < 0.5 ? "row" : "col" })) continue;
    }
    const moves = L.validMoves(g.board);
    g.tryMove(...moves[Math.floor(rnd() * moves.length)]);
  }
  return g.score;
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
const levels = process.argv.slice(3).map(Number).filter(Boolean);
for (const n of levels.length ? levels : [1, 3, 5, 6, 10, 11, 15, 20, 30, 40, 60]) {
  const cfg = L.level(n);
  const scores = [];
  for (let i = 0; i < games; i++) scores.push(play(cfg, "cal" + n + "-" + i));
  scores.sort((a, b) => a - b);
  const stars = cfg.targets.map((t) => (100 * scores.filter((s) => s >= t).length / games).toFixed(0) + "%");
  console.log(`level ${n}: moves ${cfg.moves} easy ${!!cfg.easy} rerolls ${cfg.rerolls}  p10 ${pct(scores, 0.1)} p25 ${pct(scores, 0.25)} p50 ${pct(scores, 0.5)} p75 ${pct(scores, 0.75)} p90 ${pct(scores, 0.9)}  targets ${cfg.targets.join("/")}  bot reaches 1/2/3 stars: ${stars.join(" ")}`);
}
