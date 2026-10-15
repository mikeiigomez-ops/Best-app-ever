// Rule checks, then many games with simple bots to check balance.
// Run: node apps/letterfall/test/sim.mjs [games]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const L = createRequire(import.meta.url)(join(here, "../src/engine.js"));
L.setWords(readFileSync(join(here, "../src/words.txt"), "utf8"));
const games = +(process.argv[2] || 300);
const key = (g) => g.board.map((r) => r.map((t) => t.ch + t.mult + (t.bomb ? "b" : "")).join("")).join("/");

// Paths: neighbours (diagonals too), no repeats, 3-8 cells.
assert.ok(L.validPath([[0, 0], [1, 1], [2, 2]]));
assert.ok(!L.validPath([[0, 0], [0, 2], [0, 3]]), "gap");
assert.ok(!L.validPath([[0, 0], [0, 1], [0, 0]]), "repeat");
assert.ok(!L.validPath([[0, 0], [0, 1]]), "too short");

// Wilds.
assert.equal(L.matchWord("st?r"), "star");
assert.equal(L.matchWord("???"), null);

// Every word the solver finds can actually be traced, and a non-word is refused without cost.
{
  const g = new L.Game("check");
  const words = L.solve(g.board);
  assert.ok(words.length >= 12, "fresh board has plenty of words");
  for (const w of words.slice(0, 50)) assert.equal(g.wordAt(w.path), w.word);
  const before = key(g);
  assert.equal(g.trace([[0, 0], [0, 1], [5, 5]]), null);
  assert.equal(key(g), before);
  assert.equal(g.movesLeft, L.MOVES);
}

// Specials: 5 letters leave x2, 6 a bomb, 7+ a wild, on the tile the word ended on.
{
  for (const [len, check] of [[5, (t) => t.mult === 2], [6, (t) => t.bomb], [7, (t) => t.ch === L.WILD]]) {
    let done = false;
    for (let s = 0; s < 400 && !done; s++) {
      const g = new L.Game("sp" + len + "-" + s);
      const w = L.solve(g.board).find((x) => x.word.length === len);
      if (!w) continue;
      const end = w.path[len - 1], id = g.board[end[0]][end[1]].id;
      const res = g.trace(w.path);
      assert.ok(res);
      const t = g.board.flat().find((x) => x.id === id);
      assert.ok(t && check(t), "special for " + len + " letters");
      done = true;
    }
    assert.ok(done, "found a " + len + "-letter word to test");
  }
}

// Same seed and same actions (words and powerups) give the same game.
{
  const run = () => {
    const g = new L.Game("replay", { inv: { line: 1, bomb: 1, wild: 1, shuffle: 1 } });
    const plan = [null, { p: "bomb", cell: [2, 2] }, null, { p: "line", cell: [1, 1], dir: "col" }, { p: "wild", cell: [3, 3] }, null, { p: "shuffle" }, null];
    for (const step of plan) assert.ok(g.apply(step || g.hint().path), JSON.stringify(step));
    return g;
  };
  const a = run(), b = run();
  assert.equal(key(a), key(b));
  assert.equal(a.score, b.score);
}

// Bots. "casual" picks a random common word (what most people spot); "greedy" the longest word.
for (const bot of ["casual", "greedy"]) {
  const st = { moves: 0, len: 0, specials: 0, bombs: 0, shuffles: 0, earned: 0, used: 0, words: 0, scores: [], combo: 0 };
  for (let n = 0; n < games; n++) {
    const g = new L.Game("sim" + n);
    const rnd = L.makeRng("bot" + n);
    while (!g.over()) {
      const have = L.POWERS.filter((k) => g.inv[k]);
      if (have.length && rnd() < 0.5) {
        const pr = g.usePower(have[0], { cell: [Math.floor(rnd() * 6), Math.floor(rnd() * 6)], dir: rnd() < 0.5 ? "row" : "col" });
        if (pr) { st.used++; st.earned += pr.earned.length; continue; }
      }
      const all = L.solve(g.board);
      assert.ok(all.length > 0, "board must never be stuck");
      st.words += all.length;
      let pick;
      if (bot === "greedy") pick = all.reduce((a, b) => (b.word.length > a.word.length ? b : a));
      else { const c = all.filter((w) => w.common && w.word.length <= 5); pick = (c.length ? c : all)[Math.floor(rnd() * (c.length || all.length))]; }
      const res = g.trace(pick.path);
      assert.ok(res, "solver word must trace");
      for (const row of g.board) for (const t of row) assert.ok(t && /^[a-z?]$/.test(t.ch));
      st.moves++; st.len += pick.word.length; st.earned += res.earned.length;
      if (res.steps[0].made.length) st.specials++;
      if (res.steps[0].blast) st.bombs++;
      if (res.shuffled) st.shuffles++;
      st.combo = Math.max(st.combo, res.words[0].combo);
    }
    st.scores.push(g.score);
  }
  st.scores.sort((a, b) => a - b);
  const q = (p) => st.scores[Math.floor(p * (st.scores.length - 1))];
  console.log(`${bot}: ${games} games  words on board ${(st.words / st.moves).toFixed(0)}  avg word ${(st.len / st.moves).toFixed(1)} letters  ` +
    `specials/game ${(st.specials / games).toFixed(1)}  bomb blasts/game ${(st.bombs / games).toFixed(1)}  powerups earned/game ${(st.earned / games).toFixed(1)}  ` +
    `shuffles/game ${(st.shuffles / games).toFixed(2)}  max combo x${st.combo}\n  score p10 ${q(0.1)}  median ${q(0.5)}  p90 ${q(0.9)}`);
}
console.log("all checks passed");
