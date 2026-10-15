// How each level plays for a casual player, used to set moves, targets and star thresholds in
// engine.js. Run: node apps/spellbright/test/calibrate.mjs [games] [levels...]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const L = createRequire(import.meta.url)(join(here, "../src/engine.js"));
L.setWords(readFileSync(join(here, "../src/words.txt"), "utf8"));
const games = +(process.argv[2] || 150);

// A casual player: looks at a handful of common words (3-5 letters, now and then 6) and plays the
// one that helps the goal most; spends powerups as soon as they arrive, aimed at random.
function play(cfg, seed) {
  const g = new L.Game(seed, cfg);
  const rnd = L.makeRng(seed + "#bot");
  while (!g.over()) {
    const have = L.POWERS.filter((k) => g.inv[k]);
    if (have.length && g.usePower(have[0], { cell: [Math.floor(rnd() * 6), Math.floor(rnd() * 6)], dir: rnd() < 0.5 ? "row" : "col" })) continue;
    const all = L.solve(g.board);
    const maxLen = rnd() < 0.15 ? 6 : 5;
    const c = all.filter((w) => w.common && w.word.length <= maxLen);
    const pool = c.length ? c : all;
    let pick = pool[Math.floor(rnd() * pool.length)];
    for (let k = 0; k < 5; k++) {
      const w = pool[Math.floor(rnd() * pool.length)];
      if (g.goalValue(w) > g.goalValue(pick)) pick = w;
    }
    g.trace(pick.path);
  }
  return g;
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
const levels = process.argv.slice(3).map(Number).filter(Boolean);
for (const n of levels.length ? levels : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 20, 30, 40]) {
  const cfg = L.level(n);
  const res = [];
  for (let i = 0; i < games; i++) res.push(play(cfg, "cal" + n + "-" + i));
  const stars = [1, 2, 3].map((s) => (100 * res.filter((g) => g.stars() >= s).length / games).toFixed(0) + "%");
  let detail;
  if (cfg.goal) {
    const left = res.filter((g) => g.goalDone).map((g) => g.finishLeft).sort((a, b) => a - b);
    detail = `goal ${JSON.stringify(cfg.goal)}  done ${(100 * left.length / games).toFixed(0)}%  moves left p25 ${pct(left, 0.25)} p50 ${pct(left, 0.5)} p75 ${pct(left, 0.75)}  star moves ${cfg.starMoves}`;
  } else {
    const sc = res.map((g) => g.score).sort((a, b) => a - b);
    detail = `score p10 ${pct(sc, 0.1)} p50 ${pct(sc, 0.5)} p90 ${pct(sc, 0.9)}  targets ${cfg.targets}`;
  }
  console.log(`L${n} (${cfg.moves} moves): ${detail}  stars 1/2/3: ${stars.join(" ")}`);
}
