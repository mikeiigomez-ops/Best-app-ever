// Plays many games with simple bots to check the rules hold up and to tune the numbers.
// Run: node apps/letterfall/test/sim.mjs [games] [rerolls]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const L = createRequire(import.meta.url)(join(here, "../src/engine.js"));
L.setWords(readFileSync(join(here, "../src/words.txt"), "utf8"));

const games = +(process.argv[2] || 500);
const rerolls = process.argv[3] == null ? undefined : +process.argv[3];

function key(g) { return g.board.map((r) => r.map((t) => t.ch + t.mult).join("")).join("/"); }

// Same seed + same moves => same game.
{
  const a = new L.Game("2026-10-15"), b = new L.Game("2026-10-15");
  assert.equal(key(a), key(b));
  for (let i = 0; i < L.MOVES; i++) { const m = a.hint(); a.tryMove(...m); b.tryMove(...m); }
  assert.equal(key(a), key(b));
  assert.equal(a.score, b.score);
  assert.notEqual(key(new L.Game("2026-10-16")), key(new L.Game("2026-10-15")));
}

// Invalid moves change nothing and cost no move.
{
  const g = new L.Game("x");
  const before = key(g);
  assert.equal(g.tryMove([0, 0], [2, 2]), null);
  const moves = L.validMoves(g.board);
  const set = new Set(moves.map((m) => m.flat().join()));
  outer: for (let r = 0; r < L.SIZE; r++) for (let c = 0; c + 1 < L.SIZE; c++) {
    if (!set.has([r, c, r, c + 1].join())) { assert.equal(g.tryMove([r, c], [r, c + 1]), null); break outer; }
  }
  assert.equal(key(g), before);
  assert.equal(g.movesLeft, L.MOVES);
}

let stats = { moves: 0, chains: 0, words: 0, specials: 0, shuffles: 0, score: [], options: 0, longest: 0, wordsSeen: {} };
for (const bot of ["random", "greedy"]) {
  stats = { moves: 0, chains: 0, words: 0, specials: 0, shuffles: 0, score: [], options: 0, longest: 0, wordsSeen: {} };
  for (let n = 0; n < games; n++) {
    const g = new L.Game("sim" + n, { rerolls });
    assert.equal(L.findWords(g.board).length, 0, "fresh board must be quiet");
    while (!g.over()) {
      const moves = L.validMoves(g.board);
      assert.ok(moves.length > 0, "board must always have a move");
      stats.options += moves.length;
      let pick = moves[Math.floor(Math.random() * moves.length)];
      if (bot === "greedy") {
        // Prefer the swap that spells the longest word.
        let bestLen = 0;
        for (const m of moves) {
          const t = structuredClone(g.board);
          const tmp = t[m[0][0]][m[0][1]]; t[m[0][0]][m[0][1]] = t[m[1][0]][m[1][1]]; t[m[1][0]][m[1][1]] = tmp;
          const len = Math.max(0, ...L.findWords(t).map((w) => w.word.length));
          if (len > bestLen) { bestLen = len; pick = m; }
        }
      }
      const res = g.tryMove(...pick);
      assert.ok(res, "a valid move must be accepted");
      assert.equal(L.findWords(g.board).length, 0, "board must settle with no words left");
      for (const row of g.board) for (const t of row) assert.ok(t && /^[a-z]$/.test(t.ch));
      stats.moves++;
      if (res.steps.length > 1) stats.chains++;
      if (res.shuffled) stats.shuffles++;
      for (const s of res.steps) {
        stats.words += s.words.length; stats.specials += s.made.length;
        for (const w of s.words) stats.wordsSeen[w.word] = (stats.wordsSeen[w.word] || 0) + 1;
      }
      stats.longest = Math.max(stats.longest, res.steps.length);
    }
    stats.score.push(g.score);
  }
  stats.score.sort((a, b) => a - b);
  const q = (p) => stats.score[Math.floor(p * (stats.score.length - 1))];
  const top = Object.entries(stats.wordsSeen).sort((a, b) => b[1] - a[1]).slice(0, 25).map((e) => e[0]).join(" ");
  console.log(`${bot}: ${games} games  moves-available/turn ${(stats.options / stats.moves).toFixed(1)}  ` +
    `chain-moves ${(100 * stats.chains / stats.moves).toFixed(0)}%  words/move ${(stats.words / stats.moves).toFixed(2)}  ` +
    `specials/game ${(stats.specials / games).toFixed(1)}  shuffles/game ${(stats.shuffles / games).toFixed(2)}  longest chain ${stats.longest}\n` +
    `  score p10 ${q(0.1)}  median ${q(0.5)}  p90 ${q(0.9)}  max ${q(1)}\n  most common words: ${top}`);
}
console.log("all checks passed");
